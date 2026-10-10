import { newId } from "@/lib/db/documents"
import { listScenes, NotFoundError } from "@/lib/mockups/storage"
import { itemForListing } from "@/lib/pipeline/store"
import { getProfile } from "@/lib/pricing/store"
import {
  listings as storedListings,
  sections as storedSections,
  shopAccounts,
  syncBlocker,
} from "@/lib/sync/store"
import type { SyncedListing, SyncedSection } from "@/lib/sync/types"

import { plannedPrices, priceLabel } from "./pricing"
import { changeActions, kick, loadActions, reordered, settle } from "./queue"
import { InputError } from "./respond"
import { readTags } from "./tags"
import type {
  ActionItem,
  ActionParams,
  ActionPreview,
  ActionTarget,
  ActionView,
  BulkAction,
  ItemStatus,
  PreviewRow,
  Rounding,
} from "./types"

// Bulk actions as the page asks for them: checked, aimed at listings (picked,
// a shop, every shop, a tag or a section), previewed from the synced data
// without asking Etsy anything, then queued with each listing's plan.

const ROUNDINGS: Rounding[] = ["none", "90", "95", "99"]
/** Preview rows sent at most; the counts cover all. */
const PREVIEW_ROWS = 300

// --- Input ---

export function checkParams(raw: unknown): ActionParams {
  const p = (raw ?? {}) as Record<string, unknown>
  switch (p.kind) {
    case "price": {
      const value = Number(p.value)
      if (p.mode !== "percent" && p.mode !== "amount") throw new InputError("A price change is a percentage or an amount")
      if (!Number.isFinite(value) || value === 0) throw new InputError("The change needs a value")
      if (p.mode === "percent" && (value <= -90 || value > 500)) throw new InputError("Between −90 % and +500 %")
      if (p.mode === "amount" && (!Number.isInteger(value) || Math.abs(value) > 100_000)) {
        throw new InputError("Up to €1,000, in cents")
      }
      const rounding = ROUNDINGS.includes(p.rounding as Rounding) ? (p.rounding as Rounding) : "none"
      return { kind: "price", mode: p.mode, value, rounding }
    }
    case "profile":
      if (typeof p.profileId !== "string") throw new InputError("Which price profile?")
      return { kind: "profile", profileId: p.profileId }
    case "section": {
      const title = typeof p.title === "string" ? p.title.trim() : ""
      if (!title || title.length > 24) throw new InputError("A section name has 1 to 24 characters")
      return { kind: "section", title }
    }
    case "state":
      if (p.state !== "active" && p.state !== "inactive") throw new InputError("Active or inactive?")
      return { kind: "state", state: p.state }
    case "swapPhoto": {
      const rank = Number(p.rank)
      if (!Number.isInteger(rank) || rank < 1 || rank > 20) throw new InputError("Photo 1 to 20")
      if (typeof p.sceneId !== "string") throw new InputError("Which scene?")
      return { kind: "swapPhoto", rank, sceneId: p.sceneId }
    }
    case "reorderPhotos": {
      const order = Array.isArray(p.order) ? p.order.map(Number) : []
      if (!order.length || order.some((r) => !Number.isInteger(r) || r < 1 || r > 20)) {
        throw new InputError("The new order lists photos 1 to 20")
      }
      return { kind: "reorderPhotos", order: [...new Set(order)] }
    }
    default:
      throw new InputError("Unknown action")
  }
}

export function checkTarget(raw: unknown): ActionTarget {
  const t = (raw ?? {}) as Record<string, unknown>
  switch (t.kind) {
    case "listings": {
      const ids = Array.isArray(t.ids) ? t.ids.map(Number).filter((id) => Number.isInteger(id) && id > 0) : []
      if (!ids.length) throw new InputError("No listings picked")
      return { kind: "listings", ids }
    }
    case "shop":
      if (typeof t.account !== "string") throw new InputError("Which shop?")
      return { kind: "shop", account: t.account }
    case "all":
      return { kind: "all" }
    case "tag":
      if (typeof t.tagId !== "string") throw new InputError("Which tag?")
      return { kind: "tag", tagId: t.tagId }
    case "section":
      if (typeof t.account !== "string" || !Number.isInteger(t.sectionId)) throw new InputError("Which section?")
      return { kind: "section", account: t.account, sectionId: t.sectionId as number }
    default:
      throw new InputError("Unknown target")
  }
}

// --- Targets ---

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`

/** The listings an action is for, and the target in words. */
async function resolve(target: ActionTarget): Promise<{ list: SyncedListing[]; words: string }> {
  const [all, shops] = await Promise.all([storedListings(), shopAccounts()])
  const shopName = (account: string) => shops.find((a) => a.id === account)?.shop?.name ?? account
  switch (target.kind) {
    case "listings": {
      const ids = new Set(target.ids)
      const list = all.filter((l) => ids.has(l.listingId))
      return { list, words: plural(list.length, "picked listing") }
    }
    case "shop":
      return { list: all.filter((l) => l.account === target.account), words: `All of ${shopName(target.account)}` }
    case "all":
      return { list: all, words: "Every shop" }
    case "tag": {
      const tags = await readTags()
      const tag = tags.tags.find((t) => t.id === target.tagId)
      if (!tag) throw new NotFoundError("Unknown tag")
      return { list: all.filter((l) => tags.assigned[l.listingId]?.includes(tag.id)), words: `Tag “${tag.name}”` }
    }
    case "section": {
      const section = (await storedSections(target.account)).find((s) => s.id === target.sectionId)
      return {
        list: all.filter((l) => l.account === target.account && l.sectionId === target.sectionId),
        words: `Section “${section?.title ?? target.sectionId}” of ${shopName(target.account)}`,
      }
    }
  }
}

/** Shops among `accounts` that can't take changes yet, in words. */
async function blockedShops(accounts: Iterable<string>) {
  const shops = await shopAccounts()
  const out: string[] = []
  for (const account of new Set(accounts)) {
    const shop = shops.find((a) => a.id === account)
    const why = shop ? await syncBlocker(shop) : "No Etsy shop linked"
    if (why) out.push(`${shop?.shop?.name ?? account}: ${why}`)
  }
  return out
}

// --- Plans ---

type Planned = { listing: SyncedListing; row: PreviewRow; plan?: ActionItem["plan"]; requests: number }

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Each listing's change (or why there's none), what to set, and the requests it takes. */
async function plan(params: ActionParams, list: SyncedListing[]) {
  const profile = params.kind === "profile" ? await getProfile(params.profileId) : undefined
  const scene = params.kind === "swapPhoto" ? (await listScenes()).find((s) => s.id === params.sceneId) : undefined
  if (params.kind === "swapPhoto" && !scene) throw new NotFoundError("Unknown scene")

  const sections = new Map<string, SyncedSection[]>()
  if (params.kind === "section") {
    for (const account of new Set(list.map((l) => l.account))) sections.set(account, await storedSections(account))
  }

  const planned: Planned[] = []
  for (const listing of list) {
    const row: PreviewRow = {
      listingId: listing.listingId,
      account: listing.account,
      title: listing.title,
      thumb: listing.images[0]?.url ?? null,
    }
    const entry: Planned = { listing, row, requests: 1 }
    planned.push(entry)

    switch (params.kind) {
      case "price":
      case "profile": {
        const { prices, skip } = plannedPrices(listing, params, profile)
        row.prices = prices.map(({ label, before, after }) => ({ label, before, after }))
        row.currency = listing.currency
        if (skip) row.skip = skip
        entry.requests = 2
        entry.plan = {
          prices: Object.fromEntries(prices.map((p) => [p.productId, p.after])),
          before: Object.fromEntries(prices.map((p) => [p.productId, p.before])),
          ...(profile && { sizePrices: profile.prices }),
        }
        break
      }
      case "section": {
        const current = listing.sectionId
          ? sections.get(listing.account)?.find((s) => s.id === listing.sectionId)?.title
          : null
        if (current && sameTitle(current, params.title)) row.skip = `Already in ${current}`
        else row.change = `${current ?? "No section"} → ${params.title}`
        break
      }
      case "state": {
        const from = listing.state
        if (from === params.state) row.skip = `Already ${from}`
        else if (params.state === "active" && from === "draft") row.skip = "A draft: publishing costs a listing fee, do it on Etsy"
        else if (params.state === "active" && from !== "inactive") row.skip = `${from.replace("_", " ")}: renewing costs a listing fee, do it on Etsy`
        else if (params.state === "inactive" && from !== "active") row.skip = "Only active listings can be deactivated"
        else row.change = `${from} → ${params.state}`
        break
      }
      case "swapPhoto": {
        const made = await itemForListing(listing.listingId)
        if (!made) row.skip = "Not made by our pipeline: no poster to show in another scene"
        else if (params.rank > listing.images.length + 1) row.skip = `Has ${plural(listing.images.length, "photo")}`
        else row.change = `Photo ${params.rank} → ${scene!.name}`
        break
      }
      case "reorderPhotos": {
        const ids = listing.images.map((i) => i.id)
        const next = reordered(ids, params.order)
        entry.requests = 2
        if (ids.length < 2) row.skip = "Has one photo or none"
        else if (Math.max(...params.order) > ids.length) row.skip = `Has only ${plural(ids.length, "photo")}`
        else if (next.every((id, i) => id === ids[i])) row.skip = "Already in this order"
        else {
          row.change = `Photos ${params.order.join(", ")} first`
          entry.plan = { imageIds: next }
        }
        break
      }
    }
  }

  // A section missing in a shop: Etsy's list is read and the section made, once per shop.
  let extra = 0
  for (const [account, list] of sections) {
    const wanted = params.kind === "section" && !list.some((s) => sameTitle(s.title, params.title))
    if (wanted && planned.some((p) => p.listing.account === account && !p.row.skip)) extra += 2
  }
  return { label: labelOf(params, profile?.name, scene?.name), planned, extra }
}

function labelOf(params: ActionParams, profileName?: string, sceneName?: string) {
  switch (params.kind) {
    case "price":
      return priceLabel(params)
    case "profile":
      return `Price profile ${profileName ?? params.profileId}`
    case "section":
      return `Move to section “${params.title}”`
    case "state":
      return params.state === "active" ? "Activate" : "Deactivate"
    case "swapPhoto":
      return `Photo ${params.rank} → ${sceneName ?? params.sceneId}`
    case "reorderPhotos":
      return `Photos ${params.order.join(", ")} first`
  }
}

// --- What the page calls ---

export async function previewAction(params: ActionParams, target: ActionTarget): Promise<ActionPreview> {
  const { list, words } = await resolve(target)
  const { label, planned, extra } = await plan(params, list)
  const changes = planned.filter((p) => !p.row.skip)
  const skipped = planned.filter((p) => p.row.skip)
  return {
    label: `${label} · ${words}`,
    rows: [...changes, ...skipped].slice(0, PREVIEW_ROWS).map((p) => p.row),
    changes: changes.length,
    skipped: skipped.length,
    requests: changes.reduce((sum, p) => sum + p.requests, 0) + extra,
    blocked: await blockedShops(changes.map((p) => p.listing.account)),
  }
}

/** Queues the action: listings that won't change are kept as skipped, with why. */
export async function createAction(params: ActionParams, target: ActionTarget) {
  const { list, words } = await resolve(target)
  if (!list.length) throw new InputError("No listings to change")
  const { label, planned } = await plan(params, list)
  const changes = planned.filter((p) => !p.row.skip)
  if (!changes.length) throw new InputError("Nothing would change")
  const blocked = await blockedShops(changes.map((p) => p.listing.account))
  if (blocked.length) throw new InputError(`${blocked.join("; ")}. Connect it in Settings first.`, 409)

  const now = Date.now()
  const action: BulkAction = {
    id: newId("a-"),
    params,
    label,
    target: words,
    status: "queued",
    items: planned.map(({ listing, row, plan }): ActionItem => ({
      listingId: listing.listingId,
      account: listing.account,
      title: listing.title,
      status: row.skip ? "skipped" : "queued",
      ...(row.skip ? { result: row.skip } : plan && { plan }),
    })),
    createdAt: now,
    updatedAt: now,
  }
  await changeActions((list) => void list.push(action))
  void kick().catch((error) => console.error("Artikel actions:", error))
  return actionViews()
}

export async function changeAction(id: string, change: { status?: "paused" | "running" | "cancelled"; retry?: boolean }) {
  await changeActions((list) => {
    const action = list.find((a) => a.id === id)
    if (!action) throw new NotFoundError("Unknown action")
    const open = action.status === "queued" || action.status === "running" || action.status === "paused"
    if (change.retry && action.status !== "cancelled") {
      for (const item of action.items) {
        if (item.status !== "failed") continue
        item.status = "queued"
        delete item.error
        delete item.at
      }
      if (action.status === "done") action.status = "queued"
      delete action.finishedAt
    }
    if (change.status === "paused" && open) action.status = "paused"
    if (change.status === "running" && action.status === "paused") action.status = "queued"
    if (change.status === "cancelled" && open) {
      action.status = "cancelled"
      for (const item of action.items) {
        if (item.status !== "queued") continue
        item.status = "skipped"
        item.result = "Cancelled"
      }
    }
    action.updatedAt = Date.now()
    settle(action)
  })
  void kick().catch((error) => console.error("Artikel actions:", error))
  return actionViews()
}

export async function deleteAction(id: string) {
  await changeActions((list) => {
    const index = list.findIndex((a) => a.id === id)
    if (index === -1) throw new NotFoundError("Unknown action")
    if (list[index].status === "queued" || list[index].status === "running") throw new InputError("Pause or cancel it first", 409)
    list.splice(index, 1)
  })
  return actionViews()
}

// --- Views ---

const bare = ({ plan, ...item }: ActionItem) => (void plan, item)

function view({ items, ...action }: BulkAction): ActionView {
  const counts: Record<ItemStatus, number> = { queued: 0, running: 0, done: 0, failed: 0, skipped: 0 }
  const skips = new Map<string, number>()
  for (const item of items) {
    counts[item.status]++
    if (item.status === "skipped") skips.set(item.result ?? "Skipped", (skips.get(item.result ?? "Skipped") ?? 0) + 1)
  }
  return {
    ...action,
    counts,
    total: items.length,
    recent: items
      .filter((i) => i.at && (i.status === "done" || i.status === "failed" || i.status === "running"))
      .toSorted((a, b) => b.at! - a.at!)
      .slice(0, 30)
      .map(bare),
    failed: items.filter((i) => i.status === "failed").slice(0, 100).map(bare),
    skips: [...skips].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  }
}

/** Newest first. */
export async function actionViews(): Promise<ActionView[]> {
  return (await loadActions()).toReversed().map(view)
}
