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

// Every call gives up after a while, so a connection that silently stalls
// can't hold the batch poller (and its job's lock) forever.
const CALL = () => AbortSignal.timeout(60_000)
const TRANSFER = () => AbortSignal.timeout(5 * 60_000)
/** A download that's sent nothing for this long has stalled. */
const STALLED = 2 * 60_000

async function upload(object: string, body: Buffer | string, type: string) {
  const response = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET()}/o?uploadType=media&name=${encodeURIComponent(object)}`,
    { method: "POST", headers: await headers({ "Content-Type": type }), body: body as BodyInit, signal: TRANSFER() }
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
    signal: CALL(),
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
  const response = await fetch(`${API}/${job}`, { headers: await headers(), signal: CALL() })
  const body = await response.json()
  // Gone at Vertex (deleted, or the project changed): it never brings anything in.
  if (response.status === 404) {
    return { state: "failed" as JobState, error: "Vertex no longer knows the job", ready: 0, total: 0, input: [] as string[], output: undefined }
  }
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
    signal: CALL(),
  })
  if (!response.ok) throw new Error(`Batch cancel: ${(await response.text()).slice(0, 300)}`)
}

/** The lines of a job's `input` asking for `keys` (else all of them), by key, to send again. */
export async function inputLines(input: string[], keys?: Set<string>) {
  const found = new Map<string, string>()
  for (const uri of input) {
    const response = await fetch(gcsMedia(uri), { headers: await headers(), signal: TRANSFER() })
    if (!response.ok) throw new Error(`Batch input ${uri}: ${response.statusText}`)
    for (const line of (await response.text()).split("\n")) {
      if (!line.trim()) continue
      const key = (JSON.parse(line) as { request?: { labels?: { key?: string } } }).request?.labels?.key
      if (key && (!keys || keys.has(key))) found.set(key, line)
    }
  }
  return found
}

export type OpenJob = { name: string; displayName: string; createdAt: string; input: string[] }

/** This project's painting jobs Vertex hasn't finished yet (the newest few hundred). */
export async function openPaintBatches(): Promise<OpenJob[]> {
  const { key } = await auth()
  const open: OpenJob[] = []
  let page = ""
  for (let i = 0; i < 3; i++) {
    const response = await fetch(
      `${API}/projects/${key.project_id}/locations/global/batchPredictionJobs?pageSize=100${page && `&pageToken=${page}`}`,
      { headers: await headers(), signal: CALL() }
    )
    const body = await response.json()
    if (!response.ok) throw new Error(`Batch jobs: ${body.error?.message ?? response.statusText}`)
    for (const job of body.batchPredictionJobs ?? []) {
      if (!["JOB_STATE_QUEUED", "JOB_STATE_PENDING", "JOB_STATE_RUNNING"].includes(job.state)) continue
      if (!String(job.model).endsWith(`/${PAINT_MODEL}`)) continue
      open.push({
        name: job.name,
        displayName: job.displayName ?? "",
        createdAt: job.createTime,
        input: job.inputConfig?.gcsSource?.uris ?? [],
      })
    }
    page = body.nextPageToken ?? ""
    if (!page) break
  }
  return open
}

function gcsMedia(uri: string) {
  const [, bucket, object] = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri) ?? []
  if (!bucket) throw new Error(`Not in Cloud Storage: ${uri}`)
  return `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}?alt=media`
}

/** An answer: an image, or why not — neither when the job ended before it got to it. */
export type PaintResult = { key: string; image?: Buffer; error?: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Thrown once Vertex has said it's busy for all of `paintLineNow`'s patience. */
export class StayedBusyError extends Error {}

/**
 * A line of a job's input painted online, now: its images stay in Cloud
 * Storage, which online calls read too. Vertex's shared quota answers 429
 * to most calls, so a busy answer or a dropped connection is asked again
 * after a pause that doubles to a minute: asked every second or two, dozens
 * of calls at once were 30+ requests a second of 429s (10 Oct, the evening
 * the project was suspended). Gives up with `StayedBusyError` after
 * `patience`; an answer without an image is tried again a couple of times.
 * Failing auth throws at once.
 */
export async function paintLineNow(line: string, patience = 30 * 60_000): Promise<PaintResult> {
  const { request } = JSON.parse(line) as { request: { labels?: { key?: string } } & Record<string, unknown> }
  const { labels, ...body } = request
  const key = labels?.key ?? ""
  const start = Date.now()
  let empty = 0
  let busy = 0
  for (;;) {
    const again = () => {
      if (Date.now() - start > patience) throw new StayedBusyError(`${PAINT_MODEL}: Vertex stayed busy`)
      const pause = Math.min(60_000, 2_000 * 2 ** Math.min(busy++, 5))
      return sleep(pause * (0.75 + Math.random() * 0.5))
    }
    const { key: account } = await auth()
    let response: Response
    try {
      response = await fetch(
        `${API}/projects/${account.project_id}/locations/global/publishers/google/models/${PAINT_MODEL}:generateContent`,
        {
          method: "POST",
          headers: await headers({ "Content-Type": "application/json" }),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5 * 60_000),
        }
      )
    } catch {
      await again()
      continue
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel().catch(() => {})
      await again()
      continue
    }
    const answer = await response.json().catch(() => ({}))
    if (!response.ok) return { key, error: `${PAINT_MODEL}: ${answer.error?.message ?? response.statusText}` }
    const candidate = answer.candidates?.[0]
    try {
      return { key, image: imageOf(candidate?.content?.parts) }
    } catch {
      if (++empty < 3) continue
      return { key, error: `${PAINT_MODEL}: no result (${candidate?.finishReason ?? answer.promptFeedback?.blockReason ?? "empty"})` }
    }
  }
}

/** Every answer in a finished job's output, one at a time (answers hold 2K images, so they're streamed). */
export async function* paintBatchResults(output: string): AsyncGenerator<PaintResult> {
  const [, bucket, prefix] = /^gs:\/\/([^/]+)\/(.+)$/.exec(output) ?? []
  if (!bucket) throw new Error(`Batch output: ${output}`)
  // A big job's answers can come in several files.
  const files: string[] = []
  let page = ""
  do {
    const list = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(prefix + "/")}${page && `&pageToken=${page}`}`,
      { headers: await headers(), signal: CALL() }
    )
    const body = (await list.json()) as { items?: { name: string }[]; nextPageToken?: string }
    if (!list.ok) throw new Error(`Batch output ${output}: ${list.statusText}`)
    files.push(...(body.items ?? []).map((i) => i.name).filter((n) => n.endsWith(".jsonl")))
    page = body.nextPageToken ?? ""
  } while (page)
  for (const name of files) {
    // Gigabytes for a big job: no overall limit, but it gives up once nothing comes for a while.
    const abort = new AbortController()
    let quiet = setTimeout(() => abort.abort(new Error(`Batch output ${name}: stalled`)), STALLED)
    try {
      const response = await fetch(gcsMedia(`gs://${bucket}/${name}`), { headers: await headers(), signal: abort.signal })
      if (!response.ok || !response.body) throw new Error(`Batch output ${name}: ${response.statusText}`)
      const chunks = (async function* () {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          clearTimeout(quiet)
          quiet = setTimeout(() => abort.abort(new Error(`Batch output ${name}: stalled`)), STALLED)
          yield chunk
        }
      })()
      for await (const line of lines(chunks)) {
        // Bringing an answer in takes a moment; the download waits meanwhile, which isn't a stall.
        clearTimeout(quiet)
        if (line.trim()) yield parse(line)
        quiet = setTimeout(() => abort.abort(new Error(`Batch output ${name}: stalled`)), STALLED)
      }
    } finally {
      clearTimeout(quiet)
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

async function* lines(chunks: AsyncIterable<Uint8Array>) {
  const decoder = new TextDecoder()
  // A line runs to ~10 MB: its pieces are joined once it ends, as adding each
  // chunk to one string and searching all of it again took minutes per job.
  let parts: string[] = []
  for await (const chunk of chunks) {
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
