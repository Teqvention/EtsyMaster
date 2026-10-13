
import sharp from "sharp"

import { watchDoc } from "@/lib/db/documents"
import { claim, type Claim, exclusive } from "@/lib/db/sql"
import { paceState } from "@/lib/google/pace"
import { googlePaused, GooglePausedError, heldBackByGoogle, PAUSE_KEY, wrong } from "@/lib/google/pause"
import { BLANK_PROMPT, blankAgainPrompt, FALLBACK_MODEL, paint, PAINT_MODEL, StayedBusyError } from "@/lib/mockups/gemini"
import { createSceneFromBlank, fetchReference, replaceBlank, roomFile } from "@/lib/mockups/reference"
import { getScene, NotFoundError, readSceneFile } from "@/lib/mockups/storage"
import { instanceId, isLeader } from "@/lib/db/workers"
import {
  type Attempt,
  BLOCKED,
  batchConfigured,
  cancelPaintBatch,
  GoogleError,
  inputLines,
  type OpenJob,
  openPaintBatches,
  paintBatchResults,
  paintBatchState,
  paintLineOnce,
  paintLines,
  type PaintResult,
  startPaintBatch,
} from "@/lib/mockups/vertex-batch"
import { cityRequest, cityWork, isCitySet } from "@/lib/citys/generate"
import { autoRequest, expandAuto, planAuto, prepareAuto } from "@/lib/styles/auto"
import { reviewAuto } from "@/lib/styles/auto-check"
import { getStyle, styleImages } from "@/lib/styles/storage"
import type { StyleGuide } from "@/lib/styles/types"

import { analysePoster, ANALYSIS_VERSION, extractPosters } from "./poster"
import { paintPrompt, planBriefs } from "./prompts"
import {
  deleteSet,
  getSet,
  INTERRUPTED,
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
  isFailedImage,
  resetOf,
  SENDING,
  STOPPED,
  worthRetrying,
} from "./types"

// Works through queued sets in the background, on the server that queued
// them. A set's finished parts are kept, so a retry only redoes what failed,
// and new batches only add images.

/**
 * Sets worked on at once (finding posters, writing briefs: Gemini Flash,
 * which has room to spare); painting is up to the lane and the batch outbox.
 * A thousand images (a hundred sets) are ready to go in about twenty minutes.
 */
const PARALLEL = 6

/**
 * `started`: when each running set's run began and its token, so a run
 * that hangs (a call on a connection the network took that never answers:
 * 13 Oct, sets stuck "running" for hours) can be let go of, and its late
 * end never clears a newer run of the same set.
 */
type Queue = { waiting: string[]; running: Set<string>; started: Map<string, { at: number; token: number }>; tokens: number }
// On globalThis, so every route (and a dev reload) shares the one queue.
const global = globalThis as typeof globalThis & { __generationRunner?: Queue }
const queue: Queue = (global.__generationRunner ??= { waiting: [], running: new Set(), started: new Map(), tokens: 0 })
// Made before these were fields: a dev reload keeps the old object.
queue.started ??= new Map()
queue.tokens ??= 0

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
    const token = ++queue.tokens
    queue.running.add(id)
    queue.started.set(id, { at: Date.now(), token })
    run(id).finally(() => {
      // Let go of already (it hung): a newer run of the set is its own.
      if (queue.started.get(id)?.token === token) {
        queue.running.delete(id)
        queue.started.delete(id)
      }
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
  void healer.pass()
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
      // Asked for again by hand: it may heal itself again as often as a new one.
      heals: 0,
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
      heals: 0,
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
    return { ...s, status: "queued", batches: [...s.batches, batch], doneAt: undefined, stopping: undefined, heals: 0 }
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
    return { ...next, status: s.outputs.some(painting) ? "running" : "error" }
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
    // City posters plan and paint their own way (citys/generate.ts), through the same lane and batch jobs.
    if (isCitySet(set)) {
      const none = () => Promise.resolve(null)
      await cityWork(id, {
        // Now images go the lane's way too, paced and with the fallback, overflowing into a batch job.
        submit: (setId, outputs, now) =>
          batchConfigured()
            ? submit(setId, outputs, none, now)
            : Promise.all(outputs.map((o) => draw(setId, o, none()))).then(() => {}),
        halt,
      })
    } else if (set.kind === "poster") await poster(id)
    else await mockup(set)
    // Images still painting (online in the lane, or in a batch job) keep the
    // set going; whoever brings the last one in finishes it (see `settled`).
    await updateSet(id, (s) => ({
      ...s,
      stopping: undefined,
      status: s.outputs.some(painting) ? "running" : failed(s) ? "error" : "done",
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

/** Being painted: online in the lane, or waiting for or in a batch job. */
const painting = (o: Output) => o.status === "running" || !!o.job

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

  // A style's Autonomous scale set: its posters are the board's, described by the style's study.
  if (set.style) {
    try {
      await prepareAuto(id)
    } catch (error) {
      console.error(`Generation ${id}, studying the style:`, error)
      return blockOutputs(id, `Couldn't study the style: ${message(error)}`)
    }
  }

  // 2. What each one is (best effort: prompts work without it, just less well).
  set = await getSet(id)
  await Promise.all(
    set.posters
      // An older reading is done again: its words steer every brief.
      .filter((p) => !p.analysis || (p.analysis.version ?? 1) < ANALYSIS_VERSION)
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

  // 4. A brief for each, then the painting: online (now), or in a batch job.
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
  // Waiting outputs with a brief (`only` of them, if given) go out.
  const dispatch = async (only?: string[]) => {
    const current = await getSet(id)
    const delivery = new Map(current.batches.map((b) => [b.id, b.options.delivery ?? "now"]))
    const waiting = current.outputs.filter(
      (o) => o.status === "pending" && (!only || only.includes(o.id)) && !(o.auto && !o.brief)
    )
    const batched = waiting.filter((o) => delivery.get(o.batch) === "batch")
    const now = waiting.filter((o) => !batched.includes(o))
    await Promise.all([
      // Through the online lane, which sends what it can't get to soon to a batch
      // job; drawn here only where there's no batch bucket for that.
      ...(batchConfigured() ? [now.length ? submit(id, now, styleOf, true) : null] : now.map((o) => draw(id, o, styleOf(o)))),
      batched.length ? submit(id, batched, styleOf) : null,
    ])
  }
  // Autonomous scale plans a few posters at a time; each few go out once planned.
  if (set.style) await planAuto(id, dispatch)
  await dispatch()
}

/**
 * Hands `outputs` on as the lines a batch job would read: "now" ones (`now`)
 * to the online lane as far as it gets to them soon, the rest to the batch
 * outbox (see `send`).
 */
async function submit(id: string, outputs: Output[], styleOf: (o: Output) => Promise<StyleRef | null>, now = false) {
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
    // "now" images the lane takes on are just running (taken on at once, so sets
    // handing images over side by side don't overfill it); the others wait for a batch job.
    const online = now ? Math.min(ids.length, nowRoom()) : 0
    for (let i = 0; i < online; i++) lane.errands.push(errand(id, ids[i], lines[i], true))
    pumpLane()
    const bound = ids.slice(online)
    if (!bound.length) return
    await updateSet(id, (s) => ({
      ...s,
      outputs: s.outputs.map((o) => (bound.includes(o.id) ? { ...o, job: SENDING } : o)),
    }))
    send({ set: id, outputs: bound, lines: lines.slice(online) }, now)
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

// Vertex paints Nano Banana two ways. Online, its shared quota lets about one
// image a minute through for this project whatever we ask (12 Oct, Cloud
// Monitoring: 3–7 busy answers for every image painted), and every try is
// paced with every other server's (google/pace.ts). In a batch job it paints
// at half the price with no quota to wait for, and most jobs are back within
// half an hour — but some sit for an hour or more (see `follow`).
// Neither keeps up on its own, so both paint at once. The lane paints
// online, `LANE_PARALLEL` at a time:
// - "now" images first. As many as the lane gets through in about
//   `NOW_HORIZON` (going by how fast it's been) are kept for it; the rest of
//   a "now" order goes straight into a batch job, which is usually back
//   sooner than the lane would get to them (see `submit`).
// - else batch images not in a job yet: those waiting in the outbox for
//   room in a running job (see `MAX_RUNNING_JOBS`), oldest first. On a day
//   batch jobs are slow (12 Oct: about an image a minute for the project)
//   the lane paints a good part of a big order; on a fast one the jobs take
//   nearly all of it, at half the price.
// An image Vertex turns away waits its turn again (the shared pace keeps
// every server's next try a while off); one it keeps turning away past its
// patience goes into a batch job instead. Images bound for a batch job keep
// `job: SENDING` until their job starts, so a server that stops leaves them
// for the batch check (or `heal`) to send again; "now" images in the lane are
// just running, and read as interrupted should their server stop.

type Parcel = {
  set: string
  outputs: string[]
  lines: string[]
  tries?: number
  /** The name the job it goes out in got on the first try, kept for the next (see `sendJob`). */
  jobName?: string
  /** Painted by this model rather than the usual one (`FALLBACK_MODEL`, taking over from an overloaded one). */
  model?: string
  /** When it went into the outbox. */
  since?: number
  /** A "now" order's overflow: it goes in the next job, without waiting for more. */
  urgent?: boolean
}
type Errand = {
  set: string
  output: string
  line: string
  /** A "now" image: it goes before batch images, and waits longer before it's sent to a batch job. */
  now: boolean
  /** Not tried again before this. */
  after: number
  /** Since when Vertex has turned it away, with nothing else wrong. */
  busySince?: number
  /** Tries that came back without an image, or failed on Vertex's side. */
  misses: number
  /** Painted by this model rather than the usual one. */
  model?: string
  /** Times in a row the model turned it away as busy. */
  turnedAway?: number
}
type Lane = {
  errands: Errand[]
  active: number
  /** Of those, "now" images. */
  activeNow: number
  painted: number
  failed: number
  /** When it painted an image lately, to tell how fast it goes. */
  recent: number[]
  /** The outputs being tried right now. */
  inFlight: Set<string>
  /** Keeps the lane going: errands whose wait is over, and room filled from the outbox. */
  drain?: ReturnType<typeof setInterval>
  pull: () => void
  /** Starts what may go; called through here, so after a dev reload the newest code does. */
  pump?: () => void
}
const lane = ((global as typeof global & { __paintLane?: Lane }).__paintLane ??= {
  errands: [],
  active: 0,
  activeNow: 0,
  painted: 0,
  failed: 0,
  recent: [],
  inFlight: new Set(),
  pull: () => {},
})
// Made before these were fields: a dev reload keeps the old object (and its errands).
lane.activeNow ??= 0
lane.recent ??= []
lane.inFlight ??= new Set()
lane.errands = lane.errands.map((e) => ({ ...e, now: e.now ?? false, after: e.after ?? 0, misses: e.misses ?? 0 }))

/** Online tries at once on this server. Vertex lets about one image a minute through, so more would only add 429s. */
const LANE_PARALLEL = 2
/** How far ahead the lane takes "now" images on; past that they go in a batch job right away. */
const NOW_HORIZON = 10 * 60_000
/**
 * "now" images the lane takes on at least, however slow it's been: twenty,
 * a usual "now" order, which the fallback model paints in a few minutes
 * when the usual one is overloaded (a batch job of it took two hours on 12 Oct).
 */
const NOW_MIN = 20
/** How long Vertex may turn an image away online before it goes in a batch job: "now" ones are worth the wait. */
const NOW_PATIENCE = 20 * 60_000
const SPARE_PATIENCE = 3 * 60_000
/** Tries past the first for an answer without an image, or a failure on Vertex's side. */
const MISSES = 2
/**
 * Busy answers from the usual model after which the fallback paints an
 * image online instead (12 Oct: Nano Banana 2.1 turned 6 requests away 11
 * times; Nano Banana 2 painted them in 14 s each, at twice the price).
 */
const FALLBACK_AFTER = 2

const errand = (set: string, output: string, line: string, now: boolean, model?: string): Errand => ({
  set,
  output,
  line,
  now,
  after: 0,
  misses: 0,
  ...(model && { model }),
})

/** "now" images the lane can take on: what it painted in the last half hour, scaled to `NOW_HORIZON`, less what it has. */
function nowRoom() {
  const since = Date.now() - 30 * 60_000
  lane.recent = lane.recent.filter((at) => at > since)
  const soon = Math.max(NOW_MIN, Math.round((lane.recent.length / 30) * (NOW_HORIZON / 60_000)))
  return Math.max(0, soon - lane.activeNow - lane.errands.filter((e) => e.now).length)
}

/** Batch-bound images: as many as the lane has room for go online, the rest to the outbox. */
function send(parcel: Parcel, urgent = false) {
  const room = Math.max(0, LANE_PARALLEL - lane.active - lane.errands.length)
  parcel.outputs.slice(0, room).forEach((output, i) => lane.errands.push(errand(parcel.set, output, parcel.lines[i], false, parcel.model)))
  if (parcel.outputs.length > room) {
    toOutbox({ ...parcel, outputs: parcel.outputs.slice(room), lines: parcel.lines.slice(room) }, urgent)
  }
  pumpLane()
}

function pumpLane() {
  if (pause.on) return
  while (lane.active < LANE_PARALLEL) {
    const now = Date.now()
    const ready = (e: Errand) => (e.after ?? 0) <= now
    // "now" images first, then batch ones, each in the order they came.
    let i = lane.errands.findIndex((e) => e.now && ready(e))
    if (i < 0) i = lane.errands.findIndex(ready)
    if (i < 0) return
    const [next] = lane.errands.splice(i, 1)
    lane.active++
    if (next.now) lane.activeNow++
    lane.inFlight.add(next.output)
    void paintErrand(next).finally(() => {
      lane.active--
      if (next.now) lane.activeNow--
      lane.inFlight.delete(next.output)
      lane.pump?.()
    })
  }
}
lane.pump = pumpLane

/**
 * Room in the lane is filled from the outbox, oldest first, while no job has
 * room for what waits there (painting it online costs twice as much, so
 * only then) and no "now" images wait.
 */
lane.pull = () => {
  while (
    outbox.full &&
    !lane.errands.some((e) => e.now) &&
    lane.active + lane.errands.length < LANE_PARALLEL &&
    !outbox.sending &&
    outbox.parcels.length
  ) {
    const p = outbox.parcels[0]
    lane.errands.push(errand(p.set, p.outputs.shift()!, p.lines.shift()!, false, p.model))
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
  /** Jobs are being started (one at a time, paced): nothing else takes from the outbox meanwhile. */
  sending?: boolean
  /** What the timer runs; called through here, so after a dev reload the newest code does. */
  tick?: () => Promise<void>
  /** The last look found no room for another job: what waits now waits for a job to end. */
  full?: boolean
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

/**
 * How long the outbox waits for the rest of an order before its images go
 * out: all of them in few jobs is what made big orders fast (one job of 120
 * back in 11 minutes, 7 Sep), and a big order's first sets sent off early
 * would take the few jobs that may run, leaving the rest waiting for one to
 * end (overnight, maybe until the laptop wakes). So it sends once no set is
 * left to prepare, or once what waits would fill every job there may be; and
 * after `GATHER_MAX` in any case, should a set never get through.
 */
const GATHER_MAX = 90 * 60_000

function toOutbox(parcel: Parcel, urgent = false) {
  if (!outbox.parcels.length) outbox.first = Date.now()
  const placed = { ...parcel, since: parcel.since ?? Date.now(), ...(urgent && { urgent: true }) }
  // A "now" order's overflow goes ahead of what was only waiting for a job.
  const at = urgent ? outbox.parcels.findIndex((p) => !p.urgent) : -1
  outbox.parcels.splice(at < 0 ? outbox.parcels.length : at, 0, placed)
  outbox.last = Date.now()
  watchOutbox()
}

function watchOutbox() {
  if (outbox.timer) return
  outbox.timer = setTimeout(() => {
    outbox.timer = null
    void outbox.tick?.()
  }, 2_000)
}

async function outboxTick() {
  if (!outbox.parcels.length) return
  if (!outbox.sending) {
    outbox.sending = true
    try {
      const allowed = Date.now() >= (outbox.notBefore ?? 0) && !pause.on
      const quiet = Date.now() - outbox.last > 5_000 && queue.running.size === 0 && queue.waiting.length === 0
      const urgent = outbox.parcels.some((p) => p.urgent)
      const full = outbox.parcels.reduce((n, p) => n + p.outputs.length, 0) >= (MAX_RUNNING_JOBS - 1) * HUGE_JOB
      if (allowed && (urgent || quiet || full || Date.now() - outbox.first > GATHER_MAX)) await sendOut()
    } catch (error) {
      console.error("Batch outbox:", error)
    } finally {
      outbox.sending = false
    }
  }
  if (outbox.parcels.length) watchOutbox()
}

outbox.tick = outboxTick
// A timer the code before a dev reload set would run that code on (until 12 Oct it
// did, holding everything to the old limits): set it again, for this code.
if (outbox.timer) {
  clearTimeout(outbox.timer)
  outbox.timer = null
  watchOutbox()
}

/**
 * Batch jobs running at once at most, across all sets and servers; one of
 * them is kept for a "now" order's overflow. More side by side queue up
 * behind each other at Google (5 Sep: of 7 at once, three were still running
 * after 45 minutes; the same images in one job were done in 12), and 44 sent
 * within five minutes on 10 Oct were followed by Google suspending the
 * account. Jobs also start at least half a minute apart (google/pace.ts);
 * what doesn't fit waits in the outbox until a job ends.
 */
const MAX_RUNNING_JOBS = 4

/**
 * How big a job is: an order goes out as one job while it holds no more than
 * `MAX_JOB` (161, 202 and 226 images came back in 8 to 22 minutes in one job
 * each, Sep–Oct); a bigger one is shared out over the jobs that may start,
 * in equal parts, so that all of it is at Google within the hour: thousands
 * in the evening paint overnight while the laptop sleeps, and come in when
 * it wakes. Vertex paints a job's requests side by side and hands them over
 * only when it ends; how long that takes depends on how busy it is far more
 * than on the size (12 Oct, jobs of 6 to 10 took an hour), and one that
 * sticks, stalls or falls behind is ended, its images come in and the rest
 * goes out again (see `follow`). Vertex takes up to 200,000 requests a job;
 * `HUGE_JOB` and `MAX_IN_FLIGHT` keep what one job holds and what's out at
 * once sensible.
 */
const MAX_JOB = 250
const HUGE_JOB = 2_000
const MAX_IN_FLIGHT = 6_000

/** What's in the outbox, shared out over as many jobs as `MAX_RUNNING_JOBS` and `MAX_IN_FLIGHT` leave room for, started one after another. */
async function sendOut() {
  const running = new Map<string, number>()
  for (const set of await listSets()) {
    for (const job of set.jobs ?? []) {
      if (job.status === "running") running.set(job.name, Math.max(running.get(job.name) ?? 0, job.size || job.outputs.length))
    }
  }
  // The last free job is a "now" order's: batch images leave it free.
  const urgent = outbox.parcels.some((p) => p.urgent)
  const room = MAX_RUNNING_JOBS - running.size - (urgent ? 0 : 1)
  let images = MAX_IN_FLIGHT - [...running.values()].reduce((n, size) => n + size, 0)
  if (room <= 0 || images <= 0) {
    outbox.full = true
    outbox.notBefore = Date.now() + 60_000
    return
  }
  outbox.full = false
  const waiting = outbox.parcels.reduce((n, p) => n + p.outputs.length, 0)
  if (!waiting) return
  const parts = Math.min(room, Math.ceil(waiting / MAX_JOB))
  const each = Math.min(HUGE_JOB, Math.ceil(waiting / parts))
  // Each job filled to `each` (less where few images have room), a parcel cut
  // where it doesn't fit; the rest waits its turn.
  const jobs: Parcel[][] = []
  const rest: Parcel[] = []
  let filling: Parcel[] = []
  let size = 0
  for (let p of outbox.parcels.splice(0)) {
    while (p.outputs.length && jobs.length < room && images > 0) {
      // A job paints with one model.
      if (filling.length && (filling[0].model ?? PAINT_MODEL) !== (p.model ?? PAINT_MODEL)) {
        jobs.push(filling)
        filling = []
        size = 0
        continue
      }
      const take = Math.min(each - size, images, p.outputs.length)
      filling.push({ ...p, outputs: p.outputs.slice(0, take), lines: p.lines.slice(0, take) })
      p = { ...p, outputs: p.outputs.slice(take), lines: p.lines.slice(take) }
      size += take
      images -= take
      if (size === each || images === 0) {
        jobs.push(filling)
        filling = []
        size = 0
      }
    }
    if (p.outputs.length) rest.push(p)
  }
  if (filling.length) jobs.push(filling)
  if (rest.length) {
    outbox.parcels.unshift(...rest)
    outbox.notBefore = Date.now() + 60_000
  }
  // Each waits for its turn to start (google/pace.ts); one that fails goes back to the outbox.
  for (const job of jobs) await sendJob(job)
}

async function sendJob(parcels: Parcel[]) {
  const size = parcels.reduce((n, p) => n + p.lines.length, 0)
  const model = parcels[0].model ?? PAINT_MODEL
  // One name for every try of these images: a job that started at Google
  // without the answer reaching us is found by it, and never paid for twice.
  const display = parcels.find((p) => p.jobName)?.jobName ?? `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  for (const p of parcels) p.jobName = display
  let name: string
  try {
    if (pause.on) throw new GooglePausedError()
    const started = parcels.some((p) => p.tries) ? (await openPaintBatches()).find((j) => j.displayName === display) : undefined
    name = started?.name ?? (await startPaintBatch(display, parcels.flatMap((p) => p.lines), model))
  } catch (error) {
    // Turned down as wrong: sent again as it is, it would only be turned down again.
    const final = error instanceof GoogleError && wrong(error.status)
    const tries = final ? SEND_TRIES : (parcels[0].tries ?? 0) + (error instanceof GooglePausedError ? 0 : 1)
    console.error(`Batch job (try ${tries} of ${SEND_TRIES}):`, error)
    if (tries < SEND_TRIES) {
      // Back in the outbox, for a try a little later.
      outbox.parcels.unshift(...parcels.map((p) => ({ ...p, tries })))
      outbox.first = Math.min(outbox.first || Date.now(), Date.now())
      outbox.notBefore = Date.now() + Math.max(1, Math.min(tries, 3)) * 60_000
      watchOutbox()
      return
    }
    const why = final ? `Batch job rejected (${(error as GoogleError).status}): ${message(error)}` : message(error)
    for (const p of parcels) {
      const after = await updateSet(p.set, (s) =>
        settled({
          ...s,
          outputs: s.outputs.map((o) =>
            p.outputs.includes(o.id) && o.job === SENDING
              ? { ...o, status: "error", job: undefined, error: why }
              : o
          ),
        })
      ).catch(() => null)
      if (after?.status === "queued") enqueue(p.set)
    }
    return
  }
  // Looked after from here until it's in, before any set (or other server) knows of it.
  await keep(name)
  const submittedAt = new Date().toISOString()
  // A set can have several parcels; it gets one entry for the job.
  const bySet = new Map<string, string[]>()
  for (const p of parcels) bySet.set(p.set, [...(bySet.get(p.set) ?? []), ...p.outputs])
  for (const [set, ids] of bySet) {
    const job: PaintJob = { name, outputs: ids, submittedAt, status: "running", size, ...(model !== PAINT_MODEL && { model }) }
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

/** One try at painting an errand online; what's next depends on how it went. */
async function paintErrand(next: Errand) {
  const model = next.model ?? PAINT_MODEL
  let attempt: Attempt
  try {
    attempt = await paintLineOnce(next.line, model)
  } catch (error) {
    // Paused meanwhile: it waits in line for the switch (`resume` starts the lane again).
    if (error instanceof GooglePausedError) return void lane.errands.unshift({ ...next, after: 0 })
    attempt = { outcome: "flaky", why: message(error) }
  }
  const now = Date.now()
  switch (attempt.outcome) {
    case "image":
      lane.painted++
      lane.recent.push(now)
      return land(next, { key: next.output, image: attempt.image }, model)
    case "busy":
    case "refused": {
      const turnedAway = (next.turnedAway ?? 0) + (attempt.outcome === "busy" ? 1 : 0)
      // The usual model is overloaded: the fallback paints it, from the next try on.
      if (model === PAINT_MODEL && turnedAway >= FALLBACK_AFTER) {
        lane.errands.push({ ...next, model: FALLBACK_MODEL, turnedAway: 0, busySince: undefined, after: 0 })
        return
      }
      const busySince = next.busySince ?? now
      if (now - busySince > (next.now ? NOW_PATIENCE : SPARE_PATIENCE)) return toBatch(next)
      // Back in line. The shared pace keeps every server's next try a while off anyway.
      lane.errands.push({ ...next, busySince, turnedAway, after: now + (attempt.outcome === "refused" ? 60_000 : 5_000) })
      return
    }
    case "flaky":
    case "empty":
      if (next.misses < MISSES) {
        lane.errands.push({ ...next, misses: next.misses + 1, after: now + 15_000 * (next.misses + 1) })
        return
      }
      // Vertex keeps failing it online: a batch job takes it.
      if (attempt.outcome === "flaky") return toBatch(next)
      lane.failed++
      return land(next, { key: next.output, error: attempt.why })
    case "blocked":
    case "failed":
      lane.failed++
      return land(next, { key: next.output, error: attempt.why })
  }
}

/** Vertex kept turning it away online: it goes in a batch job instead (a "now" image ahead of the others), with the usual model. */
async function toBatch({ set, output, line, now }: Errand) {
  if (now) {
    try {
      await updateOutput(set, output, { job: SENDING })
    } catch (error) {
      if (!(error instanceof NotFoundError)) console.error(`Generation ${set}, output ${output}:`, error)
      return
    }
  }
  toOutbox({ set, outputs: [output], lines: [line] }, now)
}

/**
 * An image (or why not) painted online by `model`, brought into its set. Its
 * slot in the lane is free again after `LANDING` at most: right after the
 * laptop wakes, a database write can hang on a connection that's gone. Should
 * it never get written, `heal` finds the image still marked as painting and
 * paints it again.
 */
async function land({ set, output }: Errand, result: PaintResult, model?: string) {
  const landing = (async () => {
    await bringIn(set, result, model)
    const after = await updateSet(set, settled)
    if (after.status === "queued") enqueue(set)
  })().catch((error) => {
    if (!(error instanceof NotFoundError)) console.error(`Generation ${set}, output ${output}:`, error)
  })
  await Promise.race([landing, sleep(LANDING)])
}

const LANDING = 3 * 60_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
 * Each job is held to a goal: an hour for an order of up to `BIG_JOB`
 * images, the night (`NIGHT`) for a bigger one, sent off in the evening.
 * Vertex only hands a job's images over when it ends, so a job is ended
 * early, its images come in and the rest goes out again, when
 * - it has painted at least `HARVEST_SHARE` and then nothing for `STALL`
 *   (a few slow requests holding up all the others),
 * - it has painted nothing new for `LONG_STALL`, or is past its goal,
 * - it has painted nothing for `STUCK` while a job sent after it paints, or
 *   for `STUCK_ALONE` (some sit for hours while others paint),
 * - it runs on the usual model and has fallen well behind its goal: after a
 *   third of it, less than half as far along as the time spent asks for.
 * A job of the usual model ended early hands the rest to the fallback model
 * (see `FALLBACK_MODEL`); one of the fallback's sends it out again as it is.
 * A job that's painting, if slowly, goes on: until 12 Oct a job was ended
 * after one image and a few minutes' stall, and its rest started over in a
 * new job again and again.
 */
const HOUR = 60 * 60_000
const NIGHT = 8 * HOUR
const BIG_JOB = 250
const HARVEST_AFTER = 10 * 60_000
const HARVEST_SHARE = 0.5
const STALL = { small: 5 * 60_000, big: 20 * 60_000 }
const LONG_STALL = { small: 45 * 60_000, big: 2 * HOUR }
const STUCK = { small: 20 * 60_000, big: HOUR }
const STUCK_ALONE = { small: 45 * 60_000, big: 2 * HOUR }
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

// The server that starts a job looks after it until it's in: it holds the
// job's lock all along (`claim`), so another server (perhaps one on older
// code, with other rules for ending jobs early) takes over only once this
// one stops, its connection going and the lock with it; the next server
// that asks after the job then looks after it. Everything done to a job goes
// through `onJob`: here one thing at a time, elsewhere under the job's lock.

type Kept = { claim: Claim; turn: Promise<unknown>; since: number }
const kept = ((global as typeof global & { __keptJobs?: Map<string, Kept> }).__keptJobs ??= new Map())

async function keep(name: string) {
  const held = await claim(`batch:${name}`).catch((error) => {
    console.warn(`Batch ${name}: not looked after here:`, message(error))
    return null
  })
  if (held) kept.set(name, { claim: held, turn: Promise.resolve(), since: Date.now() })
}

function letGo(name: string) {
  const held = kept.get(name)
  if (!held) return
  kept.delete(name)
  void held.claim.release()
}

/** Runs `work` on the job `name`: in turn when this server looks after it, else under its lock (null when another server holds that). */
function onJob<T>(name: string, work: () => Promise<T>): Promise<T | null> {
  const held = kept.get(name)
  if (!held || held.claim.lost) {
    if (held) letGo(name)
    return exclusive(`batch:${name}`, work)
  }
  const turn = held.turn.then(work, work)
  held.turn = turn.catch(() => {})
  return turn
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
    // Sets this code knows how to run: only their jobs are looked after here, and handed to the fallback model.
    const known = new Set<string>()
    for (const set of await listSets()) {
      if (ours(set)) known.add(set.id)
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
    // Jobs looked after here that are in by now (or gone) are let go; one only
    // just started may not be written down yet.
    for (const [name, held] of kept) if (!jobs.has(name) && Date.now() - held.since > 2 * 60_000) letGo(name)
    // The newest job that has painted anything: one sent before it with nothing painted has stuck.
    const moving = Math.max(
      0,
      ...[...jobs.values()].filter((shares) => (shares[0].job.ready ?? 0) > 0).map((shares) => Date.parse(shares[0].job.submittedAt))
    )
    for (const [name, shares] of jobs) {
      if (pass !== batches.pass) return // the watchdog gave up on this pass
      more = true
      batches.beat = Date.now()
      const short = name.split("/").pop()
      batches.doing = `waiting for the lock on ${short}`
      const mine = shares.every((s) => known.has(s.set))
      // A job no one looks after (its server stopped) is looked after here from now on.
      if (mine && !kept.has(name)) await keep(name)
      await onJob(name, () => {
        batches.doing = `asking Vertex about ${short}`
        return follow(name, shares, moving, mine)
      }).catch((error) => console.error(`Batch ${name}:`, error))
    }
  } finally {
    if (pass === batches.pass) {
      batches.ticking = false
      batches.beat = Date.now()
      batches.doing = ""
      // A server that led once asks on only while it still leads, or has jobs to ask after.
      if (batches.steady && !more && !(await isLeader().catch(() => false))) batches.steady = false
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
      const entry: PaintJob = {
        name: job.name,
        outputs: ids,
        submittedAt: job.createdAt,
        status: "running",
        size: keys.size,
        ...(job.model !== PAINT_MODEL && { model: job.model }),
      }
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

/** How painting stands on this server (and the shared pace), for a look from outside. */
export async function batchHealth() {
  const ago = (at: number) => (at ? Math.round((Date.now() - at) / 1000) : null)
  const hour = Date.now() - 60 * 60_000
  return {
    polling: batches.ticking ? `busy: ${batches.doing}` : batches.timer ? "waiting" : "not on this server",
    lastProgressSecondsAgo: ago(batches.beat),
    lastCheckSecondsAgo: ago(batches.checkedAt),
    lane: {
      waiting: lane.errands.length,
      waitingNow: lane.errands.filter((e) => e.now).length,
      painting: lane.active,
      painted: lane.painted,
      failed: lane.failed,
      paintedLastHour: lane.recent.filter((at) => at > hour).length,
      takesNow: nowRoom(),
    },
    waitingToGoOut: outbox.parcels.reduce((n, p) => n + p.outputs.length, 0),
    healing: { lastPassSecondsAgo: ago(healer.at), healed: healer.log },
    pace: await paceState().catch((error) => ({ error: message(error) })),
    problems: batches.problems,
  }
}

/**
 * Brings a finished job's images in; one still going is noted, and ended
 * early once it's held its images long enough (or stuck: `moving` is when
 * the newest job that has painted anything was sent). Only a job of sets
 * this code knows (`mine`) hands its rest to the fallback model.
 */
async function follow(name: string, shares: Share[], moving: number, mine = true) {
  const state = await paintBatchState(name)
  if (state.state !== "running") return collect(name, shares, state)

  const { job } = shares[0]
  // Ended early, but the cancel didn't get through: again.
  if (job.harvest) return void (await cancelPaintBatch(name).catch(() => {}))
  const now = Date.now()
  const age = now - Date.parse(job.submittedAt)
  const moved = state.ready !== (job.ready ?? 0)
  const movedAt = moved ? new Date(now).toISOString() : (job.movedAt ?? job.submittedAt)
  // Vertex leaves the counts out while a job waits to start: the size it had stays.
  const size = state.total || job.size || 0
  const kind = size > BIG_JOB ? "big" : "small"
  const goal = kind === "big" ? NIGHT : HOUR
  const stalled = now - Date.parse(movedAt)
  const share = size ? state.ready / size : 0
  const behind = mine && !job.model && age >= goal / 3 && share < (0.5 * Math.min(age, goal)) / goal
  const due =
    !job.harvest &&
    state.ready < state.total &&
    (behind ||
      (state.ready > 0
        ? age >= goal ||
          stalled >= LONG_STALL[kind] ||
          (age >= HARVEST_AFTER && share >= HARVEST_SHARE && stalled >= STALL[kind])
        : age >= STUCK_ALONE[kind] || (age >= STUCK[kind] && moving > Date.parse(job.submittedAt))))
  // Every set is written on each change, so a fast job's progress goes out once a minute.
  const recent = now - Date.parse(job.movedAt ?? job.submittedAt) < PROGRESS_EVERY
  if (!due && (!moved || recent) && job.size === size) return
  batches.doing = `writing how ${name.split("/").pop()} stands`
  await eachShare(shares, name, (j) => ({
    ...j,
    ready: state.ready,
    movedAt,
    size,
    // The usual model's rest goes to the fallback (see `collect`).
    ...(due && { harvest: true, ...(mine && !j.model && { rescue: true }) }),
  }))
  if (due) {
    console.log(`Batch ${name.split("/").pop()}: ${state.ready} of ${size} after ${Math.round(age / 60_000)} min, ended early${mine && !job.model ? ", the rest goes to the fallback model" : ""}`)
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
        const outcome = (await onJob(name, () => handOver(name, shares))) ?? "being collected"
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
    const model = shares[0].job.model
    if (moving.length) send({ set, outputs: moving, lines: moving.map((o) => lines.get(o)!), ...(model && { model }) })
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
  let blocked = 0
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
      if (!result.image && BLOCKED.test(result.error ?? "")) blocked++
      const task: Promise<void> = bringIn(id, result, shares[0].job.model)
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

  // Many held back by the safety filters: everything pauses until the prompts have had a look (google/pause.ts).
  if (blocked) void heldBackByGoogle(`batch job ${short}`, blocked, owner.size)
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
    // Ended for falling behind: the fallback paints the rest; a fallback job's rest stays with the fallback.
    const model = shares.some(({ job: j }) => j.rescue || j.model === FALLBACK_MODEL) ? FALLBACK_MODEL : undefined
    if (resend.length) send({ set, outputs: resend, lines: resend.map((o) => again.get(o)!), ...(model && { model }) })
  }
  // How long a job of this size took, to tune `MAX_JOB` by.
  const minutes = Math.round((Date.now() - Date.parse(shares[0].job.submittedAt)) / 60_000)
  console.log(
    `Batch ${short}: ${owner.size - left.size} in, ${again.size} out again, ${left.size - again.size} failed` +
      ` (${shares[0].job.size ?? "?"} requests, ${minutes} min after it went out)`
  )
}

const COLLECT_PARALLEL = 6

async function bringIn(id: string, result: PaintResult, model?: string) {
  try {
    if (result.image) {
      const stored = await store(id, `out-${result.key}`, result.image)
      const set = await updateOutput(id, result.key, {
        ...stored.asset,
        job: undefined,
        error: undefined,
        model: model && model !== PAINT_MODEL ? model : undefined,
      })
      // An Autonomous scale poster is looked at against its series (styles/auto-check.ts).
      if (set.style && set.outputs.some((o) => o.id === result.key && o.auto)) void reviewAuto(id, result.key, enqueue)
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
    const outcome = (await onJob(name, () => endJob(name, shares))) ?? "being collected"
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

// --- Reset fails ---

/**
 * Every failed image goes (see `resetOf`), so nothing asks for it again: not
 * Retry, not Send all, not the batch check. A set left with nothing in it
 * goes too. Finished batch jobs are put away, and those left without images
 * go, so the sidebar counts only what's sent from now on. Whatever is still
 * painting carries on. With `dryRun` it only counts; `ids` keeps it to those
 * sets. Answers how many images and sets went (or would).
 */
export async function resetFails({ dryRun = false, ids }: { dryRun?: boolean; ids?: string[] } = {}) {
  const todo = (await listSets()).filter((set) => {
    if (ids && !ids.includes(set.id)) return false
    const plan = resetOf(set)
    return plan.images > 0 || plan.drop || (set.jobs ?? []).some((j) => j.status !== "running" && !j.cleared)
  })
  if (dryRun) {
    const plans = todo.map(resetOf)
    return { images: plans.reduce((n, p) => n + p.images, 0), sets: plans.filter((p) => p.drop).length }
  }
  let images = 0
  let sets = 0
  // A few sets at a time: each is a round trip or two to the database.
  let next = 0
  await Promise.all(
    Array.from({ length: RESET_PARALLEL }, async () => {
      while (next < todo.length) {
        const went = await resetSet(todo[next++])
        images += went.images
        if (went.set) sets++
      }
    })
  )
  return { images, sets }
}

const RESET_PARALLEL = 6

async function resetSet(set: GenerationSet) {
  if (resetOf(set).drop) {
    // Under its lock and as it is by then: a set asked for again meanwhile isn't deleted from under its run.
    const went = await exclusive(`generation:${set.id}`, async () => {
      const now = resetOf(await getSet(set.id))
      if (!now.drop) return null
      await deleteSet(set.id)
      return now.images
    }).catch((error) => {
      if (error instanceof NotFoundError) return null
      throw error
    })
    if (went !== null) return { images: went, set: true }
  }
  let removed = 0
  const after = await updateSet(set.id, (s) => {
    const gone = new Set(s.outputs.filter(isFailedImage).map((o) => o.id))
    removed = gone.size
    const jobs = (s.jobs ?? []).flatMap((j): PaintJob[] => {
      if (j.status === "running") return [j]
      const outputs = j.outputs.filter((o) => !gone.has(o))
      // What it brought in stays listed under it, without the failure it may have ended in.
      return outputs.length ? [{ ...j, outputs, status: "done", error: undefined, cleared: true }] : []
    })
    return settled({ ...s, outputs: s.outputs.filter((o) => !gone.has(o.id)), jobs })
  }).catch((error) => {
    if (!(error instanceof NotFoundError)) throw error
    return null
  })
  if (after?.status === "queued") enqueue(set.id)
  return { images: removed, set: false }
}

// --- Healing ---

// What failed for a passing reason runs again by itself, so a run started
// and left alone ends with every image there that can be: Google busy past a
// call's patience, a dropped connection, a batch job that failed or lost
// images, a server that stopped halfway (its sets read as interrupted, and
// those of them still to be painted go out again from here). Every minute
// one server looks (a lock keeps it to one at a time), and a set whose
// failures are worth another try (`worthRetrying`) runs again: at once when
// its server stopped, else `HEAL_AFTER` after it last changed, waiting
// longer each time up to an hour, for as long as `HEAL_WINDOW`: an order
// left overnight keeps going, however often Google was busy. Safety blocks,
// bad requests and what was stopped or cancelled by hand stay failed. Only
// sets asked for since this came in (they have `heals`) and that this code
// knows how to run (`ours`): older failures wait for a Retry by hand.
// Each server also looks after itself every minute: it starts its batch
// polling again should a pass have hung (on a connection the laptop's sleep
// took), and sends out again images of its own sets still marked as
// painting that nothing here paints.

const HEAL_EVERY = 60_000
const HEAL_AFTER = [60_000, 3 * 60_000, 10 * 60_000, 20 * 60_000, 30 * 60_000, 60 * 60_000]
/** Enough for a day and more of hourly tries, so nothing failing for a passing reason waits for a click. */
const MAX_HEALS = 40
const HEAL_WINDOW = 3 * 24 * 60 * 60_000
/** A pass (healing, or asking after batch jobs) that's got nowhere this long has hung. */
const HUNG_PASS = 10 * 60_000
/**
 * A run of a set that has gone this long without the set changing has hung
 * (a call on a dropped connection that never answers): it's let go of, so
 * its lost images are painted again and new batches of the set can start.
 */
const HUNG_RUN = 45 * 60_000
/**
 * An image of this server's still marked as painting, with nothing here
 * painting it and its set unchanged this long, was lost. Not sooner: a
 * server on older code that took a job over (when the database was too slow
 * to hold the job's lock for this one) may still be painting it.
 */
const LOST_AFTER = 15 * 60_000

type Healer = {
  timer: ReturnType<typeof setInterval> | null
  busy: boolean
  /** When the last pass ran. */
  at: number
  /** What it ran again lately, newest last. */
  log: { at: string; set: string; images: number; why: string }[]
  pass: () => Promise<void>
}
const healer = ((global as typeof global & { __generationHealer?: Healer }).__generationHealer ??= {
  timer: null,
  busy: false,
  at: 0,
  log: [],
  pass: async () => {},
})

// The fields this code writes on a set, its batches and their options, and
// its outputs (add a new one here too).
const SET_FIELDS = new Set(["id", "kind", "folder", "source", "status", "createdAt", "updatedAt", "original", "layout", "posters", "extraction", "batches", "outputs", "jobs", "stopping", "doneAt", "mockup", "sceneId", "heals", "runner", "style"])
const BATCH_FIELDS = new Set(["id", "options", "createdAt", "expanded", "auto"])
const OPTION_FIELDS = new Set(["variants", "ideas", "feedback", "posters", "from", "inspiration", "delivery"])
const OUTPUT_FIELDS = new Set(["status", "file", "width", "height", "error", "note", "id", "poster", "batch", "mode", "creativity", "styleId", "title", "brief", "feedback", "from", "inspiration", "job", "model", "review", "reviewedAt", "createdAt", "auto", "refs", "check", "free"])

/**
 * Sets this code knows how to run: nothing on them it doesn't know. Other
 * worktrees on the shared database add kinds and fields of their own (city
 * and lab sets, prompts planned elsewhere), and running those this way would
 * paint them wrong.
 */
function ours(set: GenerationSet) {
  const only = (o: object | undefined, fields: Set<string>) => Object.keys(o ?? {}).every((key) => fields.has(key))
  // City sets (citys/generate.ts) run here too; lab rounds are the lab's to run.
  if (isCitySet(set)) return !set.city.lab
  return (
    (set.kind === "poster" || set.kind === "mockup") &&
    only(set, SET_FIELDS) &&
    set.batches.every((b) => only(b, BATCH_FIELDS) && only(b.options, OPTION_FIELDS)) &&
    set.outputs.every((o) => only(o, OUTPUT_FIELDS))
  )
}

/** Why `set` should run again now, if it should. */
function healDue(set: GenerationSet): string | null {
  if (typeof set.heals !== "number" || set.heals >= MAX_HEALS || !ours(set) || set.doneAt || set.stopping) return null
  if (Date.now() - Date.parse(set.updatedAt) > HEAL_WINDOW) return null
  const steps = [set.original, set.extraction, set.mockup].filter((a): a is Asset => a?.status === "error")
  // A photo we can't use, say: nothing after it can be made.
  if (steps.some((a) => !worthRetrying(a.error))) return null
  const failed = [...steps, ...set.outputs.filter((o) => o.status === "error" && (!o.job || o.job === SENDING))]
  if (!failed.some((a) => worthRetrying(a.error))) return null
  if (failed.some((a) => a.error === INTERRUPTED)) return "its server stopped"
  // Whatever still paints comes in first.
  if (set.status === "queued" || set.status === "running") return null
  const wait = HEAL_AFTER[Math.min(set.heals, HEAL_AFTER.length - 1)]
  return Date.now() - Date.parse(set.updatedAt) >= wait ? "failed for a passing reason" : null
}

/** Images of `set` (run here) still marked as painting that nothing on this server paints any more. */
function lost(set: GenerationSet) {
  if (typeof set.heals !== "number" || (set as GenerationSet & { runner?: string }).runner !== instanceId) return []
  if (queue.running.has(set.id) || queue.waiting.includes(set.id) || outbox.sending) return []
  if (Date.now() - Date.parse(set.updatedAt) < LOST_AFTER) return []
  const here = new Set([...lane.inFlight, ...lane.errands.map((e) => e.output), ...outbox.parcels.flatMap((p) => p.outputs)])
  return set.outputs.filter((o) => o.status === "running" && (!o.job || o.job === SENDING) && !here.has(o.id)).map((o) => o.id)
}

async function healPass() {
  // One that hung (its database connection gone) is given up on.
  if (healer.busy && Date.now() - healer.at < HUNG_PASS) return
  healer.busy = true
  healer.at = Date.now()
  try {
    // Batch polling that hung here starts again (the leader's batch check only looks after its own).
    if (batches.ticking && Date.now() - batches.beat > HUNG_PASS) {
      console.warn(`Batch polling got nowhere for ${Math.round((Date.now() - batches.beat) / 60_000)} min (${batches.doing || "?"}): started again`)
      batches.pass++
      batches.ticking = false
      kickBatches(0)
    }
    const sets = await listSets()
    for (const [id, { at }] of queue.started) {
      const set = sets.find((s) => s.id === id)
      if (Date.now() - at < HUNG_RUN || (set && Date.now() - Date.parse(set.updatedAt) < HUNG_RUN)) continue
      console.warn(`Generation ${id}: its run got nowhere for ${Math.round((Date.now() - at) / 60_000)} min, let go of`)
      queue.running.delete(id)
      queue.started.delete(id)
      if (set && (set.status === "queued" || set.batches.some((b) => !b.expanded))) enqueue(id)
    }
    for (const set of sets) {
      const gone = lost(set)
      if (gone.length) await heal(set.id, "images went missing on this server", gone)
      // Queued here but in no line: its run failed before it began (the database full, say).
      const runner = (set as GenerationSet & { runner?: string }).runner
      if (set.status === "queued" && runner === instanceId && !queue.running.has(set.id) && !queue.waiting.includes(set.id) && Date.now() - Date.parse(set.updatedAt) > 3 * 60_000) {
        console.warn(`Generation ${set.id}: queued here but in no line, put back`)
        enqueue(set.id)
      }
    }
    if (pause.on) return
    // A server held back (FOLLOWER=1) still heals the city sets: only this code knows how to run them.
    const citysOnly = process.env.FOLLOWER === "1"
    await exclusive("generation:heal", async () => {
      for (const set of await listSets()) {
        if (citysOnly && !isCitySet(set)) continue
        const why = healDue(set)
        if (why) await heal(set.id, why)
      }
    })
    if (citysOnly) return
    // Jobs still painting are asked after here too, should nobody be polling them.
    if (!batches.ticking && !batches.timer && sets.some((s) => s.jobs?.some((j) => j.status === "running"))) kickBatches(0)
  } catch (error) {
    console.error("Healing:", error)
  } finally {
    healer.busy = false
  }
}

healer.pass = healPass
// Every server with this code heals (not one held back with FOLLOWER=1); the lock keeps it to one pass at a time.
healer.timer ??= setInterval(() => void healer.pass(), HEAL_EVERY)
healer.timer.unref?.()

/**
 * Runs again what failed in the set for a passing reason (and the outputs
 * `missing`, lost while painting); what's painting or done stays as it is.
 */
async function heal(id: string, why: string, missing: string[] = []) {
  let images = 0
  try {
    await updateSet(id, (s) => {
      const again = <T extends Asset & { job?: string }>(a: T): T => {
        if (a.status !== "error" || !worthRetrying(a.error) || (a.job && a.job !== SENDING)) return a
        return { ...a, status: "pending", error: undefined, job: undefined }
      }
      const outputs = s.outputs.map((o) =>
        missing.includes(o.id) && o.status === "running" && (!o.job || o.job === SENDING)
          ? { ...o, status: "pending" as const, error: undefined, job: undefined }
          : again(o)
      )
      images = outputs.filter((o, i) => o !== s.outputs[i]).length
      return {
        ...s,
        status: "queued",
        heals: (s.heals ?? 0) + 1,
        original: again(s.original),
        extraction: s.extraction && again(s.extraction),
        mockup: s.mockup && again(s.mockup),
        outputs,
      }
    })
  } catch (error) {
    if (!(error instanceof NotFoundError)) console.error(`Generation ${id}, healing:`, error)
    return
  }
  console.log(`Generation ${id}: ${why}, running ${images} images again`)
  healer.log = [...healer.log, { at: new Date().toISOString(), set: id, images, why }].slice(-20)
  enqueue(id)
}

/** The outputs `batch` asks for, waiting for a brief. */
function expand(set: GenerationSet, batch: Batch): Output[] {
  const { options } = batch
  // Autonomous scale: its posters are planned later, anchor and all (styles/auto.ts).
  if (batch.auto) return expandAuto(batch)
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
  // Autonomous scale posters are planned their own way (see `planAuto`).
  const todo = set.outputs.filter((o) => o.status === "pending" && !o.brief && !o.auto)
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
  if (isCitySet(set)) {
    const output = set.outputs.find((o) => o.id === outputId)
    if (!output) throw new Error("Unknown output")
    return cityRequest(set, output)
  }
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
  if (current.auto) {
    const { prompt, images, aspect } = await autoRequest(set, current)
    return { prompt, images, aspect }
  }
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
    // Vertex stayed busy all along: it goes the batch way instead of failing,
    // online in the lane when there's room, else in a batch job (see `send`).
    if (error instanceof StayedBusyError && batchConfigured()) {
      console.warn(`Generation ${id}, output ${output.id}: Vertex stayed busy, painting it the batch way`)
      return submit(id, [output], () => style)
    }
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
    const batched = ready.batches.find((b) => b.id === blank.batch)?.options.delivery === "batch"
    if (batchConfigured()) await submit(set.id, [blank], none, !batched)
    else await draw(set.id, blank, none())
    blank = (await getSet(set.id)).outputs[0]
  }
  // Online in the lane or in a batch job: the set runs again once it's back (see `settled`).
  if (painting(blank)) return
  if (blank.status !== "done") {
    await updateSet(set.id, (s) => ({ ...s, mockup: { status: "error", file: null, error: blank.error ?? "No blank mockup" } }))
    return
  }

  try {
    const image = await readSetFile(set.id, blank.file!)
    // Made again: the new blank goes under the scene there is, unless it's been deleted.
    const there = set.sceneId && (await getScene(set.sceneId).catch(() => null))
    // The photo helps find every frame and what stands in front of one.
    const scene = there
      ? await replaceBlank(there.id, image, photo)
      : await createSceneFromBlank(
          mockupName(set.source.title),
          image,
          { category: set.folder, shop: set.source.shop ?? undefined },
          photo
        )
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
