import { sizeOfLabel } from "@/lib/catalog/sizes"
import { readDoc, updateDoc, watchDoc } from "@/lib/db/documents"
import { isLeader } from "@/lib/db/workers"
import { EtsyApiError, RESERVE } from "@/lib/etsy/client"
import {
  createSection,
  getInventory,
  inventoryUpdate,
  listingImages,
  shopSections,
  updateInventory,
  updateListing,
  uploadImage,
} from "@/lib/etsy/shop"
import { usageOf } from "@/lib/etsy/usage"
import { getSet, readSetFile } from "@/lib/generation/storage"
import { renderPhotos } from "@/lib/pipeline/render"
import { itemForListing } from "@/lib/pipeline/store"
import {
  listings as storedListings,
  patchListing,
  saveSections,
  sections as storedSections,
} from "@/lib/sync/store"
import type { SyncedListing } from "@/lib/sync/types"

import type { ActionItem, BulkAction } from "./types"

// Artikel's bulk actions at work: one listing after another, one lane per
// account (each spends its own key's quota and stops RESERVE requests short
// of empty, then waits and goes on by itself). The lanes run on the server
// doing the background work (see db/workers.ts), which hears of every new
// action or change, whichever server made it. Everything is in the
// "artikel/actions" document, changed one edit at a time across servers, so
// a restart (or another server taking over) picks up where it stopped; each
// item's plan holds the values to set, not the change, so running an item
// twice never changes a price twice.

const FILE = "artikel/actions"
const MINUTE = 60 * 1000
/** How long finished actions stay listed. */
const KEEP = 30 * 24 * 60 * MINUTE
/** How long an account short of quota waits before looking again. */
const QUOTA_WAIT = 10 * MINUTE

type Queue = {
  /** One lane per account at work. */
  lanes: Map<string, Promise<void>>
  /** Accounts waiting for quota: until when (epoch ms) and why. */
  waits: Map<string, { until: number; why: string }>
  wakeTimer?: ReturnType<typeof setTimeout>
}

// On globalThis: route handlers and the instrumentation load separate copies
// of this module, and a hot reload makes new ones; all share one queue.
const queue: Queue = ((globalThis as typeof globalThis & { __artikelQueue?: Queue }).__artikelQueue ??= {
  lanes: new Map(),
  waits: new Map(),
})

// --- Stored ---

function prune(list: BulkAction[]) {
  const cutoff = Date.now() - KEEP
  for (let i = list.length - 1; i >= 0; i--) {
    const finished = list[i].finishedAt
    if (finished && finished < cutoff) list.splice(i, 1)
  }
}

/** Every action, oldest first. Shared: never change what this answers (see `changeActions`). */
export function loadActions(): Promise<BulkAction[]> {
  return readDoc<BulkAction[]>(FILE, [])
}

/** Changes the actions in one step, after every other change on any server; answers what `edit` returns. */
export async function changeActions<T>(edit: (list: BulkAction[]) => T): Promise<T> {
  let result!: T
  await updateDoc<BulkAction[]>(FILE, [], (list) => {
    result = edit(list)
    prune(list)
    return list
  })
  return result
}

/** Keeps what an item's run worked out (a section's id, the photo order), so running it again needn't. */
async function remember(action: BulkAction, item: ActionItem) {
  const index = action.items.indexOf(item)
  await changeActions((list) => {
    const stored = list.find((a) => a.id === action.id)
    if (!stored) return
    stored.sectionIds = action.sectionIds
    if (stored.items[index]) stored.items[index].plan = item.plan
  })
}

// --- Quota ---

class QuotaWait extends Error {
  constructor(
    readonly until: number,
    message: string
  ) {
    super(message)
  }
}

const time = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

/** Throws QuotaWait when `calls` more requests would cut into the account's reserve. */
async function spend(account: string, calls: number) {
  const usage = await usageOf(account)
  if (usage?.blockedUntil) {
    const until = Date.parse(usage.blockedUntil)
    throw new QuotaWait(until, `Etsy quota used up until ${time(until)}`)
  }
  if (usage && usage.remainingToday - calls < RESERVE) {
    throw new QuotaWait(
      Date.now() + QUOTA_WAIT,
      `${usage.remainingToday} Etsy requests left (${RESERVE} stay spare); goes on as the quota frees up`
    )
  }
}

// --- What each kind does to one listing ---

/** The Etsy calls the queue makes: tests hand in fakes that only write down what would go out. */
export type EtsyCalls = {
  getInventory: typeof getInventory
  updateInventory: typeof updateInventory
  updateListing: typeof updateListing
  shopSections: typeof shopSections
  createSection: typeof createSection
  listingImages: typeof listingImages
  uploadImage: typeof uploadImage
}

const ETSY: EtsyCalls = {
  getInventory,
  updateInventory,
  updateListing,
  shopSections,
  createSection,
  listingImages,
  uploadImage,
}

const money = (cents: number) => `€${(cents / 100).toFixed(2)}`
const span = (prices: number[]) => {
  const low = Math.min(...prices)
  const high = Math.max(...prices)
  return low === high ? money(low) : `${money(low)}–${money(high)}`
}

async function synced(account: string, listingId: number): Promise<SyncedListing | undefined> {
  return (await storedListings(account)).find((l) => l.listingId === listingId)
}

async function setPrices(item: ActionItem, etsy: EtsyCalls) {
  const plan = item.plan ?? {}
  await spend(item.account, 2)
  const inventory = await etsy.getInventory(item.account, item.listingId)
  const products = inventory.products.filter((p) => !p.is_deleted)
  const labelOf = (p: (typeof products)[number]) => p.property_values.map((v) => v.values.join(" ")).join(" · ")
  const targetOf = (p: (typeof products)[number]) => {
    const size = sizeOfLabel(labelOf(p))?.key
    return plan.prices?.[p.product_id] ?? (size ? plan.sizePrices?.[size] : undefined)
  }
  const cents = (p: (typeof products)[number]) => {
    const o = p.offerings.find((x) => !x.is_deleted) ?? p.offerings[0]
    return o ? Math.round((o.price.amount / o.price.divisor) * 100) : 0
  }
  const before = products.map(cents)
  const after = products.map((p, i) => targetOf(p) ?? before[i])
  const untouched = products.filter((p) => targetOf(p) === undefined).length
  // Not one product the plan knows (sizes made anew on Etsy): a retry would find none either.
  if (untouched === products.length) throw new Error("Its sizes changed on Etsy since the sync: sync, then make the change again")
  if (after.every((price, i) => price === before[i])) return "Already at these prices"

  const updated = await etsy.updateInventory(
    item.account,
    item.listingId,
    inventoryUpdate(inventory, (p, current) => {
      const target = targetOf(p)
      return target === undefined ? current : target / 100
    })
  )
  // Etsy may answer with new product ids for the sizes. Gelato's print
  // variants point at the old ones until it links them again, so say so,
  // and keep the local copy on the new ids for the next change.
  const newIds = new Map((updated?.products ?? []).filter((p) => !p.is_deleted).map((p) => [labelOf(p), p.product_id]))
  const idOf = new Map(products.map((p) => [p.product_id, newIds.get(labelOf(p)) ?? p.product_id]))
  const renumbered = [...idOf].some(([before, after]) => before !== after)
  const byProduct = new Map(products.map((p, i) => [p.product_id, after[i]]))
  await patchListing(item.account, item.listingId, (l) => {
    const variants = l.variants.map((v) => ({
      ...v,
      productId: idOf.get(v.productId) ?? v.productId,
      priceCents: byProduct.get(v.productId) ?? v.priceCents,
    }))
    return { ...l, variants, priceCents: Math.min(...variants.map((v) => v.priceCents)) }
  })
  const drifted = products.some((p, i) => plan.before?.[p.product_id] !== undefined && plan.before[p.product_id] !== before[i])
  return [
    `${span(before)} → ${span(after)}`,
    untouched && `${untouched} size${untouched === 1 ? "" : "s"} added since the sync left as they were`,
    drifted && "prices had changed on Etsy since the sync",
    renumbered && "Etsy gave the sizes new ids: check in Gelato (Sync products) that the listing is still connected",
  ]
    .filter(Boolean)
    .join("; ")
}

async function setSection(action: BulkAction, item: ActionItem, etsy: EtsyCalls) {
  if (action.params.kind !== "section") throw new Error("Not a section action")
  const title = action.params.title
  const same = (t: string) => t.trim().toLowerCase() === title.trim().toLowerCase()
  let sectionId = action.sectionIds?.[item.account]
  if (!sectionId) {
    sectionId = (await storedSections(item.account)).find((s) => same(s.title))?.id
    if (!sectionId) {
      // Etsy's own list first: made since the sync, or by a run whose answer got lost.
      await spend(item.account, 3)
      const live = await etsy.shopSections(item.account)
      const found = live.find((s) => same(s.title)) ?? (await etsy.createSection(item.account, title))
      sectionId = found.shop_section_id
      await saveSections(
        item.account,
        [...live.filter((s) => s.shop_section_id !== sectionId), found].map((s) => ({
          id: s.shop_section_id,
          title: s.title,
          count: s.active_listing_count ?? 0,
        }))
      )
    }
    action.sectionIds = { ...action.sectionIds, [item.account]: sectionId }
    await remember(action, item)
  }
  // The shop's own spelling, which may differ from the one asked for.
  const name = (await storedSections(item.account)).find((s) => s.id === sectionId)?.title ?? title
  if ((await synced(item.account, item.listingId))?.sectionId === sectionId) return `Already in ${name}`
  await spend(item.account, 1)
  await etsy.updateListing(item.account, item.listingId, { shop_section_id: sectionId })
  await patchListing(item.account, item.listingId, (l) => ({ ...l, sectionId: sectionId! }))
  return `Moved to ${name}`
}

async function setState(action: BulkAction, item: ActionItem, etsy: EtsyCalls) {
  if (action.params.kind !== "state") throw new Error("Not a state action")
  const state = action.params.state
  const listing = await synced(item.account, item.listingId)
  if (listing?.state === state) return `Already ${state}`
  await spend(item.account, 1)
  await etsy.updateListing(item.account, item.listingId, { state })
  await patchListing(item.account, item.listingId, (l) => ({ ...l, state }))
  return `${listing?.state ?? "?"} → ${state}`
}

async function swapPhoto(action: BulkAction, item: ActionItem, etsy: EtsyCalls) {
  if (action.params.kind !== "swapPhoto") throw new Error("Not a photo action")
  const { rank, sceneId } = action.params
  const made = await itemForListing(item.listingId)
  if (!made) throw new Error("Not made by our pipeline: no poster to show in another scene")
  const output = (await getSet(made.groupId)).outputs.find((o) => o.id === made.outputId)
  if (!output?.file) throw new Error("The poster's file is gone")
  const poster = await readSetFile(made.groupId, output.file)
  const [photo] = await renderPhotos(poster, [sceneId])
  if (!photo) throw new Error("The scene rendered nothing")

  await spend(item.account, 1)
  const listing = await synced(item.account, item.listingId)
  const image = await etsy.uploadImage(item.account, item.listingId, photo, {
    rank,
    overwrite: true,
    altText: listing?.title ?? item.title,
    name: `${sceneId}.jpg`,
  })
  await patchListing(item.account, item.listingId, (l) => {
    const images = [...l.images]
    const next = { id: image.listing_image_id ?? 0, url: image.url_570xN, fullUrl: image.url_fullxfull }
    if (rank <= images.length) images[rank - 1] = next
    else images.push(next)
    return { ...l, images }
  })
  return `Photo ${rank} replaced`
}

/** Image ids with the photos at `order` (current ranks, 1 first) up front, the rest after as they were. */
export function reordered(ids: number[], order: number[]) {
  const picked = [...new Set(order)].filter((r) => r >= 1 && r <= ids.length).map((r) => ids[r - 1])
  return [...picked, ...ids.filter((id) => !picked.includes(id))]
}

async function reorderPhotos(action: BulkAction, item: ActionItem, etsy: EtsyCalls) {
  if (action.params.kind !== "reorderPhotos") throw new Error("Not a photo action")
  await spend(item.account, 2)
  const live = (await etsy.listingImages(item.account, item.listingId)).results
    .toSorted((a, b) => a.rank - b.rank)
    .map((i) => i.listing_image_id ?? 0)
  let ids = item.plan?.imageIds
  // Photos changed since the sync: the order is worked out again from what's there now.
  if (!ids || ids.length !== live.length || ids.some((id) => !live.includes(id))) {
    ids = reordered(live, action.params.order)
    item.plan = { ...item.plan, imageIds: ids }
    await remember(action, item)
  }
  if (ids.every((id, i) => id === live[i])) return "Already in this order"
  await etsy.updateListing(item.account, item.listingId, { image_ids: ids })
  await patchListing(item.account, item.listingId, (l) => ({
    ...l,
    images: ids.map((id) => l.images.find((i) => i.id === id)).filter((i) => !!i),
  }))
  return "Photos reordered"
}

/** Does one item's work and says what happened; throws when it failed. */
export function executeItem(action: BulkAction, item: ActionItem, etsy: EtsyCalls = ETSY): Promise<string> {
  switch (action.params.kind) {
    case "price":
    case "profile":
      return setPrices(item, etsy)
    case "section":
      return setSection(action, item, etsy)
    case "state":
      return setState(action, item, etsy)
    case "swapPhoto":
      return swapPhoto(action, item, etsy)
    case "reorderPhotos":
      return reorderPhotos(action, item, etsy)
  }
}

// --- The lanes ---

const runnable = (a: BulkAction) => a.status === "queued" || a.status === "running"

function nextItem(list: BulkAction[], account: string) {
  for (const action of list) {
    if (!runnable(action)) continue
    const item = action.items.find((i) => i.account === account && i.status === "queued")
    if (item) return { action, item }
  }
  return null
}

/** Marks an action done once nothing of it is left to run. */
export function settle(action: BulkAction) {
  if (action.items.some((i) => i.status === "queued" || i.status === "running")) return
  if (action.status !== "cancelled") action.status = "done"
  delete action.note
  delete action.wakeAt
  action.finishedAt ??= Date.now()
}

/** Why the action waits, when every account it has left is waiting for quota. */
function waitOf(action: BulkAction) {
  const accounts = new Set(action.items.filter((i) => i.status === "queued").map((i) => i.account))
  const waits = [...accounts].map((a) => queue.waits.get(a))
  if (!accounts.size || !waits.every((w) => !!w)) return { note: undefined, wakeAt: undefined }
  return { note: waits[0]!.why, wakeAt: Math.min(...waits.map((w) => w!.until)) }
}

/** Puts the reason on actions whose every account left waits (writing only when one changed), and plans the wake-up. */
async function noteWaits() {
  const now = Date.now()
  for (const [account, wait] of queue.waits) if (wait.until <= now) queue.waits.delete(account)
  const stale = (action: BulkAction) => {
    if (!runnable(action)) return false
    const wait = waitOf(action)
    return action.note !== wait.note || action.wakeAt !== wait.wakeAt
  }
  if ((await loadActions()).some(stale)) {
    await changeActions((list) => {
      for (const action of list.filter(stale)) {
        const { note, wakeAt } = waitOf(action)
        if (note) Object.assign(action, { note, wakeAt })
        else {
          delete action.note
          delete action.wakeAt
        }
      }
    })
  }
  clearTimeout(queue.wakeTimer)
  if (queue.waits.size) {
    const earliest = Math.min(...[...queue.waits.values()].map((w) => w.until))
    queue.wakeTimer = setTimeout(() => void kick(), Math.max(1000, earliest - now))
  }
}

type Claimed = { action: BulkAction; index: number }

/**
 * Takes the account's next item, in the same step writing how the one
 * before went: one write per listing.
 */
function claim(account: string, before?: { claimed: Claimed; finish: (item: ActionItem) => void }) {
  return changeActions((list): Claimed | null => {
    if (before) {
      const stored = list.find((a) => a.id === before.claimed.action.id)
      const item = stored?.items[before.claimed.index]
      if (stored && item) {
        before.finish(item)
        item.at = Date.now()
        stored.updatedAt = item.at
        settle(stored)
      }
    }
    const next = nextItem(list, account)
    if (!next) return null
    next.action.status = "running"
    next.item.status = "running"
    next.item.at = Date.now()
    return { action: structuredClone(next.action), index: next.action.items.indexOf(next.item) }
  })
}

async function lane(account: string) {
  let before: Parameters<typeof claim>[1]
  // Another server took over the background work: what's left is its.
  for (let next = await claim(account); next; next = (await isLeader()) ? await claim(account, before) : null) {
    const claimed = next
    const { action, index } = claimed
    const item = action.items[index]
    try {
      const result = await executeItem(action, item)
      before = {
        claimed,
        finish: (stored) => {
          stored.status = "done"
          stored.result = result
          delete stored.error
        },
      }
    } catch (error) {
      const quota = error instanceof QuotaWait || (error instanceof EtsyApiError && error.status === 429)
      if (quota) {
        const until = error instanceof QuotaWait ? error.until : Date.now() + QUOTA_WAIT
        queue.waits.set(account, { until, why: (error as Error).message })
        await changeActions((list) => {
          const stored = list.find((a) => a.id === action.id)?.items[index]
          if (stored?.status !== "running") return
          stored.status = "queued"
          delete stored.at
        })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      console.error(`Artikel ${action.label}, listing ${item.listingId}:`, error)
      before = {
        claimed,
        finish: (stored) => {
          stored.status = "failed"
          stored.error = message
        },
      }
    }
  }
  // The last item's outcome, when leading stopped before it was written with a next claim.
  if (before) {
    const { claimed, finish } = before
    await changeActions((list) => {
      const stored = list.find((a) => a.id === claimed.action.id)
      const item = stored?.items[claimed.index]
      if (!stored || item?.status !== "running") return
      finish(item)
      item.at = Date.now()
      stored.updatedAt = item.at
      settle(stored)
    })
  }
}

/** Starts a lane for every account with work and no lane yet (and no quota wait); only on the server leading. */
export async function kick() {
  if (!(await isLeader())) return
  await noteWaits()
  const accounts = new Set<string>()
  for (const action of await loadActions()) {
    if (!runnable(action)) continue
    for (const i of action.items) if (i.status === "queued") accounts.add(i.account)
  }
  for (const account of accounts) {
    if (queue.lanes.has(account) || queue.waits.has(account)) continue
    const run = lane(account)
      .catch((error) => {
        // Something outside one item broke: the account rests a minute rather than spinning.
        console.error(`Artikel actions on ${account}:`, error)
        queue.waits.set(account, { until: Date.now() + MINUTE, why: (error as Error).message })
      })
      .finally(() => {
        queue.lanes.delete(account)
        // Work added while the lane was finishing.
        setTimeout(() => void kick().catch((error) => console.error("Artikel actions:", error)), 0)
      })
    queue.lanes.set(account, run)
  }
}

/**
 * When this server starts leading: items cut off mid-request (by a restart,
 * or a server that stopped) go again (their plans make that safe), then the
 * lanes start, and start again with every change from any server.
 */
export async function resumeActions() {
  const list = await loadActions()
  const cut = (item: ActionItem) => item.status === "running" && !queue.lanes.has(item.account)
  if (list.some((a) => a.items.some(cut))) {
    await changeActions((stored) => {
      for (const action of stored) {
        for (const item of action.items) if (cut(item)) item.status = "queued"
        settle(action)
      }
    })
  }
  watchDoc(FILE, () => void kick().catch((error) => console.error("Artikel actions:", error)))
  await kick()
}
