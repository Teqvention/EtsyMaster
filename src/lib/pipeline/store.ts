import { listAccounts } from "@/lib/accounts/store"
import { newId, readDoc, updateDoc } from "@/lib/db/documents"
import { isLive } from "@/lib/db/workers"
import { getSet } from "@/lib/generation/storage"
import { listChains } from "@/lib/mockups/chains"
import { NotFoundError } from "@/lib/mockups/storage"
import { getProfile } from "@/lib/pricing/store"
import { isApproved, leavesFree, posterKey } from "@/lib/uploads/groups"
import type { Draft } from "@/lib/uploads/types"

import { accountMissing, storageBlocker } from "./blockers"
import { PlanError } from "./errors"
import { distribute, uploadOrder, type Assignment } from "./plan"
import type { JobItem, PlanGroup, UploadJob, UploadPlan } from "./types"

// Jobs and their items in one document ("pipeline/jobs"), read from memory
// (see db/documents.ts). Every change goes through `change`, one after
// another across every server, so the worker and the routes never write over
// each other. Items are kept for good: Artikel finds the poster behind a
// listing through them. What a test run would have sent sits apart, per item
// (pipeline/items/<id>/payloads), so the list stays small.

const FILE = "pipeline/jobs"
/** The upload drafts, read (never written) to find a poster's draft before the worker makes one. */
const DRAFTS = "uploads/drafts"

export type PipelineData = { jobs: UploadJob[]; items: JobItem[]; paused: boolean }

// On globalThis: route handlers, the worker and server components load
// separate copies of this module, and all must see one state.
const global = globalThis as typeof globalThis & { __pipelineNotes?: Map<string, string> }

const iso = (ms = Date.now()) => new Date(ms).toISOString()

const complete = (saved: Partial<PipelineData>): PipelineData => ({
  jobs: saved.jobs ?? [],
  items: saved.items ?? [],
  paused: !!saved.paused,
})

/** Jobs and items as they are now. Shared: never change what this answers. */
export async function readPipeline(): Promise<PipelineData> {
  return complete(await readDoc<Partial<PipelineData>>(FILE, {}))
}

/** Changes jobs and items in one step, after every other change on any server; answers what `edit` returns. */
export async function change<T>(edit: (data: PipelineData) => T): Promise<T> {
  let result!: T
  await updateDoc<Partial<PipelineData>>(FILE, {}, (saved) => {
    const data = complete(saved)
    result = edit(data)
    return data
  })
  return result
}

export const isFinished = (item: JobItem) =>
  item.status === "done" || item.status === "failed" || item.status === "cancelled"

// --- Progress notes ---
// What a running stage is doing right now ("Photo 3 of 5"): kept in memory
// only, so a render's progress doesn't rewrite the file every second.

const notes = (global.__pipelineNotes ??= new Map<string, string>())

export function setLiveNote(itemId: string, note: string | null) {
  if (note) notes.set(itemId, note)
  else notes.delete(itemId)
}

export const liveNote = (itemId: string) => notes.get(itemId)

// --- Items ---

export async function getJob(id: string) {
  const job = (await readPipeline()).jobs.find((j) => j.id === id)
  if (!job) throw new NotFoundError("Unknown upload job")
  return job
}

const payloadFile = (itemId: string) => `pipeline/items/${itemId}/payloads`

/** One item with its payloads: what its test run would have sent, the product ids an inventory change left. */
export async function getItem(id: string): Promise<JobItem> {
  const item = (await readPipeline()).items.find((i) => i.id === id)
  if (!item) throw new NotFoundError("Unknown upload item")
  const payloads = await readPayloads(id)
  return Object.keys(payloads).length ? { ...item, payloads } : item
}

export const readPayloads = (itemId: string) => readDoc<Record<string, unknown>>(payloadFile(itemId), {})

export async function savePayload(itemId: string, name: string, body: unknown) {
  await updateDoc<Record<string, unknown>>(payloadFile(itemId), {}, (payloads) => ({ ...payloads, [name]: body }))
}

/** Changes one item (its job may change along); answers with the item as saved. */
export function patchItem(id: string, edit: (item: JobItem, job: UploadJob) => void) {
  return change((data) => {
    const item = data.items.find((i) => i.id === id)
    if (!item) throw new NotFoundError("Unknown upload item")
    const job = data.jobs.find((j) => j.id === item.jobId)
    if (!job) throw new NotFoundError("Unknown upload job")
    edit(item, job)
    item.updatedAt = iso()
    job.updatedAt = item.updatedAt
    return item
  })
}

/** The upload draft of a poster, if it has one. */
export async function findDraftId(groupId: string, outputId: string) {
  const drafts = await readDoc<Draft[]>(DRAFTS, [])
  return drafts.find((d) => d.generationId === groupId && d.outputId === outputId)?.id ?? null
}

/** The pipeline item that made this Etsy listing, if one did (the newest, should there be two). */
export async function itemForListing(listingId: number): Promise<JobItem | null> {
  const { jobs, items } = await readPipeline()
  const real = new Set(jobs.filter((j) => !j.dryRun).map((j) => j.id))
  return items.findLast((i) => i.etsyListingId === listingId && real.has(i.jobId)) ?? null
}

// --- Jobs ---

/**
 * Makes a job of `plan`: every poster approved and in the plan once, every
 * account an upload account, the chains there. A live job also needs print
 * file hosting and each of its accounts set up for live uploads (shop,
 * grant, Gelato store and template, price profile), and leaves out every
 * poster that is on Etsy or on its way there (`skipped`). The mockup chain
 * is settled here per account: the plan's pick, else the account's own, else
 * the default one, else (no chain at all) the poster alone.
 */
export async function createJob(plan: UploadPlan): Promise<{ job: UploadJob; skipped: number }> {
  const asked = Array.isArray(plan?.groups) ? plan.groups : []
  if (!asked.some((g) => Array.isArray(g?.outputs) && g.outputs.length)) throw new PlanError("The plan has no posters")
  const dryRun = plan.dryRun === true

  const accounts = new Map((await listAccounts()).map((a) => [a.id, a]))
  const uploadAccount = (id: unknown) => {
    const account = typeof id === "string" ? accounts.get(id) : undefined
    if (!account || account.role !== "upload") throw new PlanError(`${String(id)} isn't an upload account`)
    return account
  }

  // A poster deleted or no longer approved since the dialog opened is left
  // out (counted in `skipped`); the rest still goes.
  const groups: PlanGroup[] = []
  const seen = new Set<string>()
  const landscape = new Map<string, boolean>()
  let dropped = 0
  for (const group of asked) {
    const distribution = group.distribution
    if (distribution?.mode === "account") uploadAccount(distribution.account)
    else if (distribution?.mode === "split") {
      if (!distribution.accounts?.length) throw new PlanError("A group to split over accounts names none")
      distribution.accounts.forEach(uploadAccount)
    } else if (distribution?.mode === "each") Object.values(distribution.accounts ?? {}).forEach(uploadAccount)
    else throw new PlanError("A group of the plan doesn't say where its posters go")
    const set = await getSet(group.groupId).catch(() => null)
    const outputs: string[] = []
    for (const outputId of group.outputs ?? []) {
      const key = posterKey(group.groupId, outputId)
      if (seen.has(key)) throw new PlanError("A poster is in the plan twice")
      seen.add(key)
      const output = set?.outputs.find((o) => o.id === outputId)
      if (!output || !isApproved(output)) {
        dropped++
        continue
      }
      landscape.set(key, (output.width ?? 0) > (output.height ?? 0))
      outputs.push(outputId)
    }
    if (outputs.length) groups.push({ ...group, outputs })
  }
  if (!groups.length) {
    throw new PlanError(seen.size === 1 ? "The poster isn't approved any more" : "No poster of the plan is approved any more")
  }

  let order: Assignment[]
  try {
    order = uploadOrder(distribute(groups))
  } catch (error) {
    throw new PlanError((error as Error).message)
  }
  const used = [...new Set(order.map((a) => a.account))].map(uploadAccount)

  const chains = await listChains()
  const fallback = chains.find((c) => c.isDefault)?.id ?? null
  const chainOf = new Map<string, string | null>()
  for (const account of used) {
    const asked = plan.chains && Object.hasOwn(plan.chains, account.id) ? plan.chains[account.id] : undefined
    const own = chains.some((c) => c.id === account.chainId) ? account.chainId : fallback
    const chainId = asked === undefined ? own : asked
    if (chainId !== null) {
      const chain = chains.find((c) => c.id === chainId)
      if (!chain) throw new PlanError(`The mockup chain for ${account.label} is gone: pick another`)
      if (!chain.scenes.length) throw new PlanError(`The mockup chain "${chain.name}" has no photos`)
    }
    chainOf.set(account.id, chainId)
  }

  if (!dryRun) {
    const storage = await storageBlocker()
    if (storage) throw new PlanError(storage)
    for (const account of used) {
      const hor = order.some((a) => a.account === account.id && landscape.get(posterKey(a.groupId, a.outputId)))
      const missing = await accountMissing(account, { landscape: hor })
      if (missing.length) throw new PlanError(`${account.label} isn't ready for live uploads: ${missing.join(", ")}`)
      const profile = await getProfile(account.priceProfileId!).catch(() => null)
      if (!profile) throw new PlanError(`${account.label}'s price profile is gone`)
      if (account.shop?.currency && account.shop.currency !== profile.currency) {
        throw new PlanError(`${account.label} sells in ${account.shop.currency} but its prices are in ${profile.currency}`)
      }
    }
  }

  const drafts = new Map((await readDoc<Draft[]>(DRAFTS, [])).map((d) => [posterKey(d.generationId, d.outputId), d]))
  const now = iso()
  const job: UploadJob = {
    id: newId("j-"),
    status: "running",
    activate: plan.activate === true,
    dryRun,
    items: [],
    createdAt: now,
    updatedAt: now,
  }
  const items = order.map((a): JobItem => {
    const draft = drafts.get(posterKey(a.groupId, a.outputId))
    return {
      id: newId("i-"),
      jobId: job.id,
      groupId: a.groupId,
      outputId: a.outputId,
      draftId: draft?.id ?? null,
      account: a.account,
      chainId: chainOf.get(a.account) ?? null,
      status: "queued",
      stage: "copy",
      done: {},
      attempts: 0,
      ...(draft?.title && { title: draft.title }),
      createdAt: now,
      updatedAt: now,
    }
  })

  return change((data) => {
    let taking = items
    if (!dryRun) {
      // On Etsy or on its way meanwhile (a failed one is retried where it is):
      // left out of the job, the rest still goes.
      const jobs = new Map(data.jobs.map((j) => [j.id, j]))
      const taken = new Set(
        data.items
          .filter((i) => !jobs.get(i.jobId)?.dryRun && !leavesFree(i, jobs.get(i.jobId)))
          .map((i) => posterKey(i.groupId, i.outputId))
      )
      taking = items.filter((item) => {
        const key = posterKey(item.groupId, item.outputId)
        return drafts.get(key)?.status !== "uploaded" && !taken.has(key)
      })
      if (!taking.length) {
        throw new PlanError(
          items.length === 1 ? "The poster is on Etsy or on its way already" : "Every poster of the plan is on Etsy or on its way already"
        )
      }
    }
    job.items = taking.map((i) => i.id)
    data.jobs.push(job)
    data.items.push(...taking)
    return { job, skipped: dropped + items.length - taking.length }
  })
}

/** Pauses, resumes or cancels a job. Cancelling stops every item Gelato hasn't got yet; the rest end inactive on Etsy. */
export function patchJob(id: string, status: unknown) {
  if (status !== "paused" && status !== "running" && status !== "cancelled") {
    throw new PlanError("A job can be paused, running or cancelled")
  }
  return change((data) => {
    const job = data.jobs.find((j) => j.id === id)
    if (!job) throw new NotFoundError("Unknown upload job")
    if (job.status === status) return job
    if (job.status === "done" || job.status === "cancelled") throw new PlanError(`The job is ${job.status} already`)
    const now = iso()
    job.status = status
    job.updatedAt = now
    if (status === "cancelled") {
      job.finishedAt = now
      for (const item of data.items) {
        if (item.jobId !== id || isFinished(item) || item.steps?.gelatoSent) continue
        Object.assign(item, { status: "cancelled", note: undefined, wakeAt: undefined, updatedAt: now })
      }
    }
    return job
  })
}

/** Runs a failed item's stage again (or a waiting one's now), with a fresh set of tries. */
export function retryItem(id: string) {
  return change((data) => {
    const item = data.items.find((i) => i.id === id)
    if (!item) throw new NotFoundError("Unknown upload item")
    const job = data.jobs.find((j) => j.id === item.jobId)!
    if (item.status !== "failed" && item.status !== "waiting") throw new PlanError("Only a failed or waiting poster can be retried")
    if (job.status === "cancelled" && !item.steps?.gelatoSent) throw new PlanError("Its upload was cancelled")
    const now = iso()
    Object.assign(item, { status: "queued", attempts: 0, error: undefined, note: undefined, wakeAt: undefined, updatedAt: now })
    // Another rewrite of the copy, another full wait for Gelato and the print route.
    if (item.steps) for (const step of ["copyRewrite", "publishSince", "verifySince", "reproveSince"]) delete item.steps[step]
    if (job.status === "done") Object.assign(job, { status: "running", finishedAt: undefined })
    job.updatedAt = now
    return item
  })
}

/** Takes an item out of its job, as long as nothing of it has gone to Gelato. */
export function cancelItem(id: string) {
  return change((data) => {
    const item = data.items.find((i) => i.id === id)
    if (!item) throw new NotFoundError("Unknown upload item")
    if (item.steps?.gelatoSent || item.gelatoProductId) {
      throw new PlanError("It's on its way to Etsy already, so it can't be taken out")
    }
    if (item.status === "done" || item.status === "cancelled") throw new PlanError(`It's ${item.status} already`)
    const now = iso()
    Object.assign(item, { status: "cancelled", note: undefined, wakeAt: undefined, updatedAt: now })
    const job = data.jobs.find((j) => j.id === item.jobId)!
    job.updatedAt = now
    settle(job, data)
    return item
  })
}

/** Holds every job (or lets them go on). Items already sent to Gelato still get their listing put right. */
export function setPaused(paused: unknown) {
  if (typeof paused !== "boolean") throw new PlanError("paused must be true or false")
  return change((data) => {
    data.paused = paused
  })
}

/** A running or paused job whose items are all finished is done. */
function settle(job: UploadJob, data: PipelineData) {
  if (job.status !== "running" && job.status !== "paused") return false
  const items = new Map(data.items.map((i) => [i.id, i]))
  if (!job.items.every((id) => { const item = items.get(id); return !item || isFinished(item) })) return false
  const now = iso()
  Object.assign(job, { status: "done", finishedAt: now, updatedAt: now })
  return true
}

/** Marks the jobs done whose items are all finished; writes only when one is. */
export async function settleJobs() {
  const { jobs, items } = await readPipeline()
  const byId = new Map(items.map((i) => [i.id, i]))
  const open = jobs.filter(
    (j) => (j.status === "running" || j.status === "paused") && j.items.every((id) => { const item = byId.get(id); return !item || isFinished(item) })
  )
  if (open.length) await change((data) => data.jobs.forEach((job) => settle(job, data)))
}

/** Items left running by a server that has stopped (this one, before a restart) go back in line. */
export async function requeueInterrupted() {
  const { items } = await readPipeline()
  const stopped = new Set<string>()
  for (const item of items) if (item.status === "running" && !(await isLive(item.runner))) stopped.add(item.id)
  if (!stopped.size) return 0
  return change((data) => {
    let count = 0
    for (const item of data.items) {
      if (item.status !== "running" || !stopped.has(item.id)) continue
      Object.assign(item, { status: "queued", runner: undefined, note: "Picked up again after a restart", updatedAt: iso() })
      count++
    }
    return count
  })
}
