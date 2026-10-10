
import sharp from "sharp"

import { exclusive } from "@/lib/db/sql"
import { paint } from "@/lib/mockups/gemini"
import { createSceneFromReference, fetchReference } from "@/lib/mockups/reference"
import { NotFoundError, readSceneFile } from "@/lib/mockups/storage"
import {
  cancelPaintBatch,
  inputLines,
  paintBatchResults,
  paintBatchState,
  paintLines,
  type PaintResult,
  startPaintBatch,
} from "@/lib/mockups/vertex-batch"
import { getStyle, styleImages } from "@/lib/styles/storage"
import type { StyleGuide } from "@/lib/styles/types"

import { analysePoster, extractPosters } from "./poster"
import { paintPrompt, planBriefs } from "./prompts"
import {
  getSet,
  listSets,
  readSetFile,
  newId,
  removeFile,
  saveFile,
  updateOutput,
  updateSet,
} from "./storage"
import {
  spread,
  type Asset,
  type Batch,
  type Creativity,
  type Delivery,
  type ExtractedPoster,
  type GenerateOptions,
  type GenerationSet,
  type Output,
  type OutputMode,
  type PaintJob,
  SENDING,
} from "./types"

// Works through queued sets in the background, on the server that queued
// them. A set's finished parts are kept, so a retry only redoes what failed,
// and new batches only add images.

/** Sets worked on at once; how many images go to Vertex at a time is up to its gate in gemini.ts. */
const PARALLEL = 10

type Queue = { waiting: string[]; running: Set<string> }
// On globalThis, so every route (and a dev reload) shares the one queue.
const global = globalThis as typeof globalThis & { __generationRunner?: Queue }
const queue = (global.__generationRunner ??= { waiting: [], running: new Set() })

export function enqueue(id: string) {
  if (!queue.waiting.includes(id)) queue.waiting.push(id)
  pump()
}

export function dequeue(id: string) {
  queue.waiting = queue.waiting.filter((w) => w !== id)
}

function pump() {
  while (queue.running.size < PARALLEL) {
    // A set asked for again while it runs waits for that run to end.
    const i = queue.waiting.findIndex((id) => !queue.running.has(id))
    if (i < 0) return
    const [id] = queue.waiting.splice(i, 1)
    queue.running.add(id)
    run(id).finally(() => {
      queue.running.delete(id)
      pump()
    })
  }
}

// --- Requests ---

const reset = <T extends Asset>(a: T): T =>
  a.status === "error" ? { ...a, status: "pending", error: undefined } : a

/**
 * Queues the set again for everything that failed; with `delivery`, the
 * failed images are painted that way (now or in a batch job) this time.
 */
export async function retry(id: string, delivery?: Delivery) {
  const set = await updateSet(id, (s) => {
    const again = new Set(s.outputs.filter((o) => o.status === "error").map((o) => o.batch))
    return {
      ...s,
      status: "queued",
      doneAt: undefined,
      stopping: undefined,
      original: reset(s.original),
      extraction: s.extraction && reset(s.extraction),
      mockup: s.mockup && reset(s.mockup),
      outputs: s.outputs.map(reset),
      batches: delivery
        ? s.batches.map((b) => (again.has(b.id) ? { ...b, options: { ...b.options, delivery } } : b))
        : s.batches,
    }
  })
  enqueue(id)
  return set
}

/**
 * Paints the set's images `delivery` from here on: every batch none of whose
 * images is being painted or done yet. Those already under way carry on.
 */
export async function setDelivery(id: string, delivery: Delivery) {
  return updateSet(id, (s) => {
    const started = new Set(s.outputs.filter((o) => o.status !== "pending").map((o) => o.batch))
    return {
      ...s,
      batches: s.batches.map((b) => (started.has(b.id) ? b : { ...b, options: { ...b.options, delivery } })),
    }
  })
}

/** More images for a poster set: a new batch, made once its turn comes. */
export async function addBatch(id: string, options: GenerateOptions) {
  const set = await updateSet(id, (s) => {
    if (s.kind !== "poster") throw new Error("Only poster sets make new images")
    const batch: Batch = { id: newId(), options, createdAt: new Date().toISOString(), expanded: false }
    // New images need a look, so the set comes back out of Done.
    return { ...s, status: "queued", batches: [...s.batches, batch], doneAt: undefined, stopping: undefined }
  })
  enqueue(id)
  return set
}

/**
 * Stops every set that hasn't sent its images off yet: those waiting their
 * turn stop now, those reading posters or writing briefs before they'd paint.
 * Images already painting (now or in a batch job) carry on. A stopped set
 * reads as failed, so Retry picks it up again. Answers with how many stopped.
 */
export async function stopWaiting() {
  let stopped = 0
  for (const set of await listSets()) {
    if (set.status !== "queued" && set.status !== "running") continue
    const unsent =
      set.batches.some((b) => !b.expanded) || set.outputs.some((o) => o.status === "pending" && !o.job)
    if (!unsent) continue
    stopped++
    if (set.status === "queued" && queue.waiting.includes(set.id)) {
      dequeue(set.id)
      await halt(set.id)
    } else {
      // Running here or on another server: it stops at its next step.
      await updateSet(set.id, (s) => ({ ...s, stopping: true }))
    }
  }
  return { stopped }
}

const STOPPED = "Stopped before painting"

/** Marks what hasn't started as stopped; images in a batch job go on. */
function halt(id: string) {
  return updateSet(id, (s) => {
    const stop = <T extends Asset & { job?: string }>(a: T): T =>
      a.status === "pending" && !a.job ? { ...a, status: "error", error: STOPPED } : a
    const next = {
      ...s,
      stopping: undefined,
      original: stop(s.original),
      extraction: s.extraction && stop(s.extraction),
      outputs: s.outputs.map(stop),
    }
    return { ...next, status: s.outputs.some((o) => o.job) ? "running" : "error" }
  })
}

// --- Running ---

/** Runs the set, unless another server is running it: then it goes back in line here until that's through. */
async function run(id: string) {
  try {
    const ran = await exclusive(`generation:${id}`, () => work(id))
    if (ran === null) setTimeout(() => enqueue(id), 5_000)
  } catch (error) {
    console.error(`Generation ${id}:`, error)
  }
}

async function work(id: string) {
  try {
    const set = await updateSet(id, (s) => ({ ...s, status: "running" }))
    if (set.stopping) return void (await halt(id))
    if (set.kind === "poster") await poster(id)
    else await mockup(set)
    // A batch job still painting keeps the set going; the batch poller finishes it.
    await updateSet(id, (s) => ({
      ...s,
      stopping: undefined,
      status: s.outputs.some((o) => o.job) ? "running" : failed(s) ? "error" : "done",
    }))
  } catch (error) {
    if (error instanceof NotFoundError && error.message === "Unknown generation") return // deleted while it ran
    console.error(`Generation ${id}:`, error)
    await updateSet(id, (s) => ({
      ...s,
      status: "error",
      outputs: s.outputs.map((o) => (o.status === "done" ? o : { ...o, status: "error", error: message(error) })),
    })).catch(() => {})
  }
}

function failed(set: GenerationSet) {
  return (
    [set.original, set.extraction, set.mockup, ...set.outputs].some((a) => a?.status === "error")
  )
}

async function original(set: GenerationSet) {
  if (set.original.status === "done") return readSetFile(set.id, set.original.file!)
  await updateSet(set.id, (s) => ({ ...s, original: { ...s.original, status: "running" } }))
  try {
    const stored = await store(set.id, "source", await fetchReference(set.source.image))
    await updateSet(set.id, (s) => ({ ...s, original: stored.asset }))
    return stored.data
  } catch (error) {
    await fail(set.id, "original", error)
    return null
  }
}

async function poster(id: string) {
  let set = await getSet(id)
  const photo = await original(set)
  if (!photo) return blockOutputs(id, "Needs the original photo")

  // 1. Every poster in the photo.
  set = await getSet(id)
  if (set.extraction?.status !== "done" || set.posters.length === 0) {
    await updateSet(id, (s) => ({ ...s, extraction: { status: "running", file: null } }))
    try {
      const { layout, prints, note } = await extractPosters(photo, set.source.title)
      const posters: ExtractedPoster[] = []
      for (const [index, print] of prints.entries()) {
        const file = `poster-${index + 1}-${Date.now().toString(36)}.jpg`
        await saveFile(id, file, print.image)
        posters.push({
          index,
          status: "done" as const,
          file,
          width: print.width,
          height: print.height,
          label: print.label || undefined,
        })
      }
      for (const old of set.posters) await removeFile(id, old.file)
      await updateSet(id, (s) => ({ ...s, layout, posters, extraction: { status: "done", file: null, note } }))
    } catch (error) {
      await fail(id, "extraction", error)
      return blockOutputs(id, "Needs the extracted poster")
    }
  }

  // 2. What each one is (best effort: prompts work without it, just less well).
  set = await getSet(id)
  await Promise.all(
    set.posters
      .filter((p) => !p.analysis)
      .map(async (p) => {
        try {
          const analysis = await analysePoster(await readSetFile(id, p.file!), set.source.title)
          await updateSet(id, (s) => ({
            ...s,
            posters: s.posters.map((q) => (q.index === p.index ? { ...q, analysis } : q)),
          }))
        } catch (error) {
          console.error(`Generation ${id}, reading poster ${p.index + 1}:`, error)
        }
      })
  )

  // 3. The images new batches ask for.
  if ((await getSet(id)).stopping) return halt(id)
  await updateSet(id, (s) => ({
    ...s,
    outputs: [...s.outputs, ...s.batches.filter((b) => !b.expanded).flatMap((b) => expand(s, b))],
    batches: s.batches.map((b) => ({ ...b, expanded: true })),
  }))

  // 4. A brief for each, then the painting: now, or handed to a batch job.
  await plan(id)
  set = await getSet(id)
  if (set.stopping) return halt(id)
  const styles = new Map<string, Promise<StyleRef | null>>()
  const styleOf = (o: Output) => {
    const styleId = o.mode === "variant" ? o.styleId : null
    if (!styleId) return Promise.resolve(null)
    if (!styles.has(styleId)) styles.set(styleId, loadStyle(styleId))
    return styles.get(styleId)!
  }
  const delivery = new Map(set.batches.map((b) => [b.id, b.options.delivery ?? "now"]))
  const waiting = set.outputs.filter((o) => o.status === "pending")
  const batched = waiting.filter((o) => delivery.get(o.batch) === "batch")
  await Promise.all([
    ...waiting.filter((o) => !batched.includes(o)).map((o) => draw(id, o, styleOf(o))),
    batched.length ? submit(id, batched, styleOf) : null,
  ])
}

/** Hands `outputs` to the batch outbox, which sends them in one job with whatever else is going; the batch poller brings their images back. */
async function submit(id: string, outputs: Output[], styleOf: (o: Output) => Promise<StyleRef | null>) {
  const ids = outputs.map((o) => o.id)
  await updateSet(id, (s) => ({
    ...s,
    outputs: s.outputs.map((o) => (ids.includes(o.id) ? { ...o, status: "running", error: undefined } : o)),
  }))
  try {
    const requests = await Promise.all(
      outputs.map(async (o) => ({ key: o.id, ...(await request(id, o.id, styleOf(o))) }))
    )
    const lines = await paintLines(`batch/${id}-${Date.now().toString(36)}`, requests)
    await updateSet(id, (s) => ({
      ...s,
      outputs: s.outputs.map((o) => (ids.includes(o.id) ? { ...o, job: SENDING } : o)),
    }))
    send({ set: id, outputs: ids, lines })
  } catch (error) {
    if (error instanceof NotFoundError && error.message === "Unknown generation") throw error
    console.error(`Generation ${id}, batch:`, error)
    await updateSet(id, (s) => ({
      ...s,
      outputs: s.outputs.map((o) => (ids.includes(o.id) ? { ...o, status: "error", error: message(error) } : o)),
    })).catch(() => {})
  }
}

// --- Batch outbox ---

// Vertex paints a few batch images at a time for the whole project, however
// they're split into jobs, and fewer jobs go faster. So outputs bound for
// batch wait here, on the server whose sets they are, until nothing more is
// on its way — no set in line, no job being ended early — and then go out
// together in one job.

type Parcel = { set: string; outputs: string[]; lines: string[] }
type Outbox = { parcels: Parcel[]; first: number; last: number; timer: ReturnType<typeof setTimeout> | null }
const outbox = ((global as typeof global & { __batchOutbox?: Outbox }).__batchOutbox ??= {
  parcels: [],
  first: 0,
  last: 0,
  timer: null,
})

/** How long the outbox waits for more at most; longer while jobs ended early are still coming in, whose rest joins it. */
const GATHER = 3 * 60_000
const GATHER_HARVEST = 15 * 60_000

function send(parcel: Parcel) {
  if (!outbox.parcels.length) outbox.first = Date.now()
  outbox.parcels.push(parcel)
  outbox.last = Date.now()
  watchOutbox()
}

function watchOutbox() {
  if (outbox.timer) return
  outbox.timer = setTimeout(async () => {
    outbox.timer = null
    if (!outbox.parcels.length) return
    try {
      const quiet = Date.now() - outbox.last > 3_000 && queue.running.size === 0 && queue.waiting.length === 0
      const harvesting = (await listSets()).some((s) => s.jobs?.some((j) => j.status === "running" && j.harvest))
      const waited = Date.now() - outbox.first
      if ((quiet && !harvesting) || waited > (harvesting ? GATHER_HARVEST : GATHER)) await sendOut()
    } catch (error) {
      console.error("Batch outbox:", error)
    }
    if (outbox.parcels.length) watchOutbox()
  }, 2_000)
}

/** One job for everything in the outbox. */
async function sendOut() {
  const parcels = outbox.parcels.splice(0)
  const size = parcels.reduce((n, p) => n + p.lines.length, 0)
  let name: string
  try {
    name = await startPaintBatch(`batch-${Date.now().toString(36)}`, parcels.flatMap((p) => p.lines))
  } catch (error) {
    console.error("Batch job:", error)
    for (const p of parcels) {
      await updateSet(p.set, (s) =>
        settled({
          ...s,
          outputs: s.outputs.map((o) =>
            p.outputs.includes(o.id) && o.job === SENDING
              ? { ...o, status: "error", job: undefined, error: message(error) }
              : o
          ),
        })
      ).catch(() => {})
    }
    return
  }
  const submittedAt = new Date().toISOString()
  // A set can have several parcels (one per job ended early); it gets one entry for the job.
  const bySet = new Map<string, string[]>()
  for (const p of parcels) bySet.set(p.set, [...(bySet.get(p.set) ?? []), ...p.outputs])
  for (const [set, ids] of bySet) {
    const job: PaintJob = { name, outputs: ids, submittedAt, status: "running", size }
    await updateSet(set, (s) => ({
      ...s,
      status: "running",
      jobs: [...(s.jobs ?? []), job],
      outputs: s.outputs.map((o) =>
        ids.includes(o.id) && o.job === SENDING ? { ...o, status: "running", error: undefined, job: name } : o
      ),
    })).catch((error) => console.error(`Generation ${set}, batch:`, error))
  }
  kickBatches()
}

/** The set as it stands once nothing in it is drawing any more. */
function settled(s: GenerationSet): GenerationSet {
  const busy = s.status === "queued" || s.outputs.some((o) => o.status === "pending" || o.status === "running")
  return busy ? s : { ...s, status: failed(s) ? "error" : "done" }
}

// --- Batch jobs ---

/** How often running batch jobs are asked after. */
const BATCH_POLL = 30_000

/**
 * Vertex only hands a job's images over when it ends, and a few slow
 * requests hold up all of them; so a job that's painted some and then
 * nothing for `STALL` is ended, its images come in and the rest goes
 * straight out again. One still painting goes on: a new job starts slowly
 * (a few images in its first ten minutes, then over a hundred in the next
 * ten), so ending it early costs more than it brings — but after
 * `HARVEST_MAX` what it has comes in anyway.
 */
const HARVEST_AFTER = 10 * 60_000
const STALL = 4 * 60_000
const HARVEST_MAX = 30 * 60_000

// The leader asks all the time; a server that just submitted a job asks until
// its jobs are through. A lock per job keeps two from collecting the same one.
type Poller = { timer: ReturnType<typeof setTimeout> | null; ticking: boolean; steady: boolean; tick: () => Promise<void> }
const batches = ((global as typeof global & { __batchPoller?: Poller }).__batchPoller ??= {
  timer: null,
  ticking: false,
  steady: false,
  tick: async () => {},
})

/** Keeps asking after batch jobs (on the leader; see instrumentation-node.ts). */
export function startBatches() {
  batches.steady = true
  kickBatches(0)
}

export function kickBatches(ms = 5_000) {
  if (batches.timer) clearTimeout(batches.timer)
  batches.timer = setTimeout(() => {
    batches.timer = null
    void batches.tick()
  }, ms)
}

/** A set's share of a job. */
type Share = { set: string; job: PaintJob }

async function pollBatches() {
  if (batches.ticking) return
  batches.ticking = true
  let more = false
  try {
    const jobs = new Map<string, Share[]>()
    for (const set of await listSets()) {
      for (const job of set.jobs ?? []) {
        if (job.status !== "running") continue
        const shares = jobs.get(job.name) ?? []
        // One share per set, even where an older server gave it two entries for the job.
        const mine = shares.find((s) => s.set === set.id)
        if (mine) mine.job = { ...mine.job, outputs: [...mine.job.outputs, ...job.outputs] }
        else jobs.set(job.name, [...shares, { set: set.id, job }])
      }
    }
    for (const [name, shares] of jobs) {
      more = true
      await exclusive(`batch:${name}`, () => follow(name, shares)).catch((error) =>
        console.error(`Batch ${name}:`, error)
      )
    }
  } finally {
    batches.ticking = false
    if (more || batches.steady) kickBatches(BATCH_POLL)
  }
}

// The newest code's pass: a reload during development swaps it in.
batches.tick = pollBatches

/** Brings a finished job's images in; one still going is noted, and ended early once it's held its images long enough. */
async function follow(name: string, shares: Share[]) {
  const state = await paintBatchState(name)
  if (state.state !== "running") return collect(name, shares, state)

  const { job } = shares[0]
  const now = Date.now()
  const age = now - Date.parse(job.submittedAt)
  const movedAt = state.ready !== (job.ready ?? 0) ? new Date(now).toISOString() : (job.movedAt ?? job.submittedAt)
  const due =
    !job.harvest &&
    state.ready > 0 &&
    state.ready < state.total &&
    age >= HARVEST_AFTER &&
    (now - Date.parse(movedAt) >= STALL || age >= HARVEST_MAX)
  if (!due && job.ready === state.ready && job.size === state.total) return
  await eachShare(shares, name, (j) => ({
    ...j,
    ready: state.ready,
    movedAt,
    size: state.total,
    ...(due && { harvest: true }),
  }))
  if (due) {
    await cancelPaintBatch(name)
    kickBatches(15_000)
  }
}

/** Ends every running job early (see `HARVEST_AFTER`); answers how many. */
async function harvestAll() {
  const names = new Set<string>()
  for (const set of await listSets()) {
    for (const job of set.jobs ?? []) if (job.status === "running" && !job.harvest) names.add(job.name)
  }
  for (const name of names) {
    await updateAllShares(name, (j) => ({ ...j, harvest: true }))
    await cancelPaintBatch(name).catch((error) => console.error(`Batch ${name}, cancel:`, error))
  }
  if (names.size) kickBatches(15_000)
  return names.size
}

async function updateAllShares(name: string, change: (job: PaintJob) => PaintJob) {
  const shares: Share[] = []
  for (const set of await listSets()) {
    for (const job of set.jobs ?? []) if (job.name === name) shares.push({ set: set.id, job })
  }
  await eachShare(shares, name, change)
}

function eachShare(shares: Share[], name: string, change: (job: PaintJob) => PaintJob) {
  return Promise.all(
    shares.map(({ set }) =>
      updateSet(set, (s) => ({ ...s, jobs: (s.jobs ?? []).map((j) => (j.name === name ? change(j) : j)) })).catch(
        () => {}
      )
    )
  )
}

/**
 * Brings a finished job's images into their sets. What it didn't get to goes
 * out again when the job was ended early on purpose, else it failed.
 */
async function collect(name: string, shares: Share[], { state, error, output, input }: Awaited<ReturnType<typeof paintBatchState>>) {
  const owner = new Map(shares.flatMap(({ set, job }) => job.outputs.map((o) => [o, set] as const)))
  const left = new Set(owner.keys())
  const short = name.split("/").pop()
  console.log(`Batch ${short}: ${state}, collecting`)
  // A failed job can still have answered some requests.
  if (output) {
    // A few at once: each mostly waits on the database, and a job brings in over a hundred.
    const busy = new Set<Promise<void>>()
    let failure: unknown
    for await (const result of paintBatchResults(output)) {
      const id = owner.get(result.key)
      if (!id || !left.has(result.key) || (!result.image && !result.error)) continue
      left.delete(result.key)
      const task: Promise<void> = bringIn(id, result)
        .catch((error) => void (failure ??= error))
        .finally(() => busy.delete(task))
      busy.add(task)
      if (busy.size >= COLLECT_PARALLEL) await Promise.race(busy)
      if (failure) break
    }
    await Promise.all(busy)
    if (failure) throw failure
  }

  const harvested = shares.some(({ job }) => job.harvest)
  const again = harvested && left.size ? await inputLines(input, left) : new Map<string, string>()
  const why = state === "failed" && !harvested ? `Batch job failed${error ? `: ${error}` : ""}` : "The batch job returned no image"
  const finishedAt = new Date().toISOString()
  for (const { set, job } of shares) {
    const resend = job.outputs.filter((o) => again.has(o))
    // What it delivered stays on the job; what goes out again moves to the next one.
    const kept = job.outputs.filter((o) => !resend.includes(o))
    await updateSet(set, (s) => {
      const outputs = s.outputs.map((o) =>
        !left.has(o.id) || o.job !== name
          ? o
          : resend.includes(o.id)
            ? { ...o, job: SENDING }
            : { ...o, status: "error" as const, job: undefined, error: why }
      )
      const jobs = (s.jobs ?? []).flatMap((j, i, all): PaintJob[] =>
        j.name !== name
          ? [j]
          : all.findIndex((k) => k.name === name) < i
            ? [] // a second entry for the job: its outputs are in `job`, so it goes
            : kept.length
            ? [{
                ...j,
                outputs: kept,
                status: state === "failed" && !harvested ? "error" : "done",
                finishedAt,
                ready: undefined,
                movedAt: undefined,
                harvest: undefined,
                ...(state === "failed" && !harvested && { error: why }),
              }]
            : []
      )
      return settled({ ...s, ...(resend.length && { status: "running" as const }), outputs, jobs })
    }).catch((error) => {
      if (!(error instanceof NotFoundError)) throw error
    })
    if (resend.length) send({ set, outputs: resend, lines: resend.map((o) => again.get(o)!) })
  }
  console.log(`Batch ${short}: ${owner.size - left.size} in, ${again.size} out again, ${left.size - again.size} failed`)
}

const COLLECT_PARALLEL = 4

async function bringIn(id: string, result: PaintResult) {
  try {
    if (result.image) {
      const stored = await store(id, `out-${result.key}`, result.image)
      await updateOutput(id, result.key, { ...stored.asset, job: undefined, error: undefined })
    } else {
      await updateOutput(id, result.key, { status: "error", job: undefined, error: result.error })
    }
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error // the set was deleted meanwhile
  }
}

/**
 * Everything open goes out in one batch job: running jobs end early (what
 * they painted comes in, the rest goes out again) and every failed image of
 * a poster set is tried again in batch. Answers how many of each.
 */
export async function sendAllOpen() {
  const jobs = await harvestAll()
  let retried = 0
  for (const set of await listSets()) {
    if (set.kind !== "poster") continue
    const failed = set.outputs.filter((o) => o.status === "error").length
    if (!failed) continue
    await retry(set.id, "batch")
    retried += failed
  }
  return { jobs, retried }
}

/** The outputs `batch` asks for, waiting for a brief. */
function expand(set: GenerationSet, batch: Batch): Output[] {
  const { options } = batch
  const now = new Date().toISOString()
  const base = { status: "pending" as const, file: null, batch: batch.id, review: null, createdAt: now }

  // More from one of our outputs: each new image starts from it (and its brief).
  if (options.from) {
    const from = set.outputs.find((o) => o.id === options.from)
    if (!from) return []
    const empty = options.variants.count + options.ideas.count === 0
    const variants = empty ? [from.creativity] : spread(options.variants.count, options.variants.creativity)
    const shared = { ...base, poster: from.poster, feedback: options.feedback, from: from.id }
    return [
      ...variants.map(
        (creativity): Output => ({
          ...shared,
          id: newId(),
          mode: from.mode,
          creativity,
          styleId: options.variants.styleId ?? from.styleId ?? null,
        })
      ),
      ...spread(options.ideas.count, options.ideas.creativity).map(
        (creativity): Output => ({ ...shared, id: newId(), mode: "idea", creativity })
      ),
    ]
  }

  // New ideas after approved outputs: one batch on the reference they share most.
  if (options.inspiration) {
    const picked = set.outputs.filter((o) => options.inspiration!.includes(o.id) && o.file)
    if (!picked.length) return []
    const poster = options.posters?.[0] ?? mostCommon(picked.map((o) => o.poster))
    return spread(options.ideas.count, options.ideas.creativity).map(
      (creativity): Output => ({
        ...base,
        id: newId(),
        poster,
        mode: "idea",
        creativity,
        feedback: options.feedback,
        inspiration: picked.map((o) => o.id),
      })
    )
  }

  const posters = set.posters.filter((p) => !options.posters || options.posters.includes(p.index))
  return posters.flatMap((p) => [
    ...spread(options.variants.count, options.variants.creativity).map(
      (creativity): Output => ({
        ...base,
        id: newId(),
        poster: p.index,
        mode: "variant",
        creativity,
        styleId: options.variants.styleId,
        feedback: options.feedback,
      })
    ),
    ...spread(options.ideas.count, options.ideas.creativity).map(
      (creativity): Output => ({
        ...base,
        id: newId(),
        poster: p.index,
        mode: "idea",
        creativity,
        feedback: options.feedback,
      })
    ),
  ])
}

const mostCommon = (values: number[]) =>
  values.reduce((best, v) => (values.filter((w) => w === v).length > values.filter((w) => w === best).length ? v : best))

/** The approved outputs `output` takes after, with images. */
const inspirationOf = (set: GenerationSet, output: Output) =>
  (output.inspiration ?? []).flatMap((id) => set.outputs.filter((o) => o.id === id && o.file))

/** Painting gets fewer inspiration images than planning: past a few they only blur the style. */
const PAINT_INSPIRATION = 4

type StyleRef = { guide: StyleGuide | null; images: Buffer[] }

async function loadStyle(styleId: string): Promise<StyleRef | null> {
  try {
    const style = await getStyle(styleId)
    return { guide: style.guide, images: await styleImages(styleId, 4) }
  } catch (error) {
    console.error(`Style ${styleId}:`, error)
    return null
  }
}

/** Writes briefs for every waiting output, one art-director call per poster, mode and style. */
async function plan(id: string) {
  const set = await getSet(id)
  const todo = set.outputs.filter((o) => o.status === "pending" && !o.brief)
  const groups = new Map<string, Output[]>()
  for (const o of todo) {
    const key = `${o.poster}|${o.mode}|${o.mode === "variant" ? (o.styleId ?? "") : ""}|${o.feedback ?? ""}|${o.from ?? ""}|${o.inspiration?.join(",") ?? ""}`
    groups.set(key, [...(groups.get(key) ?? []), o])
  }

  await Promise.all(
    [...groups.values()].map(async (outputs) => {
      const { poster: index, mode, styleId, feedback, from: fromId } = outputs[0]
      const p = set.posters.find((q) => q.index === index)
      if (!p?.file) return
      const style = mode === "variant" && styleId ? await loadStyle(styleId) : null
      const from = fromId ? set.outputs.find((o) => o.id === fromId) : undefined
      const inspiration = inspirationOf(set, outputs[0])
      const avoid = set.outputs
        .filter((o) => o.poster === index && o.mode === mode && o.brief && !todo.includes(o))
        .map((o) => `${o.title ?? ""}: ${o.brief}`)
      try {
        const briefs = await planBriefs(await readSetFile(id, p.file), {
          mode,
          levels: outputs.map((o) => o.creativity),
          analysis: p.analysis,
          title: set.source.title,
          style: style?.guide,
          feedback,
          avoid,
          base: from && {
            title: from.title ?? "Earlier poster",
            brief: from.brief ?? "(no brief kept — read it from the image)",
          },
          inspiration: inspiration.length
            ? inspiration.map((o) => ({ title: o.title ?? "Approved poster", brief: o.brief ?? "(read it from the image)" }))
            : undefined,
        }, from?.file
          ? [await readSetFile(id, from.file)]
          : await Promise.all(inspiration.map((o) => readSetFile(id, o.file!))))
        await updateSet(id, (s) => ({
          ...s,
          outputs: s.outputs.map((o) => {
            const i = outputs.findIndex((q) => q.id === o.id)
            return i < 0 ? o : { ...o, title: briefs[i].title, brief: briefs[i].brief }
          }),
        }))
      } catch (error) {
        // Painting still works from the plain level description.
        console.error(`Generation ${id}, planning:`, error)
      }
    })
  )
}

const PLAIN: Record<OutputMode, Record<Creativity, string>> = {
  variant: {
    minimal: "Very close to the reference: same subject, style, palette and layout, but with two or three subtle, visible changes in details — never an exact copy.",
    subtle: "Close to the reference: same subject, style, palette and layout, with a few small changes to the arrangement and one or two new details.",
    low: "Still close to the reference: same subject, style, palette and kind of layout, with one noticeable change to the arrangement or framing.",
    medium: "Same style and palette; the subject in a new composition and layout.",
    high: "Same style and palette; a bold, inventive composition and layout.",
  },
  idea: {
    minimal: "Keep the style, hook and scene; change one small detail.",
    subtle: "Keep the style and hook; change one thing about the scene slightly.",
    low: "Keep the style and hook; change one thing about the scene (character, place or prop).",
    medium: "Keep the style and hook; a new character in a new place.",
    high: "Keep the style and hook; a bold new scenario.",
  },
}

/** What Nano Banana is asked for one output: the prompt, the images it names, the shape. */
async function request(id: string, outputId: string, style: Promise<StyleRef | null>) {
  const set = await getSet(id)
  const current = set.outputs.find((o) => o.id === outputId)!
  const p = set.posters.find((q) => q.index === current.poster)
  if (!p?.file) throw new Error("Needs the extracted poster")
  const reference = await readSetFile(id, p.file)
  const ref = await style
  const moodboard = ref?.images ?? []
  const from = current.from ? set.outputs.find((o) => o.id === current.from) : null
  const previous = from?.file ? [await readSetFile(id, from.file)] : []
  const inspiration = await Promise.all(
    inspirationOf(set, current).slice(0, PAINT_INSPIRATION).map((o) => readSetFile(id, o.file!))
  )

  const prompt = paintPrompt({
    mode: current.mode,
    brief: current.brief ?? PLAIN[current.mode][current.creativity],
    style: ref?.guide,
    moodboard: moodboard.length,
    feedback: current.feedback,
    previous: previous.length > 0,
    inspiration: inspiration.length,
  })
  const aspect = p.width && p.height ? p.width / p.height : undefined
  return { prompt, images: [reference, ...moodboard, ...inspiration, ...previous], aspect }
}

async function draw(id: string, output: Output, style: Promise<StyleRef | null>) {
  await updateOutput(id, output.id, { status: "running", error: undefined })
  try {
    const { prompt, images, aspect } = await request(id, output.id, style)
    const image = await paint(prompt, images, aspect)
    const stored = await store(id, `out-${output.id}`, image)
    await updateOutput(id, output.id, { ...stored.asset })
  } catch (error) {
    if (error instanceof NotFoundError && error.message === "Unknown generation") throw error
    console.error(`Generation ${id}, output ${output.id}:`, error)
    await updateOutput(id, output.id, { status: "error", error: message(error) }).catch(() => {})
  }
}

async function mockup(set: GenerationSet) {
  const photo = await original(set)
  if (!photo) {
    await updateSet(set.id, (s) => ({
      ...s,
      mockup: { status: "error", file: null, error: "Needs the original photo" },
    }))
    return
  }
  if (set.mockup?.status === "done") return
  await updateSet(set.id, (s) => ({ ...s, mockup: { status: "running", file: null } }))
  try {
    const scene = await createSceneFromReference(mockupName(set.source.title), photo, {
      category: set.folder,
      source: set.source.shop ?? undefined,
    })
    const stored = await store(set.id, "mockup", await readSceneFile(scene.id, "background.jpg"))
    await updateSet(set.id, (s) => ({
      ...s,
      sceneId: scene.id,
      mockup: {
        ...stored.asset,
        note: scene.located ? undefined : "Couldn't find the sheet — set the four corners in the editor",
      },
    }))
  } catch (error) {
    await fail(set.id, "mockup", error)
  }
}

/** Saves an image (upright, at most 2400 px, JPEG) under a fresh name, so it can be cached for good. */
async function store(id: string, name: string, image: Buffer) {
  const { data, info } = await sharp(image)
    .rotate()
    .resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer({ resolveWithObject: true })
  const file = `${name}-${Date.now().toString(36)}.jpg`
  await saveFile(id, file, data)
  const asset: Asset = { status: "done", file, width: info.width, height: info.height }
  return { asset, data }
}

async function fail(id: string, key: "original" | "extraction" | "mockup", error: unknown) {
  if (error instanceof NotFoundError && error.message === "Unknown generation") throw error
  console.error(`Generation ${id}, ${key}:`, error)
  await updateSet(id, (s) => ({ ...s, [key]: { status: "error", file: null, error: message(error) } }))
}

/** Nothing can be drawn: every waiting output fails with `why`. */
function blockOutputs(id: string, why: string) {
  return updateSet(id, (s) => ({
    ...s,
    outputs: s.outputs.map((o) => (o.status === "done" ? o : { ...o, status: "error", error: why })),
  }))
}

const message = (error: unknown) => (error instanceof Error ? error.message : "Failed")

/** Etsy titles are keyword lists; the first phrase names the thing. */
function mockupName(title: string) {
  const first = title.split(/\s*[,|•·–—]\s*|\s+-\s+/)[0]?.trim()
  return (first || title).slice(0, 48)
}
