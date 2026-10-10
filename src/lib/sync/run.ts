import { getAccount } from "@/lib/accounts/store"
import { exclusive } from "@/lib/db/sql"
import { instanceId, isLeader, whenLeader } from "@/lib/db/workers"
import type { Account } from "@/lib/accounts/types"
import { sizeOfLabel } from "@/lib/catalog/sizes"
import { RESERVE } from "@/lib/etsy/client"
import { ownListings, shopSections, type ApiOwnListing, type ListingState } from "@/lib/etsy/shop"
import { usageOf } from "@/lib/etsy/usage"
import { keyForStore, searchOrders, type OrderSummary } from "@/lib/gelato/client"

import { cents, ledgerPage, paymentsByIds, receiptsPage, SYNC_PAGE, type ApiLedgerEntry, type ApiReceipt } from "./etsy"
import { ledgerCategory } from "./ledger"
import {
  dayKey,
  liveState,
  ledger as storedLedger,
  listings as storedListings,
  sales as storedSales,
  saveListings,
  saveSections,
  saveSnapshot,
  saveStatus,
  shopAccounts,
  snapshotDays,
  storedStatus,
  syncBlocker,
  upsert,
  type StoredStatus,
} from "./store"
import { SYNC_PARTS, type LedgerEntry, type ProductionCost, type Sale, type SyncedListing, type SyncPart } from "./types"

// The sync of our shops' numbers: every listing with its counters (and a
// snapshot of them per day), orders, the payment ledger and Gelato's
// production costs. Orders, ledger and costs go on from where the last run
// stopped; listings are read whole each time, because their counters change
// without the listing changing. Runs early every morning, on start when the
// last run is older than 20 hours, and on demand. Each account spends its own
// key's quota and stops RESERVE requests short of empty. The schedule runs on
// the server doing the background work (see db/workers.ts); one account's
// sync runs on one server at a time, whichever asked.

export type { SyncPart }

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const STALE = 20 * HOUR
/** Local time of the daily run: early, before anyone looks. */
const DAILY_AT = { hour: 5, minute: 30 }
const LEDGER_WINDOW = 30 * DAY
/** How far back the first ledger and order reads go at most. */
const HISTORY = 2 * 365 * DAY
const STATES: ListingState[] = ["active", "inactive", "draft", "expired", "sold_out"]

const live = liveState()

type Schedule = { timer?: ReturnType<typeof setTimeout>; jobs: Map<string, Promise<void>> }
const schedule: Schedule = ((globalThis as typeof globalThis & { __syncSchedule?: Schedule }).__syncSchedule ??= {
  jobs: new Map(),
})

class QuotaLow extends Error {}

/** Throws QuotaLow when `calls` more requests would cut into the account's reserve. */
async function spend(account: string, calls = 1) {
  const usage = await usageOf(account)
  if (usage?.blockedUntil) {
    throw new QuotaLow(`Etsy quota used up until ${new Date(usage.blockedUntil).toLocaleTimeString("en-GB")}`)
  }
  if (usage && usage.remainingToday - calls < RESERVE) {
    throw new QuotaLow(`Stopped with ${usage.remainingToday} Etsy requests left today (${RESERVE} stay spare)`)
  }
}

const step = (account: string, text: string) => live.step.set(account, text)

// --- Listings ---

function toSynced(account: string, l: ApiOwnListing, before: SyncedListing | undefined): SyncedListing {
  const products = l.inventory?.products.filter((p) => !p.is_deleted)
  const variants = products
    ? products.map((p) => {
        const label = p.property_values.map((v) => v.values.join(" ")).join(" · ")
        const offering = p.offerings.find((o) => !o.is_deleted) ?? p.offerings[0]
        return {
          productId: p.product_id,
          sizeKey: sizeOfLabel(label)?.key ?? null,
          label,
          priceCents: offering ? cents(offering.price) : cents(l.price),
        }
      })
    : (before?.variants ?? [])
  const prices = variants.map((v) => v.priceCents)
  return {
    listingId: l.listing_id,
    account,
    shopId: l.shop_id,
    title: l.title,
    state: l.state,
    url: l.url,
    priceCents: prices.length ? Math.min(...prices) : cents(l.price),
    currency: l.price.currency_code,
    views: l.views ?? 0,
    favorites: l.num_favorers ?? 0,
    tags: l.tags ?? [],
    sectionId: l.shop_section_id || null,
    images: (l.images ?? [])
      .toSorted((a, b) => a.rank - b.rank)
      .map((i) => ({ id: i.listing_image_id ?? 0, url: i.url_570xN, fullUrl: i.url_fullxfull })),
    hasVideo: (l.videos?.length ?? 0) > 0,
    variants,
    createdAt: (l.original_creation_timestamp || l.creation_timestamp) * 1000,
    updatedAt: l.last_modified_timestamp * 1000,
    endsAt: l.ending_timestamp ? l.ending_timestamp * 1000 : null,
  }
}

async function syncListings(account: Account) {
  const before = new Map((await storedListings(account.id)).map((l) => [l.listingId, l]))
  const all: SyncedListing[] = []
  for (const state of STATES) {
    for (let offset = 0; ; ) {
      await spend(account.id)
      const page = await ownListings(account.id, { state, offset })
      all.push(...page.results.map((l) => toSynced(account.id, l, before.get(l.listing_id))))
      offset += page.results.length
      step(account.id, `Listings: ${all.length}${state === "active" ? ` of ${page.count} active` : ""}`)
      if (page.results.length < SYNC_PAGE || offset >= page.count) break
    }
  }
  await spend(account.id)
  const sections = await shopSections(account.id)
  await saveSections(
    account.id,
    sections.map((s) => ({ id: s.shop_section_id, title: s.title, count: s.active_listing_count }))
  )
  await saveListings(account.id, all)

  // The day's first reading stays its snapshot: what the day starts with.
  const now = Date.now()
  if ((await snapshotDays(account.id)).includes(dayKey(now))) return
  await saveSnapshot(account.id, {
    date: dayKey(now),
    at: now,
    listings: Object.fromEntries(
      all.map((l) => [l.listingId, { views: l.views, favorites: l.favorites, state: l.state, priceCents: l.priceCents }])
    ),
  })
}

// --- Orders ---

/** A receipt's transactions as sales; discounts and refunds shared out by item value. */
function toSales(account: string, r: ApiReceipt): Sale[] {
  const items = r.transactions.map((t) => cents(t.price) * t.quantity)
  const total = items.reduce((s, x) => s + x, 0)
  const discount = cents(r.discount_amt)
  const refunded = (r.refunds ?? []).reduce((s, x) => s + cents(x.amount), 0)
  return r.transactions.map((t, i) => {
    const share = total ? items[i] / total : 1 / r.transactions.length
    const label = [...(t.variations ?? []).map((v) => v.formatted_value), ...(t.product_data ?? []).flatMap((p) => p.values)]
      .filter(Boolean)
      .join(" · ")
    return {
      account,
      receiptId: r.receipt_id,
      transactionId: t.transaction_id,
      listingId: t.listing_id ?? 0,
      productId: t.product_id ?? null,
      sizeKey: sizeOfLabel(label)?.key ?? null,
      title: t.title ?? "",
      quantity: t.quantity,
      amountCents: items[i],
      shippingCents: cents(t.shipping_cost),
      discountCents: Math.round(discount * share),
      currency: t.price.currency_code,
      country: r.country_iso ?? null,
      createdAt: r.created_timestamp * 1000,
      status: r.status.toLowerCase(),
      ...(refunded > 0 && { refundCents: Math.round(refunded * share) }),
    }
  })
}

async function syncSales(account: Account, status: StoredStatus) {
  // An hour of overlap: receipts changed while the last run paged through.
  const since = status.cursors.receipts ? status.cursors.receipts - HOUR : undefined
  let newest = status.cursors.receipts ?? 0
  let seen = 0
  for (let offset = 0; ; ) {
    await spend(account.id)
    const page = await receiptsPage(account.id, offset, since)
    await upsert(account.id, "sales", page.results.flatMap((r) => toSales(account.id, r)), (s) => s.transactionId)
    for (const r of page.results) newest = Math.max(newest, r.updated_timestamp * 1000)
    offset += page.results.length
    seen += page.results.length
    step(account.id, `Orders: ${seen} of ${page.count}`)
    if (page.results.length < SYNC_PAGE || offset >= page.count) break
  }
  await saveStatus(account.id, (s) => ({ ...s, cursors: { ...s.cursors, receipts: newest || Date.now() } }))
}

// --- Payment ledger ---

function toEntry(account: string, e: ApiLedgerEntry): LedgerEntry {
  return {
    account,
    entryId: e.entry_id,
    amountCents: e.amount,
    currency: e.currency,
    description: e.description ?? "",
    ledgerType: e.ledger_type ?? "",
    referenceType: e.reference_type ?? null,
    referenceId: e.reference_id != null ? String(e.reference_id) : null,
    category: ledgerCategory(e.ledger_type ?? "", e.description ?? "", e.amount),
    createdAt: (e.created_timestamp ?? e.create_date ?? 0) * 1000,
  }
}

async function syncLedger(account: Account, status: StoredStatus) {
  const now = Date.now()
  const opened = account.shop?.createdAt ? Date.parse(account.shop.createdAt) : now - HISTORY
  // A day of overlap: entries booked late keep their creation time.
  let from = status.cursors.ledger ? status.cursors.ledger - DAY : Math.max(opened - DAY, now - HISTORY)
  // Entries read again keep the order their payment was found to belong to.
  const known = new Map((await storedLedger(undefined, undefined, account.id)).map((e) => [e.entryId, e.receiptId]))
  const entry = (e: ApiLedgerEntry) => {
    const receiptId = known.get(e.entry_id)
    return receiptId ? { ...toEntry(account.id, e), receiptId } : toEntry(account.id, e)
  }
  let entries = 0
  while (from < now) {
    const to = Math.min(from + LEDGER_WINDOW, now)
    for (let offset = 0; ; ) {
      await spend(account.id)
      const page = await ledgerPage(account.id, from, to, offset)
      await upsert(account.id, "ledger", page.results.map(entry), (e) => e.entryId)
      offset += page.results.length
      entries += page.results.length
      step(account.id, `Fees: ${entries} entries, up to ${dayKey(to)}`)
      if (page.results.length < SYNC_PAGE || offset >= page.count) break
    }
    await saveStatus(account.id, (s) => ({ ...s, cursors: { ...s.cursors, ledger: to } }))
    from = to
  }
  await resolvePayments(account)
}

/**
 * Processing fees point at the buyer's payment, not the order: Etsy's
 * payments say which order each is for. Looked up once per payment, a
 * hundred at a time. Without it the fee still counts in the shop's totals;
 * per listing it's worked out at Etsy's rates instead.
 */
async function resolvePayments(account: Account) {
  const open = (await storedLedger(undefined, undefined, account.id)).filter(
    (e) => e.referenceType?.toLowerCase() === "payment" && e.referenceId && !e.receiptId
  )
  const ids = [...new Set(open.map((e) => e.referenceId!))]
  const receipts = new Map<string, string>()
  try {
    for (let i = 0; i < ids.length; i += 100) {
      await spend(account.id)
      const page = await paymentsByIds(account.id, ids.slice(i, i + 100))
      for (const p of page.results) receipts.set(String(p.payment_id), String(p.receipt_id))
      step(account.id, `Payments: ${Math.min(i + 100, ids.length)} of ${ids.length}`)
    }
  } catch (error) {
    if (error instanceof QuotaLow) throw error
    console.error(`Sync ${account.id} payments:`, error)
  }
  const resolved = open.filter((e) => receipts.has(e.referenceId!))
  if (resolved.length) {
    await upsert(account.id, "ledger", resolved.map((e) => ({ ...e, receiptId: receipts.get(e.referenceId!) })), (e) => e.entryId)
  }
}

// --- Gelato production costs ---

/** Gelato's states for orders that cost nothing in the end. */
const UNCHARGED = ["canceled", "cancelled", "refunded"]

function toCost(account: string, storeId: string, o: OrderSummary): ProductionCost {
  const total = Math.round(Number.parseFloat(o.totalInclVat || "0") * 100)
  return {
    account,
    storeId,
    orderId: o.id,
    receiptId: o.orderReferenceId,
    totalCents: UNCHARGED.includes(o.financialStatus) ? 0 : total,
    currency: o.currency,
    status: UNCHARGED.includes(o.financialStatus) ? o.financialStatus : o.fulfillmentStatus,
    createdAt: Date.parse(o.orderedAt ?? o.createdAt) || Date.parse(o.createdAt),
  }
}

async function syncCosts(account: Account, status: StoredStatus) {
  const storeId = account.gelato?.storeId
  if (!storeId) return
  const key = await keyForStore(storeId)
  const started = Date.now()
  // Two weeks back each time: orders get cancelled or refunded after the fact.
  const from = new Date(status.cursors.costs ? status.cursors.costs - 14 * DAY : started - HISTORY).toISOString()
  // Gelato answers with every order of the key whatever storeIds says, and one key may print for
  // several shops: ours are the store's, and those placed by hand (no store) for one of our receipts.
  const receipts = new Set((await storedSales(undefined, undefined, account.id)).map((s) => String(s.receiptId)))
  const ours = (o: OrderSummary) => o.storeId === storeId || (!o.storeId && receipts.has(o.orderReferenceId))
  let seen = 0
  for (let offset = 0; ; offset += 100) {
    const orders = await searchOrders(key, { storeIds: [storeId], offset, limit: 100, from })
    await upsert(account.id, "costs", orders.filter(ours).map((o) => toCost(account.id, storeId, o)), (c) => c.orderId)
    seen += orders.length
    step(account.id, `Gelato orders: ${seen}`)
    if (orders.length < 100) break
  }
  await saveStatus(account.id, (s) => ({ ...s, cursors: { ...s.cursors, costs: started } }))
}

// --- Runs ---

async function run(accountId: string, parts: SyncPart[]) {
  const account = await getAccount(accountId)
  // syncStatus says why on its own; nothing to note.
  if (await syncBlocker(account)) return
  const errors: string[] = []
  let quota: string | null = null
  for (const part of SYNC_PARTS) {
    if (!parts.includes(part)) continue
    // Quota spent: the Etsy parts wait for the next run, Gelato's costs don't need Etsy.
    if (quota && part !== "costs") continue
    try {
      const status = await storedStatus(accountId)
      if (part === "listings") await syncListings(account)
      else if (part === "sales") await syncSales(account, status)
      else if (part === "ledger") await syncLedger(account, status)
      else await syncCosts(account, status)
      await saveStatus(accountId, (s) => ({ ...s, [part]: Date.now() }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof QuotaLow) quota = message
      else errors.push(`${part}: ${message}`)
      console.error(`Sync ${accountId} ${part}:`, error)
    }
  }
  const error = quota ?? errors[0]
  await saveStatus(accountId, (s) => {
    const next = { ...s }
    if (error) next.error = errors.length > 1 ? `${error} (+${errors.length - 1} more)` : error
    else delete next.error
    return next
  })
}

/** Holds the account's sync lock while it runs: one running on another server isn't doubled. */
async function runHere(account: string, parts: SyncPart[]) {
  await exclusive(`sync:${account}`, async () => {
    await saveStatus(account, (s) => ({ ...s, runner: instanceId }))
    try {
      await run(account, parts)
    } finally {
      await saveStatus(account, (s) => {
        const next = { ...s }
        delete next.runner
        return next
      })
    }
  })
}

/** Syncs one account; a sync already running for it is joined (here) or left alone (elsewhere), not doubled. */
export function syncAccount(account: string, parts: SyncPart[] = [...SYNC_PARTS]): Promise<void> {
  const running = schedule.jobs.get(account)
  if (running) return running
  live.running.add(account)
  const job = runHere(account, parts)
    .catch((error) => console.error(`Sync ${account}:`, error))
    .finally(() => {
      schedule.jobs.delete(account)
      live.running.delete(account)
      live.step.delete(account)
    })
  schedule.jobs.set(account, job)
  return job
}

/** Every account that can sync, side by side: each spends its own quota. */
export async function syncAll() {
  const accounts = await shopAccounts()
  const ready = []
  for (const a of accounts) if (!(await syncBlocker(a))) ready.push(a)
  await Promise.all(ready.map((a) => syncAccount(a.id)))
}

/** Accounts whose last listing read is older than 20 hours (or that never synced). */
async function syncStale() {
  for (const a of await shopAccounts()) {
    if (await syncBlocker(a)) continue
    const last = (await storedStatus(a.id)).listings
    if (!last || Date.now() - last > STALE) void syncAccount(a.id)
  }
}

function nextMorning(now = new Date()) {
  const next = new Date(now)
  next.setHours(DAILY_AT.hour, DAILY_AT.minute, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime()
}

function planNext() {
  clearTimeout(schedule.timer)
  const at = nextMorning()
  live.nextAt = at
  schedule.timer = setTimeout(() => {
    isLeader()
      .then((leads) => (leads ? syncAll() : undefined))
      .catch((error) => console.error("Daily sync:", error))
      .finally(planNext)
  }, at - Date.now())
}

/**
 * Starts the daily schedule (once per server, a hot reload replaces the timer
 * rather than adding one; it only syncs on the server doing the background
 * work), syncs stale accounts shortly after, and has Artikel's bulk actions
 * picked up where they stopped whenever this server starts leading.
 */
export function startSync() {
  if (process.env.NEXT_PHASE === "phase-production-build") return
  planNext()
  // A little after start, so the first page loads aren't queued behind it.
  setTimeout(() => {
    isLeader()
      .then((leads) => (leads ? syncStale() : undefined))
      .catch((error) => console.error("Sync on start:", error))
  }, 20_000)
  whenLeader(() => {
    import("@/lib/artikel/queue")
      .then(({ resumeActions }) => resumeActions())
      .catch((error) => console.error("Artikel actions on start:", error))
  })
}
