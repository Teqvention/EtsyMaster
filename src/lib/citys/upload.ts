import { listAccounts } from "@/lib/accounts/store"
import type { Account } from "@/lib/accounts/types"
import { createAction } from "@/lib/artikel/actions"
import { newId, readDoc, updateDoc } from "@/lib/db/documents"
import { getSet } from "@/lib/generation/storage"
import { listChains } from "@/lib/mockups/chains"
import { accountMissing, storageBlocker } from "@/lib/pipeline/blockers"
import { PlanError } from "@/lib/pipeline/errors"
import { change, readPipeline } from "@/lib/pipeline/store"
import type { JobItem, UploadJob } from "@/lib/pipeline/types"
import { getProfile } from "@/lib/pricing/store"
import { leavesFree, posterKey } from "@/lib/uploads/groups"

import { setStatus } from "./artikel"
import { listCompositions } from "./composition/store"
import { cityOutputs, type CityOutput } from "./outputs"
import { ourCoverage, isCovered, type Coverage, type OurListing } from "./ours"
import { ranking } from "./ranking"
import { citySettings } from "./settings"
import { TIERS, type Tier } from "./types"

// Citys → Upload: approved city posters to our city shops, in groups. Each
// group takes the posters of some styles (or all), of places of some tiers,
// open places only if asked (none of our listings confirmed there), sets
// them in a composition (or uploads the photo alone) and sends them to one
// shop; nothing is split over shops by itself. The plan orders them best
// places first, keeps a style's posters together when asked, and with
// several styles can let a place go up once a day per shop.
//
// Our listings marked "replace" are slots: a new poster of the same place
// takes its old one's slot first, then the slots of places with no demand
// (F) or none at all. The new poster goes up as a proper new listing (its
// Gelato connection made by the pipeline); once it's live, the old one it
// replaces is deactivated on the user's word (Artikel's bulk action).
//
// The upload itself is the pipeline's: a job whose items start at the
// compose stage (pipeline/stages.ts), so the worker composes, writes the
// city copy, makes the print files per size and the mockups, and lists.

const FILE = "citys/upload"

export type UploadGroupSpec = {
  id: string
  /** Output groups as Outputs shows them ("style:<id>", "real", "real:<looks>", "idea"); all when empty. */
  styles: string[]
  /** Tiers of the places it takes; A to E when empty. */
  tiers: Tier[]
  /** Only places with no confirmed listing of ours. */
  openOnly: boolean
  /** Composition the photos are set in; null uploads the photo alone. */
  compositionId: string | null
  account: string
  /** Posters it takes per start at most. */
  count: number
}

export type CityUploadSettings = {
  groups: UploadGroupSpec[]
  /** A place goes up at most once a day per shop (for plans mixing styles). */
  oncePerDay: boolean
  /** A style's posters one after another in the upload order. */
  adjacent: boolean
  /** New posters take the slots of our listings to replace first. */
  slots: boolean
  activate: boolean
}

const DEFAULTS: CityUploadSettings = { groups: [], oncePerDay: true, adjacent: true, slots: true, activate: true }

export type QueueItem = {
  key: string
  setId: string
  outputId: string
  thumb: string | null
  placeId: string
  place: string
  country: string
  tier: Tier | null
  style: string
  styleLabel: string
  detail: string
  account: string
  compositionId: string | null
  group: string
  /** The old listing whose slot it takes. */
  replaces?: { listingId: number; title: string; image: string | null; why: "same place" | "free slot" }
}

export type UploadPlanView = {
  queue: QueueItem[]
  skipped: { reason: string; count: number }[]
  /** Slots to replace per account, and how many the plan uses. */
  slots: Record<string, { free: number; used: number }>
}

export async function uploadSettings(): Promise<CityUploadSettings> {
  return { ...DEFAULTS, ...(await readDoc<Partial<CityUploadSettings> | null>(FILE, null)) }
}

const clampCount = (n: unknown) => Math.min(500, Math.max(1, Math.round(Number(n) || 1)))

export async function saveUploadSettings(patch: Partial<CityUploadSettings>): Promise<CityUploadSettings> {
  const current = await uploadSettings()
  const next: CityUploadSettings = {
    ...current,
    ...(typeof patch.oncePerDay === "boolean" && { oncePerDay: patch.oncePerDay }),
    ...(typeof patch.adjacent === "boolean" && { adjacent: patch.adjacent }),
    ...(typeof patch.slots === "boolean" && { slots: patch.slots }),
    ...(typeof patch.activate === "boolean" && { activate: patch.activate }),
    ...(Array.isArray(patch.groups) && {
      groups: patch.groups.slice(0, 20).map((g) => ({
        id: typeof g.id === "string" && g.id ? g.id : newId("g-"),
        styles: Array.isArray(g.styles) ? g.styles.filter((s) => typeof s === "string") : [],
        tiers: Array.isArray(g.tiers) ? g.tiers.filter((t): t is Tier => TIERS.includes(t)) : [],
        openOnly: g.openOnly !== false,
        compositionId: typeof g.compositionId === "string" ? g.compositionId : null,
        account: typeof g.account === "string" ? g.account : "",
        count: clampCount(g.count),
      })),
    }),
  }
  await updateDoc<CityUploadSettings | null>(FILE, null, () => next)
  return next
}

// --- State for the page ---

export type UploadAccount = {
  id: string
  label: string
  shop: string | null
  role: Account["role"]
  /** What a live upload still needs, in words; empty when ready. */
  missing: string[]
  listings: number
  /** Our listings marked to replace there. */
  slots: number
}

export type CityJobView = {
  id: string
  createdAt: string
  status: UploadJob["status"]
  dryRun: boolean
  total: number
  live: number
  failed: number
  running: number
  /** Live posters whose old listing (the slot they took) is still active. */
  toRetire: { listingId: number; account: string; title: string }[]
  /** A server without city uploads failed them: this version has to run the background work. */
  outdated: number
}

export type CityUploadState = {
  settings: CityUploadSettings
  accounts: UploadAccount[]
  compositions: { id: string; name: string; preview: string; ratio: number }[]
  styles: { key: string; label: string; approved: number }[]
  jobs: CityJobView[]
  blockers: string[]
}

const approved = (o: CityOutput) => o.status === "done" && o.review === "approved" && !!o.file

export async function cityUploadState(): Promise<CityUploadState> {
  const [settings, cityConfig, accounts, compositions, outputs, coverage, pipeline, storage] = await Promise.all([
    uploadSettings(),
    citySettings(),
    listAccounts(),
    listCompositions().catch(() => []),
    cityOutputs().catch(() => [] as CityOutput[]),
    ourCoverage().catch(() => new Map<string, Coverage>()),
    readPipeline(),
    storageBlocker(),
  ])
  const ours = [...coverage.values()].flatMap((c) => c.listings)
  const views: UploadAccount[] = []
  for (const a of accounts.filter((x) => cityConfig.accounts.includes(x.id))) {
    const missing = a.role === "upload" ? await accountMissing(a) : ["Role “Upload” (Settings → Accounts)", ...(await accountMissing(a))]
    const mine = new Map(ours.filter((l) => l.account === a.id).map((l) => [l.listingId, l]))
    views.push({
      id: a.id,
      label: a.label,
      shop: a.shop?.name ?? null,
      role: a.role,
      missing: [...new Set(missing)],
      listings: mine.size,
      slots: [...mine.values()].filter((l) => l.status === "replace" && l.state === "active").length,
    })
  }

  const styles = new Map<string, { key: string; label: string; approved: number }>()
  for (const o of outputs) {
    const s = styles.get(o.group) ?? { key: o.group, label: o.groupLabel, approved: 0 }
    if (approved(o)) s.approved++
    styles.set(o.group, s)
  }

  return {
    settings,
    accounts: views,
    compositions: compositions.map((c) => ({ id: c.id, name: c.name, preview: c.preview, ratio: c.ratio })),
    styles: [...styles.values()].sort((a, b) => b.approved - a.approved),
    jobs: jobViews(pipeline.jobs, pipeline.items, ours),
    blockers: storage ? [storage] : [],
  }
}

function jobViews(jobs: UploadJob[], items: JobItem[], ours: OurListing[]): CityJobView[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const active = new Map(ours.filter((l) => l.state === "active").map((l) => [l.listingId, l]))
  return jobs
    .map((job) => {
      const list = job.items.map((id) => byId.get(id)).filter((i): i is JobItem => !!i?.city)
      if (!list.length) return null
      const live = list.filter((i) => i.status === "done")
      return {
        id: job.id,
        createdAt: job.createdAt,
        status: job.status,
        dryRun: job.dryRun,
        total: list.length,
        live: live.length,
        failed: list.filter((i) => i.status === "failed").length,
        running: list.filter((i) => i.status === "running" || i.status === "queued" || i.status === "waiting").length,
        toRetire: job.dryRun
          ? []
          : live.flatMap((i) => {
              const old = i.city?.replaces ? active.get(i.city.replaces) : undefined
              return old ? [{ listingId: old.listingId, account: old.account, title: old.title }] : []
            }),
        outdated: list.filter((i) => i.status === "failed" && /is not a function|undefined/i.test(i.error ?? "") && i.stage === "compose").length,
      }
    })
    .filter((j): j is CityJobView => !!j)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12)
}

// --- The plan ---

const TIER_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 }
const today = () => new Date().toISOString().slice(0, 10)

export async function planUpload(settings: CityUploadSettings): Promise<UploadPlanView> {
  const [outputs, coverage, pipeline, ranked] = await Promise.all([
    cityOutputs(),
    ourCoverage().catch(() => new Map<string, Coverage>()),
    readPipeline(),
    ranking().catch(() => null),
  ])
  const position = new Map((ranked?.places ?? []).map((p) => [p.id, p.position]))
  const jobs = new Map(pipeline.jobs.map((j) => [j.id, j]))
  const taken = new Set(pipeline.items.filter((i) => !jobs.get(i.jobId)?.dryRun && !leavesFree(i, jobs.get(i.jobId))).map((i) => posterKey(i.groupId, i.outputId)))
  // Places that went up today (or are on their way), per shop.
  const todayPlaces = new Set(
    pipeline.items.filter((i) => i.city && i.createdAt.startsWith(today()) && !leavesFree(i, jobs.get(i.jobId))).map((i) => `${i.account}|${i.city!.placeId}`)
  )

  const skipped = new Map<string, number>()
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1)
  const pool = outputs.filter(approved)
  const used = new Set<string>()
  const queue: QueueItem[] = []

  for (const group of settings.groups) {
    if (!group.account) continue
    const tiers = group.tiers.length ? group.tiers : (["A", "B", "C", "D", "E"] as Tier[])
    const candidates = pool
      .filter((o) => !group.styles.length || group.styles.includes(o.group))
      .filter((o) => {
        const key = posterKey(o.setId, o.outputId)
        if (used.has(key)) return false
        if (taken.has(key)) return skip("Uploaded or on its way already"), false
        if (!o.tier || !tiers.includes(o.tier)) return skip("Its place's tier isn't in the group"), false
        if (group.openOnly && isCovered(coverage.get(o.placeId))) return skip("We have that place confirmed already"), false
        return true
      })
      .sort(
        (a, b) =>
          (TIER_RANK[a.tier ?? "F"] ?? 9) - (TIER_RANK[b.tier ?? "F"] ?? 9) ||
          (position.get(a.placeId) ?? 1e9) - (position.get(b.placeId) ?? 1e9) ||
          a.createdAt.localeCompare(b.createdAt)
      )
    let took = 0
    for (const o of candidates) {
      if (took >= group.count) break
      const day = `${group.account}|${o.placeId}`
      if (settings.oncePerDay && todayPlaces.has(day)) {
        skip("That place goes up once a day per shop")
        continue
      }
      todayPlaces.add(day)
      used.add(posterKey(o.setId, o.outputId))
      queue.push({
        key: posterKey(o.setId, o.outputId),
        setId: o.setId,
        outputId: o.outputId,
        thumb: o.thumb,
        placeId: o.placeId,
        place: o.place,
        country: o.country,
        tier: o.tier,
        style: o.group,
        styleLabel: o.groupLabel,
        detail: o.detail,
        account: group.account,
        compositionId: group.compositionId,
        group: group.id,
      })
      took++
    }
  }

  // The order: a style's posters together when asked (groups in their order,
  // best places first within), else the groups taking turns.
  let ordered = queue
  if (settings.adjacent) {
    const styleOrder = [...new Set(queue.map((q) => `${q.group}|${q.style}`))]
    ordered = styleOrder.flatMap((s) => queue.filter((q) => `${q.group}|${q.style}` === s))
  } else {
    const byGroup = settings.groups.map((g) => queue.filter((q) => q.group === g.id))
    ordered = []
    for (let i = 0; byGroup.some((list) => i < list.length); i++) for (const list of byGroup) if (list[i]) ordered.push(list[i])
  }

  // Slots: a new poster of a place takes the slot of our old listing of it first, then any slot left.
  const slots: UploadPlanView["slots"] = {}
  if (settings.slots) {
    const free = new Map<string, OurListing[]>()
    for (const c of coverage.values()) {
      for (const l of c.listings) {
        if (l.status !== "replace" || l.state !== "active") continue
        if (!free.has(l.account)) free.set(l.account, [])
        if (!free.get(l.account)!.some((x) => x.listingId === l.listingId)) free.get(l.account)!.push(l)
      }
    }
    const placeOf = new Map<number, string>()
    for (const [placeId, c] of coverage) for (const l of c.listings) placeOf.set(l.listingId, placeId)
    for (const [account, list] of free) slots[account] = { free: list.length, used: 0 }
    const pending = new Set(pipeline.items.filter((i) => i.city?.replaces && !leavesFree(i, jobs.get(i.jobId))).map((i) => i.city!.replaces!))
    const take = (q: QueueItem, match: (l: OurListing) => boolean, why: "same place" | "free slot") => {
      const list = free.get(q.account) ?? []
      const at = list.findIndex((l) => !pending.has(l.listingId) && match(l))
      if (at < 0) return false
      const [slot] = list.splice(at, 1)
      q.replaces = { listingId: slot.listingId, title: slot.title, image: slot.image, why }
      slots[q.account].used++
      return true
    }
    for (const q of ordered) take(q, (l) => placeOf.get(l.listingId) === q.placeId, "same place")
    // Free slots: oldest listings of places without demand go first.
    for (const list of free.values()) list.sort((a, b) => a.createdAt - b.createdAt)
    for (const q of ordered) if (!q.replaces) take(q, () => true, "free slot")
  }

  return { queue: ordered, skipped: [...skipped].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count), slots }
}

// --- Starting ---

/**
 * Makes the pipeline job: its items in the plan's order, each starting at
 * the compose stage. Live runs need every shop ready for uploads; test runs
 * write down what would go out and send nothing.
 */
export async function startUpload(settings: CityUploadSettings, { dryRun }: { dryRun: boolean }) {
  const plan = await planUpload(settings)
  if (!plan.queue.length) throw new PlanError("The plan has no posters")
  const accounts = new Map((await listAccounts()).map((a) => [a.id, a]))
  const used = [...new Set(plan.queue.map((q) => q.account))].map((id) => {
    const account = accounts.get(id)
    if (!account) throw new PlanError(`${id} isn't an account`)
    return account
  })
  if (!dryRun) {
    const storage = await storageBlocker()
    if (storage) throw new PlanError(storage)
    for (const account of used) {
      if (account.role !== "upload") throw new PlanError(`${account.label} isn't an upload account yet (Settings → Accounts)`)
      const missing = await accountMissing(account)
      if (missing.length) throw new PlanError(`${account.label} isn't ready for live uploads: ${missing.join(", ")}`)
      const profile = await getProfile(account.priceProfileId!).catch(() => null)
      if (!profile) throw new PlanError(`${account.label}'s price profile is gone`)
    }
  }
  // Every poster's set must still hold it.
  for (const q of plan.queue) {
    const set = await getSet(q.setId).catch(() => null)
    if (!set?.outputs.some((o) => o.id === q.outputId && o.file)) throw new PlanError(`A poster of ${q.place} is gone: plan again`)
  }

  const chains = await listChains()
  const fallback = chains.find((c) => c.isDefault)?.id ?? null
  const chainOf = (account: Account) => (chains.some((c) => c.id === account.chainId) ? account.chainId : fallback)

  const now = new Date().toISOString()
  const job: UploadJob = { id: newId("j-"), status: "running", activate: settings.activate, dryRun, items: [], createdAt: now, updatedAt: now }
  const items: JobItem[] = plan.queue.map((q) => ({
    id: newId("i-"),
    jobId: job.id,
    groupId: q.setId,
    outputId: q.outputId,
    draftId: null,
    account: q.account,
    chainId: chainOf(accounts.get(q.account)!),
    status: "queued",
    stage: "compose",
    done: {},
    attempts: 0,
    city: {
      placeId: q.placeId,
      compositionId: q.compositionId,
      style: q.style,
      group: q.group,
      ...(q.replaces && !dryRun && { replaces: q.replaces.listingId }),
    },
    createdAt: now,
    updatedAt: now,
  }))
  return change((data) => {
    let taking = items
    if (!dryRun) {
      const jobs = new Map(data.jobs.map((j) => [j.id, j]))
      const taken = new Set(data.items.filter((i) => !jobs.get(i.jobId)?.dryRun && !leavesFree(i, jobs.get(i.jobId))).map((i) => posterKey(i.groupId, i.outputId)))
      taking = items.filter((i) => !taken.has(posterKey(i.groupId, i.outputId)))
      if (!taking.length) throw new PlanError("Every poster of the plan is on Etsy or on its way already")
    }
    job.items = taking.map((i) => i.id)
    data.jobs.push(job)
    data.items.push(...taking)
    return { job: job.id, items: taking.length, skipped: items.length - taking.length }
  })
}

/** Deactivates the old listings whose slots live posters took (Artikel's bulk action), and marks them offline. */
export async function retireReplaced(listingIds: number[]) {
  if (!listingIds.length) throw new PlanError("Nothing to retire")
  await createAction({ kind: "state", state: "inactive" }, { kind: "listings", ids: listingIds })
  await setStatus(listingIds, "offline")
  return { retired: listingIds.length }
}
