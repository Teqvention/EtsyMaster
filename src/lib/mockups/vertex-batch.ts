import { createHash } from "node:crypto"

import { auth, imageOf, modelJpeg, PAINT_MODEL, paintConfig, type Part } from "./gemini"

// Nano Banana in Vertex batch: half the price, no shared quota to wait for,
// but back in minutes to hours. Vertex only reads a job from Cloud Storage,
// so each job's requests (and the images they show, each stored once) go to
// GCS_BATCH_BUCKET under batch/<name>/, and its answers come back there. The
// bucket only passes things through: a lifecycle rule clears it after a few
// days, and the images we keep go to our own storage.
// Batch jobs run in the global location; us-central1 doesn't always know the model.

const BUCKET = () => {
  const bucket = process.env.GCS_BATCH_BUCKET?.trim()
  if (!bucket) throw new Error("Set GCS_BATCH_BUCKET in .env.local for batch mode")
  return bucket
}

export const batchConfigured = () => !!process.env.GCS_BATCH_BUCKET?.trim()

async function headers(extra: Record<string, string> = {}) {
  const { value } = await auth()
  return { Authorization: `Bearer ${value}`, ...extra }
}

async function upload(object: string, body: Buffer | string, type: string) {
  const response = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET()}/o?uploadType=media&name=${encodeURIComponent(object)}`,
    { method: "POST", headers: await headers({ "Content-Type": type }), body: body as BodyInit }
  )
  if (!response.ok) throw new Error(`Cloud Storage upload: ${(await response.text()).slice(0, 300)}`)
}

// A 2K PNG answer runs past batch's 10 MB a line; a JPEG stays well under it.
async function batchConfig(images: Buffer[], aspect?: number) {
  const config = await paintConfig(images, aspect)
  return {
    ...config,
    imageConfig: { ...config.imageConfig, imageOutputOptions: { mimeType: "image/jpeg", compressionQuality: 92 } },
  }
}

export type PaintRequest = { key: string; prompt: string; images: Buffer[]; aspect?: number }

/**
 * Each request as a line of a job's input, its images stored once under
 * `folder` (they stay there for whichever job sends the line, even again).
 */
export async function paintLines(folder: string, requests: PaintRequest[]) {
  const bucket = BUCKET()
  const uploaded = new Map<string, Promise<string>>()
  // Each image once, however many requests show it (a poster's reference, a style's board).
  const fileOf = (image: Buffer) => {
    const hash = createHash("sha1").update(image).digest("hex")
    let uri = uploaded.get(hash)
    if (!uri) {
      const object = `${folder}/img-${hash}.jpg`
      uri = modelJpeg(image).then(async (jpeg) => {
        await upload(object, jpeg, "image/jpeg")
        return `gs://${bucket}/${object}`
      })
      uploaded.set(hash, uri)
    }
    return uri
  }

  return Promise.all(
    requests.map(async (r) => {
      const parts: Part[] = [
        ...(await Promise.all(
          r.images.map(async (image) => ({ fileData: { fileUri: await fileOf(image), mimeType: "image/jpeg" } }))
        )),
        { text: r.prompt },
      ]
      return JSON.stringify({
        request: {
          labels: { key: r.key },
          contents: [{ role: "user", parts }],
          generationConfig: await batchConfig(r.images, r.aspect),
        },
      })
    })
  )
}

/** Starts one batch job painting `lines` (from `paintLines`); answers with its name, to ask after it. */
export async function startPaintBatch(name: string, lines: string[]) {
  const bucket = BUCKET()
  const folder = `batch/${name}`
  await upload(`${folder}/input.jsonl`, lines.join("\n") + "\n", "application/jsonl")

  const { key } = await auth()
  const response = await fetch(`${API}/projects/${key.project_id}/locations/global/batchPredictionJobs`, {
    method: "POST",
    headers: await headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      displayName: name,
      model: `publishers/google/models/${PAINT_MODEL}`,
      inputConfig: { instancesFormat: "jsonl", gcsSource: { uris: [`gs://${bucket}/${folder}/input.jsonl`] } },
      outputConfig: { predictionsFormat: "jsonl", gcsDestination: { outputUriPrefix: `gs://${bucket}/${folder}/out` } },
    }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`Batch job: ${body.error?.message ?? response.statusText}`)
  return body.name as string
}

const API = "https://aiplatform.googleapis.com/v1"

export type JobState = "running" | "succeeded" | "failed"

/**
 * Where a job stands; once it's through, where its answers are. Vertex keeps
 * what it painted (`ready`) until the whole job ends — or is cancelled, which
 * hands over what's done at once.
 */
export async function paintBatchState(job: string) {
  const response = await fetch(`${API}/${job}`, { headers: await headers() })
  const body = await response.json()
  if (!response.ok) throw new Error(`Batch job: ${body.error?.message ?? response.statusText}`)
  const state: string = body.state ?? ""
  const count = (n?: string) => Number(n ?? 0)
  const stats = body.completionStats ?? {}
  return {
    state: (["JOB_STATE_SUCCEEDED", "JOB_STATE_PARTIALLY_SUCCEEDED"].includes(state)
      ? "succeeded"
      : ["JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"].includes(state)
        ? "failed"
        : "running") as JobState,
    error: (body.error?.message as string | undefined) ?? (state.startsWith("JOB_STATE_") ? undefined : state),
    output: body.outputInfo?.gcsOutputDirectory as string | undefined,
    ready: count(stats.successfulCount),
    total: count(stats.successfulCount) + count(stats.failedCount) + count(stats.incompleteCount),
    input: (body.inputConfig?.gcsSource?.uris ?? []) as string[],
  }
}

/** Ends a job early; what it had painted comes out as if it had finished. */
export async function cancelPaintBatch(job: string) {
  const response = await fetch(`${API}/${job}:cancel`, {
    method: "POST",
    headers: await headers({ "Content-Type": "application/json" }),
    body: "{}",
  })
  if (!response.ok) throw new Error(`Batch cancel: ${(await response.text()).slice(0, 300)}`)
}

/** The lines of a job's `input` asking for `keys`, by key, to send again. */
export async function inputLines(input: string[], keys: Set<string>) {
  const found = new Map<string, string>()
  for (const uri of input) {
    const response = await fetch(gcsMedia(uri), { headers: await headers() })
    if (!response.ok) throw new Error(`Batch input ${uri}: ${response.statusText}`)
    for (const line of (await response.text()).split("\n")) {
      if (!line.trim()) continue
      const key = (JSON.parse(line) as { request?: { labels?: { key?: string } } }).request?.labels?.key
      if (key && keys.has(key)) found.set(key, line)
    }
  }
  return found
}

function gcsMedia(uri: string) {
  const [, bucket, object] = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri) ?? []
  if (!bucket) throw new Error(`Not in Cloud Storage: ${uri}`)
  return `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}?alt=media`
}

/** An answer: an image, or why not — neither when the job ended before it got to it. */
export type PaintResult = { key: string; image?: Buffer; error?: string }

/** Every answer in a finished job's output, one at a time (answers hold 2K images, so they're streamed). */
export async function* paintBatchResults(output: string): AsyncGenerator<PaintResult> {
  const [, bucket, prefix] = /^gs:\/\/([^/]+)\/(.+)$/.exec(output) ?? []
  if (!bucket) throw new Error(`Batch output: ${output}`)
  const list = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(prefix + "/")}`,
    { headers: await headers() }
  )
  const { items = [] } = (await list.json()) as { items?: { name: string }[] }
  for (const { name } of items.filter((i) => i.name.endsWith(".jsonl"))) {
    const response = await fetch(gcsMedia(`gs://${bucket}/${name}`), { headers: await headers() })
    if (!response.ok || !response.body) throw new Error(`Batch output ${name}: ${response.statusText}`)
    for await (const line of lines(response.body)) {
      if (line.trim()) yield parse(line)
    }
  }
}

function parse(line: string): PaintResult {
  const row = JSON.parse(line) as {
    request?: { labels?: { key?: string } }
    response?: { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[] }
    status?: string
  }
  const key = row.request?.labels?.key ?? ""
  if (row.status) return { key, error: row.status }
  if (!row.response) return { key }
  const candidate = row.response.candidates?.[0]
  try {
    return { key, image: imageOf(candidate?.content?.parts) }
  } catch {
    return { key, error: `No image (${candidate?.finishReason ?? "empty"})` }
  }
}

async function* lines(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  // A line runs to ~10 MB: its pieces are joined once it ends, as adding each
  // chunk to one string and searching all of it again took minutes per job.
  let parts: string[] = []
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    let text = decoder.decode(chunk, { stream: true })
    let end
    while ((end = text.indexOf("\n")) >= 0) {
      parts.push(text.slice(0, end))
      yield parts.join("")
      parts = []
      text = text.slice(end + 1)
    }
    if (text) parts.push(text)
  }
  parts.push(decoder.decode())
  const rest = parts.join("")
  if (rest) yield rest
}
