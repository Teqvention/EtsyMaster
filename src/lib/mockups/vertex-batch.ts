import { createHash } from "node:crypto"

import { busy as slowDown, calm, pace } from "@/lib/google/pace"
import { deniedByGoogle, heldBackByGoogle, refused, rejectedByGoogle, wrong } from "@/lib/google/pause"
import { uplink } from "@/lib/storage/uplink"

import { auth, FALLBACK_MODEL, imageOf, modelJpeg, PAINT_MODEL, paintConfig, type Part, StayedBusyError } from "./gemini"

export { StayedBusyError }

// Nano Banana in Vertex batch: half the price, no shared quota to wait for,
// but back in minutes to hours. Vertex only reads a job from Cloud Storage,
// so each job's requests go to GCS_BATCH_BUCKET under batch/<name>/, and its
// answers come back there; the images they show go under batch/img/, each
// once (see `paintLines`). The bucket only passes things through: the
// images we keep go to our own storage.
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** An answer Google gave with an error, and its status: whether to ask again depends on it. */
export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/** Google refusing us outright, or turning a request down as wrong, counts towards pausing everything (see google/pause.ts). */
async function check(response: Response, where: string) {
  if (!refused(response.status) && !wrong(response.status)) return
  const text = (await response.clone().text().catch(() => "")).slice(0, 300) || response.statusText
  if (refused(response.status)) void deniedByGoogle(where, response.status, text)
  else void rejectedByGoogle(where, response.status, text)
}

async function upload(object: string, body: Buffer | string, type: string) {
  const bytes = typeof body === "string" ? Buffer.byteLength(body) : body.byteLength
  // A passing failure (5xx, a dropped connection) is tried again a couple of times.
  for (let attempt = 1; ; attempt++) {
    let response: Response
    try {
      // Sharing the line with the database's queries (storage/uplink.ts).
      response = await uplink(bytes, async () =>
        fetch(
          `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET()}/o?uploadType=media&name=${encodeURIComponent(object)}`,
          { method: "POST", headers: await headers({ "Content-Type": type }), body: body as BodyInit, signal: TRANSFER() }
        )
      )
    } catch (error) {
      if (attempt >= 3) throw error
      await sleep(attempt * 5_000)
      continue
    }
    if (response.ok) return
    await check(response, "Cloud Storage")
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await response.body?.cancel().catch(() => {})
      await sleep(attempt * 5_000)
      continue
    }
    throw new GoogleError(`Cloud Storage upload: ${(await response.text()).slice(0, 300)}`, response.status)
  }
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
 * Images uploaded lately, by the hash of what was asked for: each goes up
 * once however many requests, sets and orders show it. 13 Oct every set of
 * a 24-set order sent its style's board and references up again, some 500
 * MB, and the line was full for minutes (see storage/uplink.ts). One older
 * than `REUSE` goes up again (rewritten, it counts as new), should the
 * bucket be given a rule that clears it after a few days.
 */
type Uploaded = Map<string, { uri: Promise<string>; at: number }>
const uploads: Uploaded = ((globalThis as typeof globalThis & { __batchImages?: Uploaded }).__batchImages ??= new Map())
const REUSE = 24 * 60 * 60_000

/**
 * Each request as a line of a job's input, its images stored once under
 * batch/img/ (they stay there for whichever job sends the line, even again).
 */
export async function paintLines(requests: PaintRequest[]) {
  const bucket = BUCKET()
  const fileOf = (image: Buffer) => {
    const hash = createHash("sha1").update(image).digest("hex")
    const held = uploads.get(hash)
    if (held && Date.now() - held.at < REUSE) return held.uri
    const object = `batch/img/${hash}.jpg`
    const uri = modelJpeg(image).then(async (jpeg) => {
      await upload(object, jpeg, "image/jpeg")
      return `gs://${bucket}/${object}`
    })
    uploads.set(hash, { uri, at: Date.now() })
    // One that didn't get up is tried again by the next request that shows it.
    uri.catch(() => uploads.get(hash)?.uri === uri && uploads.delete(hash))
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

/** Starts one batch job painting `lines` (from `paintLines`) with `model`; answers with its name, to ask after it. */
export async function startPaintBatch(name: string, lines: string[], model = PAINT_MODEL) {
  const bucket = BUCKET()
  const folder = `batch/${name}`
  await upload(`${folder}/input.jsonl`, lines.join("\n") + "\n", "application/jsonl")

  // Jobs start at least half a minute apart, across every server (see google/pace.ts).
  await pace("job")
  const { key } = await auth()
  const response = await fetch(`${API}/projects/${key.project_id}/locations/global/batchPredictionJobs`, {
    method: "POST",
    headers: await headers({ "Content-Type": "application/json" }),
    signal: CALL(),
    body: JSON.stringify({
      displayName: name,
      model: `publishers/google/models/${model}`,
      inputConfig: { instancesFormat: "jsonl", gcsSource: { uris: [`gs://${bucket}/${folder}/input.jsonl`] } },
      outputConfig: { predictionsFormat: "jsonl", gcsDestination: { outputUriPrefix: `gs://${bucket}/${folder}/out` } },
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    await check(response, "Vertex batch jobs")
    // Too many jobs at Vertex: the next one waits longer (the outbox tries again).
    if (response.status === 429) void slowDown("job")
    throw new GoogleError(`Batch job: ${body.error?.message ?? response.statusText}`, response.status)
  }
  void calm("job")
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
  await check(response, "Vertex batch jobs")
  const body = await response.json().catch(() => ({}))
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
  if (!response.ok) {
    await check(response, "Vertex batch jobs")
    throw new Error(`Batch cancel: ${(await response.text()).slice(0, 300)}`)
  }
}

/** The lines of a job's `input` asking for `keys` (else all of them), by key, to send again. */
export async function inputLines(input: string[], keys?: Set<string>) {
  const found = new Map<string, string>()
  for (const uri of input) {
    const response = await fetch(gcsMedia(uri), { headers: await headers(), signal: TRANSFER() })
    await check(response, "Cloud Storage")
    if (!response.ok) throw new Error(`Batch input ${uri}: ${response.statusText}`)
    for (const line of (await response.text()).split("\n")) {
      if (!line.trim()) continue
      const key = (JSON.parse(line) as { request?: { labels?: { key?: string } } }).request?.labels?.key
      if (key && (!keys || keys.has(key))) found.set(key, line)
    }
  }
  return found
}

export type OpenJob = { name: string; displayName: string; createdAt: string; input: string[]; model: string }

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
    await check(response, "Vertex batch jobs")
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`Batch jobs: ${body.error?.message ?? response.statusText}`)
    for (const job of body.batchPredictionJobs ?? []) {
      if (!["JOB_STATE_QUEUED", "JOB_STATE_PENDING", "JOB_STATE_RUNNING"].includes(job.state)) continue
      const model = String(job.model).split("/").pop() ?? ""
      if (model !== PAINT_MODEL && model !== FALLBACK_MODEL) continue
      open.push({
        name: job.name,
        displayName: job.displayName ?? "",
        model,
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

/** How one try at painting a line online went (see `paintLineOnce`). */
export type Attempt =
  | { outcome: "image"; image: Buffer }
  /** 429 or 503: Vertex's shared quota is out for now. */
  | { outcome: "busy"; why: string }
  /** A dropped or stalled connection, or a 5xx: it passes. */
  | { outcome: "flaky"; why: string }
  /** Answered without an image, for no reason given: another try usually paints. */
  | { outcome: "empty"; why: string }
  /** Held back by the safety filters: asking again won't change that. */
  | { outcome: "blocked"; why: string }
  /** Google refuses us outright (401, 403): see google/pause.ts. */
  | { outcome: "refused"; why: string }
  /** Refused for good, e.g. a bad request. */
  | { outcome: "failed"; why: string }

/** Finish reasons that mean the safety filters held the image back. */
export const BLOCKED = /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/i

/**
 * One try at painting a line of a job's input online, now: its images stay
 * in Cloud Storage, which online calls read too. Paced with every other
 * server's tries (google/pace.ts), and a busy answer makes them all wait a
 * little; trying again, and when, is up to the caller (the online lane in
 * generation/run.ts). Asked every second or two, dozens of calls at once
 * were 30+ requests a second of 429s (10 Oct, the evening the project was
 * suspended).
 */
export async function paintLineOnce(line: string, model = PAINT_MODEL): Promise<Attempt> {
  const { request } = JSON.parse(line) as { request: { labels?: { key?: string } } & Record<string, unknown> }
  const { labels: _labels, ...body } = request
  void _labels
  const kind = model === PAINT_MODEL ? "image" : "imageFallback"
  await pace(kind)
  let response: Response
  try {
    const { key: account } = await auth()
    response = await fetch(
      `${API}/projects/${account.project_id}/locations/global/publishers/google/models/${model}:generateContent`,
      {
        method: "POST",
        headers: await headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5 * 60_000),
      }
    )
  } catch (error) {
    // Paused meanwhile, or signing in failed: the caller decides.
    if (!(error instanceof TypeError || error instanceof DOMException)) throw error
    return { outcome: "flaky", why: `${model}: ${(error as Error).message}` }
  }
  if (response.status === 429 || response.status === 503) {
    await response.body?.cancel().catch(() => {})
    void slowDown(kind)
    return { outcome: "busy", why: `${model}: busy (${response.status})` }
  }
  if (response.status >= 500) {
    await response.body?.cancel().catch(() => {})
    return { outcome: "flaky", why: `${model}: ${response.status} ${response.statusText}` }
  }
  const answer = await response.json().catch(() => ({}))
  if (!response.ok) {
    const why = `${model}: ${answer.error?.message ?? response.statusText}`
    if (refused(response.status)) {
      void deniedByGoogle(model, response.status, answer.error?.message ?? response.statusText)
      return { outcome: "refused", why }
    }
    if (!wrong(response.status)) return { outcome: "failed", why }
    void rejectedByGoogle(model, response.status, answer.error?.message ?? response.statusText)
    return { outcome: "failed", why: `${model}: rejected (${response.status}): ${answer.error?.message ?? response.statusText}` }
  }
  void calm(kind)
  const candidate = answer.candidates?.[0]
  try {
    return { outcome: "image", image: imageOf(candidate?.content?.parts) }
  } catch {
    const reason = candidate?.finishReason ?? answer.promptFeedback?.blockReason ?? "empty"
    const why = `${model}: no image (${reason})`
    if (!BLOCKED.test(reason)) return { outcome: "empty", why }
    void heldBackByGoogle(model)
    return { outcome: "blocked", why }
  }
}

/**
 * A line painted online, tried again while Vertex is busy (each try paced
 * with every other server's, see `paintLineOnce`) for up to `patience`: for
 * callers that wait for one image themselves (the Citys runner). Gives up
 * with `StayedBusyError`; an answer without an image is tried twice more.
 */
export async function paintLineNow(line: string, patience = 30 * 60_000, model = PAINT_MODEL): Promise<PaintResult> {
  const key = (JSON.parse(line) as { request?: { labels?: { key?: string } } }).request?.labels?.key ?? ""
  const start = Date.now()
  let misses = 0
  for (;;) {
    const attempt = await paintLineOnce(line, model)
    if (attempt.outcome === "image") return { key, image: attempt.image }
    if (attempt.outcome === "busy" || attempt.outcome === "flaky" || attempt.outcome === "refused") {
      if (Date.now() - start > patience) throw new StayedBusyError(attempt.why)
      await sleep(attempt.outcome === "refused" ? 60_000 : 5_000)
      continue
    }
    if (attempt.outcome === "empty" && ++misses < 3) continue
    return { key, error: attempt.why }
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
    await check(list, "Cloud Storage")
    const body = (await list.json().catch(() => ({}))) as { items?: { name: string }[]; nextPageToken?: string }
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
