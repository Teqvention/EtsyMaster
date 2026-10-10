import { getAccount } from "@/lib/accounts/store"
import type { Account } from "@/lib/accounts/types"
import type { Orientation } from "@/lib/catalog/sizes"
import { instanceId, isLeader } from "@/lib/db/workers"
import { EtsyApiError } from "@/lib/etsy/client"
import { usageOf } from "@/lib/etsy/usage"
import { NotFoundError } from "@/lib/mockups/storage"
import { getDraft } from "@/lib/uploads/store"

import { orientationOf, type StageContext } from "./context"
import { Fatal, Parked } from "./errors"
import { runStage } from "./stages"
import {
  isFinished,
  patchItem,
  readPipeline,
  requeueInterrupted,
  savePayload,
  setLiveNote,
  settleJobs,
} from "./store"
import { STAGES, type JobItem, type UploadJob } from "./types"

// The upload worker: walks every job item through its stages in the
// background, on its own timer (started with the server, see
// instrumentation-node.ts, and by the pipeline's routes), on the one server
// doing the background work (see db/workers.ts); the others' passes do
// nothing, and a new job waits at most a tick for the leader's next one. Each pass starts
// what may start: items in line or done waiting, oldest job first and in each
// job's upload order, while the resource their stage needs is free: three
// print file makers, three mockup renders, one Gelato create per store, two
// Etsy stages per account. A Gelato create also waits for the account's
// earlier posters in its job, so listings appear in the planned order.
//
// A stage that throws is tried again after a growing pause, five tries in
// all; one that can't go on yet (quota, a setting, Gelato publishing) waits
// without spending a try. Pausing holds items before their next stage,
// except those Gelato has already: their listing exists, so it's put right
// first.

const TICK = 5_000
const MAX_ATTEMPTS = 5
const BACKOFF = 30_000
const MAX_BACKOFF = 30 * 60 * 1000
const QUOTA_WAIT = 15 * 60 * 1000

/** How many stages may hold a resource at once, by its kind (before the colon). */
const LIMITS: Record<string, number> = { copy: 8, cpu: 3, render: 3, gelato: 1, etsy: 2 }

type Worker = {
  started: boolean
  timer: ReturnType<typeof setTimeout> | null
  ticking: boolean
  again: boolean
  /** Item id → the resource its stage holds. */
  running: Map<string, string | null>
  /** The newest code's pass: a reload during development swaps it in. */
  tick: () => Promise<void>
}

// On globalThis: one worker per server, whichever copy of this module starts it.
const global = globalThis as typeof globalThis & { __pipelineWorker?: Worker }
const worker = (global.__pipelineWorker ??= {
  started: false,
  timer: null,
  ticking: false,
  again: false,
  running: new Map(),
  tick: async () => {},
})

const iso = (ms = Date.now()) => new Date(ms).toISOString()

/** Starts the worker once per server. */
export function startPipeline() {
  worker.tick = tick
  if (worker.started) return
  worker.started = true
  schedule(0)
}

/** A pass soon: after a new job, a retry, a resume. */
export function kickPipeline() {
  if (!worker.started) startPipeline()
  else schedule(0)
}

function schedule(ms: number) {
  if (worker.timer) clearTimeout(worker.timer)
  worker.timer = setTimeout(() => {
    worker.timer = null
    void worker.tick()
  }, ms)
}

async function tick() {
  if (worker.ticking) {
    worker.again = true
    return
  }
  worker.ticking = true
  try {
    do {
      worker.again = false
      await pass()
    } while (worker.again)
  } catch (error) {
    console.error("Upload pipeline:", error)
  } finally {
    worker.ticking = false
    schedule(TICK)
  }
}

/** Whether the item's job lets it go on now. */
function mayGo(item: JobItem, job: UploadJob, paused: boolean) {
  const sent = !!item.steps?.gelatoSent
  if (sent && !item.done.listing) return true
  if (paused) return false
  if (job.status === "running") return true
  // A cancelled job's posters already with Gelato end on Etsy, inactive.
  return job.status === "cancelled" && sent
}

async function due(item: JobItem, now: number) {
  if (item.status === "queued") return true
  if (item.status !== "waiting") return false
  if (item.wakeAt) return Date.parse(item.wakeAt) <= now
  // Waiting without a time: for its copy, until the copywriter is through.
  if (item.stage !== "copy" || !item.draftId) return true
  const draft = await getDraft(item.draftId).catch(() => null)
  return !draft || (draft.copy !== "queued" && draft.copy !== "writing")
}

function resourceOf(item: JobItem, job: UploadJob, account: Account) {
  switch (item.stage) {
    case "copy":
      return "copy"
    case "print":
      return "cpu"
    case "media":
      return "render"
    case "gelato":
      // Only the create holds the store; watching Gelato publish a product made holds nothing.
      return job.dryRun || item.gelatoProductId ? null : `gelato:${account.gelato?.storeId ?? account.id}`
    default:
      return job.dryRun ? null : `etsy:${account.id}`
  }
}

/** An earlier poster of the same account in the job that hasn't gone to Gelato yet. */
function behind(job: UploadJob, item: JobItem, items: Map<string, JobItem>) {
  for (const id of job.items) {
    if (id === item.id) return false
    const other = items.get(id)
    if (other && other.account === item.account && !other.steps?.gelatoSent && !isFinished(other)) return true
  }
  return false
}

async function pass() {
  if (!(await isLeader())) return
  // Items a stopped server was running (this one, before a restart) go back in line.
  const back = await requeueInterrupted()
  if (back) console.log(`Upload pipeline: ${back} interrupted item${back === 1 ? "" : "s"} back in line`)
  await settleJobs()
  const { jobs, items, paused } = await readPipeline()
  const byId = new Map(items.map((i) => [i.id, i]))
  const now = Date.now()
  const busy = new Map<string, number>()
  for (const resource of worker.running.values()) if (resource) busy.set(resource, (busy.get(resource) ?? 0) + 1)

  for (const job of [...jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (job.status === "done") continue
    for (const id of job.items) {
      const item = byId.get(id)
      if (!item || worker.running.has(id) || !mayGo(item, job, paused) || !(await due(item, now))) continue
      const account = await getAccount(item.account).catch(() => null)
      if (!account) {
        await patchItem(id, (i) => Object.assign(i, { status: "failed", error: "Its upload account is gone" }))
        continue
      }
      const resource = resourceOf(item, job, account)
      if (resource && (busy.get(resource) ?? 0) >= LIMITS[resource.split(":")[0]]) continue
      if (item.stage === "gelato" && !job.dryRun && !item.steps?.gelatoSent && behind(job, item, byId)) continue
      if (resource) busy.set(resource, (busy.get(resource) ?? 0) + 1)
      worker.running.set(id, resource)
      void run(id, account).finally(() => {
        worker.running.delete(id)
        kickPipeline()
      })
    }
  }
}

function context(item: JobItem, job: UploadJob, account: Account, orientation: Orientation): StageContext {
  const ctx: StageContext = {
    item,
    job,
    account,
    orientation,
    async save(patch) {
      ctx.item = await patchItem(item.id, (i) => Object.assign(i, patch))
      return ctx.item
    },
    async step(name) {
      const at = iso()
      ctx.item = await patchItem(item.id, (i) => {
        i.steps = { ...i.steps, [name]: at }
      })
      return at
    },
    async unstep(name) {
      ctx.item = await patchItem(item.id, (i) => {
        if (i.steps) delete i.steps[name]
      })
    },
    did: (name) => ctx.item.steps?.[name],
    progress: (text) => setLiveNote(item.id, text),
    payload: (name, body) => savePayload(item.id, name, body),
  }
  return ctx
}

/** Runs the item's stage and moves it on, or sets it back. */
async function run(id: string, account: Account) {
  let item: JobItem
  try {
    item = await patchItem(id, (i) => {
      // Taken meanwhile by a server that led before this one.
      if (i.status === "running" && i.runner !== instanceId) throw new Error(`${id} runs elsewhere already`)
      Object.assign(i, { status: "running", runner: instanceId, note: undefined, wakeAt: undefined })
    })
  } catch (error) {
    console.error("Upload pipeline:", error)
    return
  }
  const stage = item.stage
  try {
    const job = (await readPipeline()).jobs.find((j) => j.id === item.jobId)
    if (!job) throw new NotFoundError("Unknown upload job")
    const result = await runStage(context(item, job, account, await orientationOf(item)))
    await patchItem(id, (i) => {
      i.done = { ...i.done, [stage]: { at: iso(), ...(result.note && { note: result.note }) } }
      Object.assign(i, { attempts: 0, runner: undefined, error: undefined, note: undefined, wakeAt: undefined })
      if (i.status === "cancelled") return
      const next = STAGES[STAGES.indexOf(stage) + 1]
      if (!next) i.status = "done"
      else if (result.wait) Object.assign(i, { stage: next, status: "waiting", wakeAt: iso(Date.now() + result.wait.ms), note: result.wait.note })
      else Object.assign(i, { stage: next, status: "queued" })
    })
  } catch (error) {
    const quota = await quotaWait(error, account)
    await patchItem(id, (i) => setBack(i, error, quota)).catch((e) => console.error("Upload pipeline:", e))
    if (!(error instanceof Parked) && quota === null) console.warn(`Upload pipeline: ${id} at ${stage}:`, error)
  } finally {
    setLiveNote(id, null)
  }
}

/** How long to wait when Etsy said the account's quota is gone; null for any other error. */
async function quotaWait(error: unknown, account: Account) {
  if (!(error instanceof EtsyApiError) || error.status !== 429) return null
  const blocked = (await usageOf(account.id).catch(() => null))?.blockedUntil
  return blocked ? Math.max(60_000, Date.parse(blocked) - Date.now()) : QUOTA_WAIT
}

function setBack(item: JobItem, error: unknown, quota: number | null) {
  item.runner = undefined
  if (item.status === "cancelled") return
  if (error instanceof Parked) {
    Object.assign(item, {
      status: "waiting",
      note: error.message,
      wakeAt: error.wait > 0 ? iso(Date.now() + error.wait) : undefined,
    })
    return
  }
  if (quota !== null) {
    Object.assign(item, { status: "waiting", note: "Etsy's quota is used up for now", wakeAt: iso(Date.now() + quota) })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  const attempts = item.attempts + 1
  const fatal =
    error instanceof Fatal || error instanceof NotFoundError || (error instanceof EtsyApiError && error.status === 404)
  if (fatal || attempts >= MAX_ATTEMPTS) {
    Object.assign(item, { status: "failed", error: message, attempts, note: undefined, wakeAt: undefined })
    return
  }
  const pause = Math.min(MAX_BACKOFF, BACKOFF * 2 ** (attempts - 1))
  Object.assign(item, {
    status: "waiting",
    error: message,
    attempts,
    note: `Trying again after: ${message}`,
    wakeAt: iso(Date.now() + pause),
  })
}
