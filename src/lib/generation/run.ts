
import sharp from "sharp"

import { watchDoc } from "@/lib/db/documents"
import { exclusive } from "@/lib/db/sql"
import { googlePaused, GooglePausedError, PAUSE_KEY } from "@/lib/google/pause"
import { BLANK_PROMPT, blankAgainPrompt, paint } from "@/lib/mockups/gemini"
import { createSceneFromBlank, fetchReference, replaceBlank, roomFile } from "@/lib/mockups/reference"
import { getScene, NotFoundError, readSceneFile } from "@/lib/mockups/storage"
import { isLeader } from "@/lib/db/workers"
import {
  cancelPaintBatch,
  inputLines,
  type OpenJob,
  openPaintBatches,
  paintBatchResults,
  paintBatchState,
  paintLineNow,
  paintLines,
  type PaintResult,
  StayedBusyError,
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
  DEFAULT_OPTIONS,
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
  CANCELLED,
  SENDING,
} from "./types"

// Works through queued sets in the background, on the server that queued
// them. A set's finished parts are kept, so a retry only redoes what failed,
// and new batches only add images.

/** Sets worked on at once; how many images go to Vertex at a time is up to its gate in gemini.ts. */
const PARALLEL = 3

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
  if (pause.on) return
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

// --- Google paused ---

// While Google is paused (see google/pause.ts) nothing here starts a call to
// it: the queue, the online lane, the outbox and the batch poller wait, and
// what they hold stays as it is. Switched back on, on any server, they all go
// again. The poller reads the switch every pass too, should word get lost.
const pause = ((global as typeof global & { __googlePause?: { on: boolean } }).__googlePause ??= { on: false })

async function pausedNow() {
  const was = pause.on
  try {
    pause.on = await googlePaused()
  } catch {
    // The database is out of reach: keep what we knew.
  }
  if (was && !pause.on) resume()
  return pause.on
}

function resume() {
  pump()
  lane.pull()
  watchOutbox()
  kickBatches(0)
}

void pausedNow()
watchDoc(PAUSE_KEY, () => void pausedNow())

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
    // A mockup set's blank has no output until its photo is in.
    if (s.kind === "mockup" && !s.outputs.length) for (const b of s.batches) again.add(b.id)
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
 * A mockup set's blank painted again from its photo, `feedback` saying what
 * should be different, `delivery` now or in a batch job. The earlier blank
 * stays (the new one improves on it); the new one replaces it under the scene.
 */
export async function refreshMockup(id: string, feedback: string, delivery: Delivery) {
  const set = await updateSet(id, (s) => {
    if (s.kind !== "mockup") throw new Error("Only a mockup can be made again")
    if (s.status === "queued" || s.status === "running") throw new Error("It's being made already")
    const batch = s.batches[0]
    const before = s.outputs[0]
    if (!batch || !before) throw new Error("There's no mockup to make again")
    const output: Output = {
      ...before,
      id: newId(),
      status: "pending",
      file: null,
      error: undefined,
      job: undefined,
      feedback: feedback || undefined,
      from: before.status === "done" ? before.id : before.from,
      title: "Blank mockup, again",
      review: null,
      createdAt: new Date().toISOString(),
    }
    return {
      ...s,
      status: "queued",
      doneAt: undefined,
      stopping: undefined,
      mockup: { status: "pending", file: null },
      // The new one first (a mockup set's blank is its first output), and the one it improves on.
      outputs: [output, ...s.outputs.filter((o) => o.id === output.from)],
      batches: [{ ...batch, options: { ...batch.options, delivery } }, ...s.batches.slice(1)],
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
      mockup: s.mockup && stop(s.mockup),
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

/** Hands `outputs` to the online lane (see `send`), as the lines a batch job would read. */
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

// --- Online lane and batch outbox ---

// Vertex paints Nano Banana two ways, and neither keeps up on its own. Online
// its shared quota lets through an image a minute or so whatever we ask (10
// Oct: 64 at once painted no more than 32). Batch jobs paint a few a minute
// when they run, but some sit for hours without painting a thing (five sent
// at 14:01 had none by 19:00, while two sent at 16:40 painted 87 in 20 min).
// So outputs bound for batch go both ways, from the very lines a job would
// read (their images are in Cloud Storage, which online calls read too):
// `LANE_PARALLEL` painting online, the rest in batch jobs of `MAX_JOB`, and
// a job that's painted nothing for `STUCK` goes out again (see `follow`).
// Online, an output keeps `job: SENDING`, so a server that stops leaves it
// for the batch check to send again.

type Parcel = { set: string; outputs: string[]; lines: string[]; tries?: number }
type Errand = { set: string; output: string; line: string }
type Lane = {
  errands: Errand[]
  active: number
  painted: number
  failed: number
  /** Keeps the lane full from the outbox. */
  drain?: ReturnType<typeof setInterval>
  pull: () => void
}
const lane = ((global as typeof global & { __paintLane?: Lane }).__paintLane ??= {
  errands: [],
  active: 0,
  painted: 0,
  failed: 0,
  pull: () => {},
})
// Was 24; kept low since Google suspended an account over request bursts (11 Oct).
const LANE_PARALLEL = 2

/** Online while the lane has room; the rest waits in the outbox for a batch job (or room in the lane). */
function send(parcel: Parcel) {
  const room = Math.max(0, LANE_PARALLEL - lane.active - lane.errands.length)
  parcel.outputs.slice(0, room).forEach((output, i) => lane.errands.push({ set: parcel.set, output, line: parcel.lines[i] }))
  if (parcel.outputs.length > room) {
    toOutbox({ ...parcel, outputs: parcel.outputs.slice(room), lines: parcel.lines.slice(room) })
  }
  pumpLane()
}

function pumpLane() {
  if (pause.on) return
  while (lane.active < LANE_PARALLEL && lane.errands.length) {
    const errand = lane.errands.shift()!
    lane.active++
    void paintErrand(errand).finally(() => {
      lane.active--
      pumpLane()
    })
  }
}

/** Room in the lane is filled from the outbox, before its next job goes. */
lane.pull = () => {
  // Errands past the lane's room (from before it had one) wait for batch.
  const extra = lane.errands.splice(Math.max(0, LANE_PARALLEL - lane.active))
  for (const e of extra) toOutbox({ set: e.set, outputs: [e.output], lines: [e.line] })
  while (lane.active + lane.errands.length < LANE_PARALLEL && outbox.parcels.length) {
    const p = outbox.parcels[0]
    lane.errands.push({ set: p.set, output: p.outputs.shift()!, line: p.lines.shift()! })
    if (!p.outputs.length) outbox.parcels.shift()
  }
  pumpLane()
}
lane.drain ??= setInterval(() => lane.pull(), 2_000)
lane.drain.unref?.()

type Outbox = {
  parcels: Parcel[]
  first: number
  last: number
  timer: ReturnType<typeof setTimeout> | null
  /** After a job failed to start, the next try waits until then. */
  notBefore?: number
}
const outbox = ((global as typeof global & { __batchOutbox?: Outbox }).__batchOutbox ??= {
  parcels: [],
  first: 0,
  last: 0,
  timer: null,
})
// Held back for good by the code before this; it sends again.
if (outbox.notBefore === Number.MAX_SAFE_INTEGER) outbox.notBefore = 0
/** Tries a job gets to go out, a few minutes apart: Vertex may be refusing more jobs while many run. */
const SEND_TRIES = 30

/** How long the outbox waits for more at most, so a job's minute or two to start is shared. */
const GATHER = 60_000

function toOutbox(parcel: Parcel) {
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
      const allowed = Date.now() >= (outbox.notBefore ?? 0) && !pause.on
      const quiet = Date.now() - outbox.last > 5_000 && queue.running.size === 0 && queue.waiting.length === 0
      if (allowed && (quiet || Date.now() - outbox.first > GATHER)) await sendOut()
    } catch (error) {
      console.error("Batch outbox:", error)
    }
    if (outbox.parcels.length) watchOutbox()
  }, 2_000)
}

/**
 * Requests in one job at most. Vertex works through a job in parts, and
 * several small jobs side by side paint more than one big one (jobs of 5
 * next to one of 20 painted 13 images to its 1, 10 Oct); a job that sticks
 * also holds fewer images back.
 */
const MAX_JOB = 10

/**
 * Batch jobs running at once at most, across all sets. 44 sent within five
 * minutes on 10 Oct were followed by Google suspending the account; what
 * doesn't fit waits in the outbox until a job ends.
 */
const MAX_RUNNING_JOBS = 3

/** What's in the outbox, in jobs of `MAX_JOB` at most, as many as `MAX_RUNNING_JOBS` leaves room for. */
async function sendOut() {
  const running = new Set(
    (await listSets()).flatMap((s) => (s.jobs ?? []).filter((j) => j.status === "running").map((j) => j.name))
  ).size
  const room = MAX_RUNNING_JOBS - running
  if (room <= 0) {
    outbox.notBefore = Date.now() + 60_000
    return
  }
  const all = outbox.parcels.splice(0)
  const jobs: Parcel[][] = []
  while (all.length && jobs.length < room) {
    let size = 0
    const count = all.findIndex((p) => (size += p.lines.length) > MAX_JOB)
    jobs.push(all.splice(0, count < 0 ? all.length : Math.max(count, 1)))
  }
  // The rest waits its turn.
  if (all.length) {
    outbox.parcels.unshift(...all)
    outbox.notBefore = Date.now() + 60_000
  }
  await Promise.all(jobs.map(sendJob))
}

async function sendJob(parcels: Parcel[]) {
  const size = parcels.reduce((n, p) => n + p.lines.length, 0)
  let name: string
  try {
    name = await startPaintBatch(`batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, parcels.flatMap((p) => p.lines))
  } catch (error) {
    const tries = (parcels[0].tries ?? 0) + 1
    console.error(`Batch job (try ${tries} of ${SEND_TRIES}):`, error)
    if (tries < SEND_TRIES) {
      // Back in the outbox, for a try a little later.
      outbox.parcels.unshift(...parcels.map((p) => ({ ...p, tries })))
      outbox.first = Math.min(outbox.first || Date.now(), Date.now())
      outbox.notBefore = Date.now() + Math.min(tries, 3) * 60_000
      watchOutbox()
      return
    }
    for (const p of parcels) {
      const after = await updateSet(p.set, (s) =>
        settled({
          ...s,
          outputs: s.outputs.map((o) =>
            p.outputs.includes(o.id) && o.job === SENDING
              ? { ...o, status: "error", job: undefined, error: message(error) }
              : o
          ),
        })
      ).catch(() => null)
      if (after?.status === "queued") enqueue(p.set)
    }
    return
  }
  const submittedAt = new Date().toISOString()
  // A set can have several parcels; it gets one entry for the job.
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

async function paintErrand({ set, output, line }: Errand) {
  let result: PaintResult
  try {
    result = await paintLineNow(line)
  } catch (error) {
    // Vertex stayed busy all along, or Google was paused meanwhile: a batch job takes it.
    if (error instanceof StayedBusyError || error instanceof GooglePausedError) {
      return toOutbox({ set, outputs: [output], lines: [line] })
    }
    result = { key: output, error: message(error) }
  }
  if (result.image) lane.painted++
  else lane.failed++
  try {
    await bringIn(set, { ...result, key: output, error: result.image ? undefined : (result.error ?? "No image") })
    const after = await updateSet(set, settled)
    if (after.status === "queued") enqueue(set)
  } catch (error) {
    if (!(error instanceof NotFoundError)) console.error(`Generation ${set}, output ${output}:`, error)
  }
}


/**
 * The set as it stands once nothing in it is drawing any more. A mockup set
 * then goes back in line, to make its scene from its blank (or say why not):
 * whoever settles it queues it.
 */
function settled(s: GenerationSet): GenerationSet {
  const busy = s.status === "queued" || s.outputs.some((o) => o.status === "pending" || o.status === "running")
  if (busy) return s
  if (s.kind === "mockup" && s.mockup?.status === "running") return { ...s, status: "queued" }
  return { ...s, status: failed(s) ? "error" : "done" }
}

// --- Batch jobs ---

/** How often running batch jobs are asked after. */
const BATCH_POLL = 30_000

/**
 * Vertex only hands a job's images over when it ends, and a few slow
 * requests hold up all of them; so a job that's painted some and then
 * nothing for `STALL` is ended, its images come in and the rest goes
 * straight out again. One still painting goes on: a new job waits for
 * capacity and starts over, so ending it early costs more than it brings —
 * but after `HARVEST_MAX` what it has comes in anyway.
 */
const HARVEST_AFTER = 10 * 60_000
const STALL = 4 * 60_000
const HARVEST_MAX = 2 * 60 * 60_000
/**
 * A job that's painted nothing this long has stuck (some sit for hours
 * while jobs sent after them paint): it's ended and goes out again.
 */
const STUCK = 20 * 60_000
/** How often a running job's progress is written to its sets at most. */
const PROGRESS_EVERY = 60_000

// The leader asks all the time; a server that just submitted a job asks until
// its jobs are through. A lock per job keeps two from collecting the same one.
type Poller = {
  timer: ReturnType<typeof setTimeout> | null
  ticking: boolean
  steady: boolean
  tick: () => Promise<void>
  /** Counts passes; one the watchdog gave up on sees it's no longer the current one. */
  pass: number
  /** When the poller last got anywhere: a pass starting or ending, a job asked after, an image brought in. */
  beat: number
  watchdog: ReturnType<typeof setInterval> | null
  check: () => Promise<void>
  /** What the current pass is at, so a hang says where. */
  doing: string
  /** What the last check found wrong and put right, newest last. */
  problems: { at: string; problem: string }[]
  checkedAt: number
}
const batches = ((global as typeof global & { __batchPoller?: Poller }).__batchPoller ??= {
  timer: null,
  ticking: false,
  steady: false,
  tick: async () => {},
  pass: 0,
  beat: 0,
  watchdog: null,
  check: async () => {},
  doing: "",
  problems: [],
  checkedAt: 0,
})
// Created before these were fields: a dev reload keeps the old object.
batches.pass ??= 0
batches.problems ??= []

/** Keeps asking after batch jobs (on the leader; see instrumentation-node.ts), and checks on that. */
export function startBatches() {
  batches.steady = true
  kickBatches(0)
  batches.watchdog ??= setInterval(() => void batches.check(), CHECK_EVERY)
  batches.watchdog.unref?.()
}

export function kickBatches(ms = 5_000) {
  if (batches.timer) clearTimeout(batches.timer)
  batches.timer = setTimeout(() => {
    batches.timer = null
    void batches.tick()
  }, ms)
}

/** A set's share of a job; `waiting`, its outputs the job hasn't brought in yet. */
type Share = { set: string; job: PaintJob; waiting: string[] }

async function pollBatches() {
  if (batches.ticking) return
  // Paused: ask again later, so the watchdog doesn't take it for stopped.
  if (await pausedNow()) return void kickBatches(BATCH_POLL)
  batches.ticking = true
  const pass = ++batches.pass
  batches.beat = Date.now()
  batches.doing = "listing sets"
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
        else {
          // What a collect cut short already brought in isn't brought in twice.
          const waiting = set.outputs.filter((o) => o.job === job.name).map((o) => o.id)
          jobs.set(job.name, [...shares, { set: set.id, job, waiting }])
        }
      }
    }
    for (const [name, shares] of jobs) {
      if (pass !== batches.pass) return // the watchdog gave up on this pass
      more = true
      batches.beat = Date.now()
      const short = name.split("/").pop()
      batches.doing = `waiting for the lock on ${short}`
      await exclusive(`batch:${name}`, () => {
        batches.doing = `asking Vertex about ${short}`
        return follow(name, shares)
      }).catch((error) => console.error(`Batch ${name}:`, error))
    }
  } finally {
    if (pass === batches.pass) {
      batches.ticking = false
      batches.beat = Date.now()
      batches.doing = ""
      if (more || batches.steady) kickBatches(BATCH_POLL)
    }
  }
}

// The newest code's pass: a reload during development swaps it in.
batches.tick = pollBatches

/** How often the leader checks that batch work isn't stuck, and puts it right. */
const CHECK_EVERY = 2 * 60_000
/** A pass that's got nowhere for this long has hung. */
const HUNG = 10 * 60_000
/** A job no set knows, this old, was started by a server that stopped before writing it down. */
const ORPHAN_AGE = 3 * 60_000

/**
 * The watchdog: polling that hung or stopped starts again; a job Vertex
 * paints that no set knows of gets its images back (else it's cancelled, so
 * it costs nothing); images a stopped server still had to send go out again.
 */
async function checkBatches() {
  if (!(await isLeader()) || (await pausedNow())) return
  batches.checkedAt = Date.now()
  const found = (problem: string) => {
    console.warn(`Batch check: ${problem}`)
    batches.problems = [...batches.problems, { at: new Date().toISOString(), problem }].slice(-20)
  }
  try {
    const idle = Date.now() - batches.beat
    if (batches.ticking && idle > HUNG) {
      found(`polling got nowhere for ${Math.round(idle / 60_000)} min (${batches.doing || "?"}): started again`)
      batches.pass++
      batches.ticking = false
      kickBatches(0)
    } else if (!batches.ticking && !batches.timer) {
      found("polling had stopped: started again")
      kickBatches(0)
    }

    let sets = await listSets()
    const known = new Set(sets.flatMap((s) => (s.jobs ?? []).map((j) => j.name)))
    const open = await openPaintBatches()
    // Cancelled here while Google was out of reach: cancelled at Vertex too, now it's back.
    const dropped = new Set(sets.flatMap((s) => (s.jobs ?? []).filter((j) => j.cancelled && j.status !== "running").map((j) => j.name)))
    for (const job of open.filter((j) => dropped.has(j.name))) {
      await cancelPaintBatch(job.name)
      found(`job ${job.name.split("/").pop()} was cancelled by hand: cancelled at Vertex too`)
    }
    const unknown = open.filter((j) => j.displayName.startsWith("batch-") && !known.has(j.name))
    for (const job of unknown) {
      if (Date.now() - Date.parse(job.createdAt) < ORPHAN_AGE) continue
      const took = await adopt(job, sets)
      const short = job.name.split("/").pop()
      if (took) found(`job ${short} wasn't written down: its ${took} images were taken back`)
      else {
        await cancelPaintBatch(job.name)
        found(`job ${short} belonged to no images: cancelled`)
      }
      sets = await listSets()
    }

    // Until every unknown job is adopted, its images might be among these.
    if (unknown.length) return
    for (const set of sets) {
      const lost = set.outputs.filter((o) => o.status === "error" && o.job === SENDING).map((o) => o.id)
      if (!lost.length) continue
      found(`${lost.length} images of ${set.id} were waiting to go out on a server that stopped: sent again`)
      await updateSet(set.id, (s) => ({
        ...s,
        status: "queued",
        doneAt: undefined,
        outputs: s.outputs.map((o) =>
          lost.includes(o.id) ? { ...o, status: "pending", job: undefined, error: undefined } : o
        ),
      }))
      enqueue(set.id)
    }
  } catch (error) {
    console.error("Batch check:", error)
  }
}

batches.check = checkBatches

/** Puts the images `job` paints back on their outputs; answers how many. */
async function adopt(job: OpenJob, sets: GenerationSet[]) {
  const keys = new Set((await inputLines(job.input)).keys())
  const open = (o: Output) => keys.has(o.id) && o.status !== "done" && (!o.job || o.job === SENDING)
  let took = 0
  for (const set of sets) {
    if (!set.outputs.some(open)) continue
    await updateSet(set.id, (s) => {
      const ids = s.outputs.filter(open).map((o) => o.id)
      took += ids.length
      const entry: PaintJob = { name: job.name, outputs: ids, submittedAt: job.createdAt, status: "running", size: keys.size }
      return {
        ...s,
        status: "running",
        jobs: [...(s.jobs ?? []), entry],
        outputs: s.outputs.map((o) => (ids.includes(o.id) ? { ...o, status: "running", error: undefined, job: job.name } : o)),
      }
    })
  }
  if (took) kickBatches()
  return took
}

/** How batch work stands on this server, for a look from outside. */
export function batchHealth() {
  const ago = (at: number) => (at ? Math.round((Date.now() - at) / 1000) : null)
  return {
    polling: !batches.steady ? "not on this server" : batches.ticking ? `busy: ${batches.doing}` : "waiting",
    lastProgressSecondsAgo: ago(batches.beat),
    lastCheckSecondsAgo: ago(batches.checkedAt),
    lane: { waiting: lane.errands.length, painting: lane.active, painted: lane.painted, failed: lane.failed },
    waitingToGoOut: outbox.parcels.reduce((n, p) => n + p.outputs.length, 0),
    problems: batches.problems,
  }
}

/** Brings a finished job's images in; one still going is noted, and ended early once it's held its images long enough. */
async function follow(name: string, shares: Share[]) {
  const state = await paintBatchState(name)
  if (state.state !== "running") return collect(name, shares, state)

  const { job } = shares[0]
  // Ended early, but the cancel didn't get through: again.
  if (job.harvest) return void (await cancelPaintBatch(name).catch(() => {}))
  const now = Date.now()
  const age = now - Date.parse(job.submittedAt)
  const moved = state.ready !== (job.ready ?? 0)
  const movedAt = moved ? new Date(now).toISOString() : (job.movedAt ?? job.submittedAt)
  const due =
    !job.harvest &&
    state.ready < state.total &&
    (state.ready > 0
      ? age >= HARVEST_AFTER && (now - Date.parse(movedAt) >= STALL || age >= HARVEST_MAX)
      : age >= STUCK)
  // Every set is written on each change, so a fast job's progress goes out once a minute.
  const recent = now - Date.parse(job.movedAt ?? job.submittedAt) < PROGRESS_EVERY
  if (!due && (!moved || recent) && job.size === state.total) return
  batches.doing = `writing how ${name.split("/").pop()} stands`
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

/**
 * Ends every running job and sends what it holds out again (see `send`): a
 * job that's painted nothing hands its outputs over at once; one that has
 * is ended early (see `HARVEST_AFTER`), and once its images are in the rest
 * goes. Answers how many jobs.
 */
async function laneJobs() {
  const jobs = new Map<string, Share[]>()
  for (const set of await listSets()) {
    for (const job of set.jobs ?? []) {
      if (job.status !== "running") continue
      const waiting = set.outputs.filter((o) => o.job === job.name).map((o) => o.id)
      jobs.set(job.name, [...(jobs.get(job.name) ?? []).filter((s) => s.set !== set.id), { set: set.id, job, waiting }])
    }
  }
  await Promise.all(
    [...jobs].map(async ([name, shares]) => {
      try {
        // Null: being collected right now, which sends its rest out again anyway.
        const outcome = (await exclusive(`batch:${name}`, () => handOver(name, shares))) ?? "being collected"
        console.log(`Batch ${name.split("/").pop()}: ${outcome}`)
      } catch (error) {
        console.error(`Batch ${name}, sending again:`, error)
      }
    })
  )
  kickBatches(15_000)
  return jobs.size
}

async function handOver(name: string, shares: Share[]) {
  const state = await paintBatchState(name)
  if (state.state !== "running") return state.state // the poller brings it in
  if (state.ready > 0) {
    await eachShare(shares, name, (j) => ({ ...j, harvest: true }))
    await cancelPaintBatch(name)
    return "ended early"
  }
  // Cancelled first, so the batch check can't take it for one no set knows meanwhile.
  await cancelPaintBatch(name).catch((error) => console.error(`Batch ${name}, cancel:`, error))
  const lines = await inputLines(state.input, new Set(shares.flatMap((s) => s.waiting)))
  for (const { set, waiting } of shares) {
    const moving = waiting.filter((o) => lines.has(o))
    await updateSet(set, (s) =>
      settled({
        ...s,
        outputs: s.outputs.map((o) =>
          o.job !== name
            ? o
            : moving.includes(o.id)
              ? { ...o, job: SENDING }
              : { ...o, status: "error" as const, job: undefined, error: "The batch job lost it" }
        ),
        jobs: (s.jobs ?? []).filter((j) => j.name !== name),
      })
    ).catch((error) => {
      if (!(error instanceof NotFoundError)) throw error
    })
    if (moving.length) send({ set, outputs: moving, lines: moving.map((o) => lines.get(o)!) })
  }
  return `${lines.size} sent again`
}

function eachShare(shares: Pick<Share, "set">[], name: string, change: (job: PaintJob) => PaintJob) {
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
  const owner = new Map(shares.flatMap(({ set, waiting }) => waiting.map((o) => [o, set] as const)))
  const left = new Set(owner.keys())
  const short = name.split("/").pop()
  const ended = state === "failed" && shares.some(({ job }) => job.harvest) ? "ended early" : state
  console.log(`Batch ${short}: ${ended}, collecting`)
  batches.doing = `collecting ${short}`
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
        .finally(() => {
          busy.delete(task)
          batches.beat = Date.now()
        })
      busy.add(task)
      if (busy.size >= COLLECT_PARALLEL) await Promise.race(busy)
      if (failure) break
    }
    await Promise.all(busy)
    if (failure) throw failure
  }

  const harvested = shares.some(({ job }) => job.harvest)
  // Cancelled by hand: what it didn't get to is dropped, not sent again.
  const cancelled = shares.some(({ job }) => job.cancelled)
  const again = harvested && !cancelled && left.size ? await inputLines(input, left) : new Map<string, string>()
  const why = cancelled
    ? CANCELLED
    : state === "failed" && !harvested
      ? `Batch job failed${error ? `: ${error}` : ""}`
      : "The batch job returned no image"
  const finishedAt = new Date().toISOString()
  for (const { set, job } of shares) {
    const resend = job.outputs.filter((o) => again.has(o))
    // What it delivered stays on the job; what goes out again moves to the next one.
    const kept = job.outputs.filter((o) => !resend.includes(o))
    const after = await updateSet(set, (s) => {
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
                status: state === "failed" && !harvested && !cancelled ? "error" : "done",
                finishedAt,
                ready: undefined,
                movedAt: undefined,
                harvest: undefined,
                ...(state === "failed" && !harvested && !cancelled && { error: why }),
              }]
            : []
      )
      return settled({ ...s, ...(resend.length && { status: "running" as const }), outputs, jobs })
    }).catch((error) => {
      if (!(error instanceof NotFoundError)) throw error
      return null
    })
    if (after?.status === "queued") enqueue(set)
    if (resend.length) send({ set, outputs: resend, lines: resend.map((o) => again.get(o)!) })
  }
  // How long a job of this size took, to tune `MAX_JOB` by.
  const minutes = Math.round((Date.now() - Date.parse(shares[0].job.submittedAt)) / 60_000)
  console.log(
    `Batch ${short}: ${owner.size - left.size} in, ${again.size} out again, ${left.size - again.size} failed` +
      ` (${shares[0].job.size ?? "?"} requests, ${minutes} min after it went out)`
  )
}

const COLLECT_PARALLEL = 6

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
 * Everything open goes out again, online and in fresh batch jobs: running
 * jobs end early (what they painted comes in, the rest goes out again) and
 * every failed image (a poster or a blank mockup) is tried again in batch.
 * Answers how many of each.
 */
export async function sendAllOpen() {
  const jobs = await laneJobs()
  let retried = 0
  for (const set of await listSets()) {
    const failed = set.outputs.filter((o) => o.status === "error").length
    if (!failed) continue
    await retry(set.id, "batch")
    retried += failed
  }
  return { jobs, retried }
}

/**
 * Ends batch jobs for good: every running one, or those `names` lists. What
 * Vertex has painted still comes in; the rest is dropped as `CANCELLED`, to
 * be asked for again with a retry. While Google is paused or out of reach the
 * jobs end here at once and nothing more comes in; the batch check cancels
 * them at Vertex too once it can. Answers how many jobs.
 */
export async function cancelJobs(names?: string[]) {
  const jobs = new Map<string, Share[]>()
  for (const set of await listSets()) {
    for (const job of set.jobs ?? []) {
      if (job.status !== "running" || (names && !names.includes(job.name))) continue
      const waiting = set.outputs.filter((o) => o.job === job.name).map((o) => o.id)
      jobs.set(job.name, [...(jobs.get(job.name) ?? []).filter((s) => s.set !== set.id), { set: set.id, job, waiting }])
    }
  }
  for (const [name, shares] of jobs) {
    const outcome = (await exclusive(`batch:${name}`, () => endJob(name, shares))) ?? "being collected"
    console.log(`Batch ${name.split("/").pop()}: cancelled, ${outcome}`)
  }
  return jobs.size
}

async function endJob(name: string, shares: Share[]) {
  let state: Awaited<ReturnType<typeof paintBatchState>>
  try {
    if (await pausedNow()) throw new GooglePausedError()
    state = await paintBatchState(name)
  } catch {
    await dropJob(name, shares)
    return "dropped here"
  }
  const painted = state.state === "running" && state.ready > 0
  await eachShare(shares, name, (j) => ({ ...j, cancelled: true, ...(painted && { harvest: true }) }))
  if (state.state === "running") {
    await cancelPaintBatch(name).catch((error) => console.error(`Batch ${name}, cancel:`, error))
    if (!painted) {
      await dropJob(name, shares)
      return "nothing painted, dropped"
    }
  }
  // Ended: the poller brings in what it painted and drops the rest.
  kickBatches(15_000)
  return `${state.ready} painted, coming in`
}

/** The job ends here: its outputs not in yet fail as `CANCELLED`; it stays listed, so the batch check can cancel it at Vertex. */
async function dropJob(name: string, shares: Share[]) {
  const finishedAt = new Date().toISOString()
  for (const { set } of shares) {
    const after = await updateSet(set, (s) =>
      settled({
        ...s,
        outputs: s.outputs.map((o) =>
          o.job === name && o.status !== "done" ? { ...o, status: "error" as const, job: undefined, error: CANCELLED } : o
        ),
        jobs: (s.jobs ?? []).map((j) =>
          j.name !== name
            ? j
            : {
                ...j,
                status: "error" as const,
                error: CANCELLED,
                cancelled: true,
                finishedAt,
                ready: undefined,
                movedAt: undefined,
                harvest: undefined,
              }
        ),
      })
    ).catch((error) => {
      if (!(error instanceof NotFoundError)) throw error
      return null
    })
    if (after?.status === "queued") enqueue(set)
  }
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
  // A mockup set's one output: its photo with blank frames.
  if (set.kind === "mockup") {
    const photo = await readSetFile(id, set.original.file!)
    const current = set.outputs.find((o) => o.id === outputId)
    if (!current?.from && !current?.feedback) return { prompt: BLANK_PROMPT, images: [photo] }
    // Made again (see `refreshMockup`): the earlier blank shows what to improve on.
    const from = set.outputs.find((o) => o.id === current.from)
    const previous = from?.file ? [await readSetFile(id, from.file)] : []
    return { prompt: blankAgainPrompt(current.feedback, previous.length > 0), images: [photo, ...previous] }
  }
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

  // The photo redrawn with blank frames is the set's one output, painted now
  // or in a batch job (see `request`); the scene is made from it once it's in.
  const ready = await updateSet(set.id, (s) => ({ ...s, mockup: { status: "running", file: null }, ...blankOutput(s) }))
  let blank = ready.outputs[0]
  if (blank.status === "pending" && !blank.job) {
    const none = () => Promise.resolve(null)
    if (ready.batches.find((b) => b.id === blank.batch)?.options.delivery === "batch") await submit(set.id, [blank], none)
    else await draw(set.id, blank, none())
    blank = (await getSet(set.id)).outputs[0]
  }
  if (blank.job) return // in a batch job: the set runs again once it's back (see `settled`)
  if (blank.status !== "done") {
    await updateSet(set.id, (s) => ({ ...s, mockup: { status: "error", file: null, error: blank.error ?? "No blank mockup" } }))
    return
  }

  try {
    const image = await readSetFile(set.id, blank.file!)
    // Made again: the new blank goes under the scene there is, unless it's been deleted.
    const there = set.sceneId && (await getScene(set.sceneId).catch(() => null))
    const scene = there
      ? await replaceBlank(there.id, image)
      : await createSceneFromBlank(mockupName(set.source.title), image, {
          category: set.folder,
          shop: set.source.shop ?? undefined,
        })
    const stored = await store(set.id, "mockup", await readSceneFile(scene.id, roomFile(scene)))
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

/** A mockup set's blank, waiting to be painted; sets from before it get a batch (painted now) to hang it on. */
function blankOutput(s: GenerationSet): Partial<GenerationSet> {
  if (s.outputs.length) return {}
  const now = new Date().toISOString()
  const batch: Batch = s.batches[0] ?? { id: newId(), options: DEFAULT_OPTIONS, createdAt: now, expanded: false }
  const output: Output = {
    id: newId(),
    status: "pending",
    file: null,
    poster: 0,
    batch: batch.id,
    mode: "variant",
    creativity: "minimal",
    title: "Blank mockup",
    review: null,
    createdAt: now,
  }
  return { batches: [{ ...batch, expanded: true }], outputs: [output] }
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
