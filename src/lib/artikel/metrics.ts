import { cityColumns } from "@/lib/citys/artikel"
import { itemForListing } from "@/lib/pipeline/store"
import { MEASURED_CENTS } from "@/lib/pricing/costs"
import { ETSY_FEES } from "@/lib/pricing/profit"
import { listProfiles } from "@/lib/pricing/store"
import { DEFAULT_ASSUMPTIONS } from "@/lib/pricing/types"
import {
  costs as storedCosts,
  dayKey,
  dayStart,
  lastSynced,
  ledger as storedLedger,
  listings as storedListings,
  sales as storedSales,
  sections as storedSections,
  shopAccounts,
  snapshotDays,
  snapshots,
  syncStatus,
} from "@/lib/sync/store"
import {
  FEE_CATEGORIES,
  saleRevenue,
  VOID_SALE,
  type LedgerCategory,
  type Sale,
  type SyncedListing,
} from "@/lib/sync/types"

import { readTags } from "./tags"
import type { ArtikelDetail, ArtikelRow, ArtikelShop, ArtikelState, ArtikelSummary } from "./types"

// Artikel's numbers, worked out from the synced data for a date range.
//
// Views and favourites: Etsy only keeps running totals, so the sync keeps
// each day's first reading (normally the early-morning run) as the day's
// snapshot. A range counts from the snapshot its first day starts with to the
// one the day after it starts with, or to the last sync's totals when the
// range runs up to that sync's day.
//
// Money follows the sales: a sale in the range brings its revenue, the fees
// Etsy booked on it (whenever they were booked: the ledger entry points at
// its transaction, or at its order and is shared out by value) and what
// Gelato charged for its order. Fees not booked yet are worked out at Etsy's
// rates and the row says "est."; so are orders Gelato hasn't billed. Listing
// fees count when they're booked. Etsy Ads are one charge a day for the whole
// shop: they count in the totals, per listing only as a share by views, marked
// as an estimate. The totals take every fee booked in the range, plus the
// worked-out ones of sales the ledger hasn't caught up with yet.

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** VAT on Etsy's fees and Gelato's invoices, as Prices assumes it. */
const VAT = 1 + DEFAULT_ASSUMPTIONS.costVat
/** Gelato's shipping on a typical poster order in Germany, before VAT: for orders it hasn't billed yet. */
const GELATO_SHIPPING = 650
/** Fees on a sale are booked around it: ledger entries this far either side of the range are read to find them. */
const BOOKING_SLACK = 7 * DAY

// Day keys step by 36 and 12 hours, so a 23- or 25-hour day never skips or repeats one.
const dayAfter = (key: string) => dayKey(dayStart(key) + 36 * HOUR)
const dayBefore = (key: string) => dayKey(dayStart(key) - 12 * HOUR)

/** The day keys from `from` to `to`, both included. */
function daysBetween(from: string, to: string) {
  const out: string[] = []
  for (let d = from; d <= to; d = dayAfter(d)) out.push(d)
  return out
}

export type Range = { from: string; to: string; fromMs: number; toMs: number }

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** The range asked for (YYYY-MM-DD, inclusive), the last 30 days by default. */
export function parseRange(from?: string | null, to?: string | null): Range {
  const today = dayKey()
  let end = to && DATE.test(to) ? to : today
  if (end > today) end = today
  let start = from && DATE.test(from) ? from : dayKey(dayStart(end) - 29 * DAY + 12 * HOUR)
  if (start > end) start = end
  return { from: start, to: end, fromMs: dayStart(start), toMs: dayStart(dayAfter(end)) - 1 }
}

// --- Views ---

type Counters = { views: number; favorites: number }
const ZERO: Counters = { views: 0, favorites: 0 }

/**
 * Running totals at one moment: a day's snapshot (what the day starts with),
 * or the last sync's, keyed as the next day's start since it covers its own
 * day so far.
 */
type Point = { key: string; at: number; listings: Record<string, Counters> }

/** The last sync's totals of an account as a point; null before any sync. */
async function currentPoint(account: string, listings: SyncedListing[]): Promise<Point | null> {
  const at = await lastSynced(account, "listings")
  if (!at) return null
  const own = listings.filter((l) => l.account === account)
  return {
    key: dayAfter(dayKey(at)),
    at,
    listings: Object.fromEntries(own.map((l) => [l.listingId, { views: l.views, favorites: l.favorites }])),
  }
}

async function snapshotOn(account: string, day: string): Promise<Point | null> {
  const [s] = await snapshots(account, day, day)
  return s ? { key: s.date, at: s.at, listings: s.listings } : null
}

type RangePoints = {
  /** What the range's first day starts with; null when it's older than every snapshot. */
  base: Point | null
  /** Where the range ends: the next day's snapshot, or the last sync's totals. */
  end: Point | null
  /** Without a base: the first point inside the range, to count older listings from. */
  first: Point | null
}

async function rangePoints(account: string, range: Range, current: Point | null): Promise<RangePoints> {
  const next = dayAfter(range.to)
  const days = await snapshotDays(account)
  const baseDay = days.filter((d) => d <= range.from).at(-1)
  const endDay = days.filter((d) => d <= next).at(-1)
  const firstDay = days.find((d) => d > range.from && d <= next)
  const [base, endSnapshot, first] = await Promise.all([
    baseDay ? snapshotOn(account, baseDay) : null,
    endDay ? snapshotOn(account, endDay) : null,
    !baseDay && firstDay ? snapshotOn(account, firstDay) : null,
  ])
  const end = current && current.key <= next ? current : endSnapshot
  return { base, end, first: baseDay ? null : (first ?? end) }
}

function rangeCounters(listing: SyncedListing, points: RangePoints, range: Range): Counters {
  const id = String(listing.listingId)
  const end = points.end?.listings[id]
  if (!end) return ZERO
  // Not in the starting snapshot: made since, it started at zero; older than
  // the first snapshot, it counts from the first one that has it.
  const base =
    points.base?.listings[id] ??
    (listing.createdAt >= (points.base?.at ?? range.fromMs) ? ZERO : (points.first?.listings[id] ?? end))
  return { views: Math.max(0, end.views - base.views), favorites: Math.max(0, end.favorites - base.favorites) }
}

/** One listing's views and favourites per day of the range; a gap between snapshots is spread evenly over its days. */
async function dailyCounters(listing: SyncedListing, range: Range, current: Point | null) {
  const out = new Map(daysBetween(range.from, range.to).map((d) => [d, { ...ZERO }]))
  const next = dayAfter(range.to)
  const days = await snapshotDays(listing.account)
  const start = days.filter((d) => d <= range.from).at(-1) ?? days[0]
  const points: Point[] = start
    ? (await snapshots(listing.account, start, next)).map((s) => ({ key: s.date, at: s.at, listings: s.listings }))
    : []
  if (current && current.key <= next) points.push(current)

  const id = String(listing.listingId)
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i], points[i + 1]]
    // Made in between: it started at zero, on the day it was made.
    const fresh = !a.listings[id] && listing.createdAt >= a.at
    const before = a.listings[id] ?? (fresh ? ZERO : null)
    const after = b.listings[id]
    const last = dayBefore(b.key)
    const made = dayKey(listing.createdAt)
    const span = daysBetween(fresh && made > a.key ? (made < last ? made : last) : a.key, last)
    if (!before || !after || !span.length) continue
    const views = Math.max(0, after.views - before.views)
    const favorites = Math.max(0, after.favorites - before.favorites)
    span.forEach((d, j) => {
      const day = out.get(d)
      if (!day) return
      const part = (total: number) => Math.floor(((j + 1) * total) / span.length) - Math.floor((j * total) / span.length)
      day.views += part(views)
      day.favorites += part(favorites)
    })
  }
  return out
}

// --- Money ---

type Money = {
  fees: number
  feesEstimated: boolean
  /** The worked-out part of `fees`. */
  estimatedFees: number
  cost: number
  costEstimated: boolean
  /** Booked fees by kind. */
  byCategory: Map<LedgerCategory, number>
}

const share = (part: number, whole: number, count: number) => (whole > 0 ? part / whole : 1 / Math.max(count, 1))

/** What Etsy charges on one sale at its rates, VAT included, cents. */
function estimatedFees(sale: Sale, salesOfReceipt: number, which: { transaction: boolean; processing: boolean }) {
  const value = sale.amountCents + sale.shippingCents - sale.discountCents
  let fee = 0
  if (which.transaction) fee += value * ETSY_FEES.transaction
  if (which.processing) {
    fee += value * ETSY_FEES.processing + ETSY_FEES.processingFixedCents / Math.max(salesOfReceipt, 1)
  }
  return Math.round(fee * VAT)
}

/** Gelato's print (the size's measured cost; A3 when the size is unknown) and shipping, VAT included. */
const estimatedCost = (sale: Sale) =>
  Math.round(((sale.sizeKey ? MEASURED_CENTS[sale.sizeKey] : MEASURED_CENTS.a3) * sale.quantity + GELATO_SHIPPING) * VAT)

const isVoid = (s: Sale) => VOID_SALE.includes(s.status)


/**
 * Etsy's fees and Gelato's costs of the range's sales per listing, Gelato's
 * total per currency, and each sale's share of its order's Gelato bill (null
 * while unbilled).
 */
function money(ctx: Context, range: Range, rangeSales: Sale[]) {
  const inRange = (ms: number) => ms >= range.fromMs && ms <= range.toMs
  const byTransaction = new Map(ctx.allSales.map((s) => [String(s.transactionId), s]))
  const byReceipt = new Map<string, Sale[]>()
  for (const s of ctx.allSales) {
    const key = String(s.receiptId)
    byReceipt.set(key, [...(byReceipt.get(key) ?? []), s])
  }
  const known = new Set(ctx.listings.map((l) => String(l.listingId)))

  const perListing = new Map<number, Money>()
  const at = (listingId: number) => {
    let m = perListing.get(listingId)
    if (!m) {
      m = { fees: 0, feesEstimated: false, estimatedFees: 0, cost: 0, costEstimated: false, byCategory: new Map() }
      perListing.set(listingId, m)
    }
    return m
  }
  const charge = (listingId: number, category: LedgerCategory, cents: number) => {
    const m = at(listingId)
    m.fees += cents
    m.byCategory.set(category, (m.byCategory.get(category) ?? 0) + cents)
  }
  // Which fees are booked on which sale, by transaction id.
  const booked = new Map<number, Set<LedgerCategory>>()

  for (const e of ctx.entries) {
    if (!FEE_CATEGORIES.includes(e.category) || e.category === "ads") continue
    const fee = -e.amountCents
    const ref = e.referenceId ?? ""
    const sale = byTransaction.get(ref)
    const sales = sale ? [sale] : byReceipt.get(e.receiptId ?? ref)
    if (sales) {
      if (!inRange(sales[0].createdAt)) continue
      const live = sales.filter((s) => !isVoid(s))
      const list = live.length ? live : sales
      const total = list.reduce((sum, s) => sum + s.amountCents, 0)
      for (const s of list) {
        charge(s.listingId, e.category, Math.round(fee * share(s.amountCents, total, list.length)))
        booked.set(s.transactionId, (booked.get(s.transactionId) ?? new Set()).add(e.category))
      }
    } else if (e.category === "listing" && known.has(ref) && inRange(e.createdAt)) {
      // Listing fees (made, renewed) point at the listing itself.
      charge(Number(ref), e.category, fee)
    }
  }

  const costByReceipt = new Map<string, number>()
  for (const c of ctx.allCosts) costByReceipt.set(c.receiptId, (costByReceipt.get(c.receiptId) ?? 0) + c.totalCents)
  const costs = new Map<string, { cents: number; estimated: boolean }>()
  const saleCosts = new Map<number, number | null>()

  for (const s of rangeSales) {
    if (isVoid(s)) continue
    const m = at(s.listingId)
    const receipt = (byReceipt.get(String(s.receiptId)) ?? [s]).filter((x) => !isVoid(x))
    const has = booked.get(s.transactionId)
    const missing = { transaction: !has?.has("transaction"), processing: !has?.has("processing") }
    if (missing.transaction || missing.processing) {
      const fee = estimatedFees(s, receipt.length, missing)
      m.fees += fee
      m.estimatedFees += fee
      m.feesEstimated = true
    }
    const billed = costByReceipt.get(String(s.receiptId))
    const total = receipt.reduce((x, r) => x + r.amountCents, 0)
    const cost = billed !== undefined ? Math.round(billed * share(s.amountCents, total, receipt.length)) : estimatedCost(s)
    m.cost += cost
    if (billed === undefined) m.costEstimated = true
    saleCosts.set(s.transactionId, billed === undefined ? null : cost)
    const sum = costs.get(s.currency) ?? { cents: 0, estimated: false }
    costs.set(s.currency, { cents: sum.cents + cost, estimated: sum.estimated || billed === undefined })
  }
  return { perListing, costs, saleCosts }
}

// --- The page ---

async function context(account: string | null, range: Range) {
  const accounts = (await shopAccounts()).filter((a) => !account || a.id === account)
  const scope = account ?? undefined
  const [listings, allSales, entries, allCosts, tags, sectionLists] = await Promise.all([
    storedListings(scope),
    storedSales(undefined, undefined, scope),
    storedLedger(range.fromMs - BOOKING_SLACK, range.toMs + BOOKING_SLACK, scope),
    storedCosts(undefined, undefined, scope),
    readTags(),
    Promise.all(accounts.map(async (a) => [a.id, await storedSections(a.id)] as const)),
  ])
  const current = new Map(
    await Promise.all(accounts.map(async (a) => [a.id, await currentPoint(a.id, listings)] as const))
  )
  const points = new Map(
    await Promise.all(accounts.map(async (a) => [a.id, await rangePoints(a.id, range, current.get(a.id) ?? null)] as const))
  )
  return { accounts, listings, allSales, entries, allCosts, tags, sections: new Map(sectionLists), current, points }
}

type Context = Awaited<ReturnType<typeof context>>

function buildRows(ctx: Context, range: Range) {
  const rangeSales = ctx.allSales.filter((s) => s.createdAt >= range.fromMs && s.createdAt <= range.toMs)
  const { perListing, costs, saleCosts } = money(ctx, range, rangeSales)
  const shopName = new Map(ctx.accounts.map((a) => [a.id, a.shop?.name ?? a.label]))

  const salesOf = new Map<number, Sale[]>()
  for (const s of rangeSales) salesOf.set(s.listingId, [...(salesOf.get(s.listingId) ?? []), s])

  const counters = new Map<number, Counters>()
  for (const l of ctx.listings) {
    const points = ctx.points.get(l.account)
    counters.set(l.listingId, points ? rangeCounters(l, points, range) : ZERO)
  }

  // Etsy Ads per shop, shared out over its listings by views.
  const adsByAccount = new Map<string, number>()
  for (const e of ctx.entries) {
    if (e.category !== "ads" || e.createdAt < range.fromMs || e.createdAt > range.toMs) continue
    adsByAccount.set(e.account, (adsByAccount.get(e.account) ?? 0) - e.amountCents)
  }
  const viewsByAccount = new Map<string, number>()
  for (const l of ctx.listings) {
    viewsByAccount.set(l.account, (viewsByAccount.get(l.account) ?? 0) + counters.get(l.listingId)!.views)
  }

  const rows: ArtikelRow[] = ctx.listings.map((l) => {
    const c = counters.get(l.listingId)!
    const sold = (salesOf.get(l.listingId) ?? []).filter((s) => !isVoid(s))
    const m = perListing.get(l.listingId)
    const revenue = sold.reduce((sum, s) => sum + saleRevenue(s), 0)
    const prices = l.variants.length ? l.variants.map((v) => v.priceCents) : [l.priceCents]
    const shopViews = viewsByAccount.get(l.account) ?? 0
    const ads = adsByAccount.get(l.account) ?? 0
    const fees = m?.fees ?? 0
    const cost = m?.cost ?? 0
    return {
      listingId: l.listingId,
      account: l.account,
      shop: shopName.get(l.account) ?? l.account,
      title: l.title,
      state: l.state,
      url: l.url,
      thumb: l.images[0]?.url ?? null,
      photos: l.images.length,
      hasVideo: l.hasVideo,
      currency: l.currency,
      priceMin: Math.min(...prices),
      priceMax: Math.max(...prices),
      views: c.views,
      favorites: c.favorites,
      viewsTotal: l.views,
      favoritesTotal: l.favorites,
      sales: sold.reduce((sum, s) => sum + s.quantity, 0),
      orders: new Set(sold.map((s) => s.receiptId)).size,
      revenueCents: revenue,
      feesCents: fees,
      feesEstimated: m?.feesEstimated ?? false,
      costCents: cost,
      costEstimated: m?.costEstimated ?? false,
      profitCents: revenue - fees - cost,
      adsEstCents: shopViews > 0 ? Math.round((ads * c.views) / shopViews) : 0,
      sectionId: l.sectionId,
      section: l.sectionId ? (ctx.sections.get(l.account)?.find((s) => s.id === l.sectionId)?.title ?? null) : null,
      tags: ctx.tags.assigned[l.listingId] ?? [],
      endsAt: l.endsAt,
      createdAt: l.createdAt,
    }
  })
  return { rows, rangeSales, perListing, costs, saleCosts }
}

function summarise(ctx: Context, range: Range, built: ReturnType<typeof buildRows>): ArtikelSummary {
  const { rows, rangeSales, costs } = built
  const currencies = new Map<string, number>()
  for (const r of rows) currencies.set(r.currency, (currencies.get(r.currency) ?? 0) + 1)
  for (const s of rangeSales) if (!currencies.has(s.currency)) currencies.set(s.currency, 0)
  const currency = [...currencies].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "EUR"
  const counted = rows.filter((r) => r.currency === currency)
  const sales = rangeSales.filter((s) => s.currency === currency && !isVoid(s))

  const booked = ctx.entries.filter(
    (e) => e.currency === currency && e.createdAt >= range.fromMs && e.createdAt <= range.toMs
  )
  const fee = (match: (c: LedgerCategory) => boolean) =>
    booked.filter((e) => match(e.category)).reduce((s, e) => s - e.amountCents, 0)
  const fees = fee((c) => FEE_CATEGORIES.includes(c) && c !== "ads")
  const ads = fee((c) => c === "ads")

  // Sales no ledger entry points at yet: their fees are worked out.
  const traced = new Set(ctx.entries.flatMap((e) => [e.referenceId, e.receiptId]).filter((x): x is string => !!x))
  const perReceipt = new Map<number, number>()
  for (const s of sales) perReceipt.set(s.receiptId, (perReceipt.get(s.receiptId) ?? 0) + 1)
  let pending = 0
  for (const s of sales) {
    if (traced.has(String(s.transactionId)) || traced.has(String(s.receiptId))) continue
    pending += estimatedFees(s, perReceipt.get(s.receiptId) ?? 1, { transaction: true, processing: true })
  }

  const revenue = sales.reduce((sum, s) => sum + saleRevenue(s), 0)
  const cost = costs.get(currency) ?? { cents: 0, estimated: false }
  return {
    currency,
    mixedCurrency: currencies.size > 1,
    listings: rows.length,
    active: rows.filter((r) => r.state === "active").length,
    views: counted.reduce((s, r) => s + r.views, 0),
    favorites: counted.reduce((s, r) => s + r.favorites, 0),
    orders: new Set(sales.map((s) => s.receiptId)).size,
    sales: sales.reduce((sum, s) => sum + s.quantity, 0),
    revenueCents: revenue,
    feesCents: fees + pending,
    adsCents: ads,
    listingFeesCents: fee((c) => c === "listing"),
    costCents: cost.cents,
    profitCents: revenue - fees - pending - ads - cost.cents,
    estimated: pending > 0 || cost.estimated,
  }
}

/** Everything the Artikel page shows for one shop (or all) over a range. */
export async function artikelState(account: string | null, range: Range): Promise<ArtikelState> {
  const ctx = await context(account, range)
  const built = buildRows(ctx, range)
  const [allShops, allListings, sync, profiles] = await Promise.all([
    shopAccounts(),
    storedListings(),
    syncStatus(),
    listProfiles(),
  ])

  const firstDays = await Promise.all(ctx.accounts.map((a) => snapshotDays(a.id).then((d) => d[0] ?? null)))
  const known = firstDays.filter((d): d is string => !!d).sort()
  const listingCounts = new Map<string, number>()
  for (const l of allListings) listingCounts.set(l.account, (listingCounts.get(l.account) ?? 0) + 1)
  const ends = [...ctx.points.values()].map((p) => p.end?.at).filter((at): at is number => !!at)

  // Our city shops' listings get the city columns; Artikel shows the rest without them.
  const city = await cityColumns(built.rows).catch((error) => {
    console.warn("Artikel city columns:", (error as Error).message)
    return null
  })
  if (city) for (const row of built.rows) row.city = city.byListing.get(row.listingId)
  const showsCity = !!city && built.rows.some((r) => r.city)

  const shops: ArtikelShop[] = await Promise.all(
    allShops.map(async (a) => ({
      account: a.id,
      label: a.label,
      shop: a.shop?.name ?? a.label,
      currency: a.shop?.currency ?? "EUR",
      sections: await storedSections(a.id),
      listings: listingCounts.get(a.id) ?? 0,
    }))
  )
  return {
    range: { from: range.from, to: range.to },
    coverage: {
      firstSnapshot: known[0] ?? null,
      complete: [...ctx.points.values()].every((p) => !!p.base),
      viewsUntil: ends.length ? Math.min(...ends) : null,
    },
    shops,
    rows: built.rows,
    summary: summarise(ctx, range, built),
    tags: ctx.tags.tags,
    sync,
    profiles: profiles.map(({ id, name, currency, prices }) => ({ id, name, currency, prices })),
    ...(showsCity && { city: { accounts: city.accounts, classifiedAt: city.classifiedAt } }),
  }
}

/** One listing over the range: day by day, its orders and its fees. */
export async function artikelDetail(listingId: number, range: Range): Promise<ArtikelDetail | null> {
  const listing = (await storedListings()).find((l) => l.listingId === listingId)
  if (!listing) return null
  const ctx = await context(listing.account, range)
  const { rows, rangeSales, perListing, saleCosts } = buildRows(ctx, range)
  const row = rows.find((r) => r.listingId === listingId)!

  const counters = await dailyCounters(listing, range, ctx.current.get(listing.account) ?? null)
  const days: ArtikelDetail["days"] = [...counters].map(([date, c]) => ({ date, ...c, orders: 0, revenueCents: 0 }))
  const byDate = new Map(days.map((d) => [d.date, d]))
  const sold = rangeSales.filter((s) => s.listingId === listingId)
  for (const s of sold) {
    const day = byDate.get(dayKey(s.createdAt))
    if (!day || isVoid(s)) continue
    day.orders += 1
    day.revenueCents += saleRevenue(s)
  }

  const m = perListing.get(listingId)
  const item = await itemForListing(listingId).catch(() => null)
  return {
    row,
    variants: listing.variants,
    images: listing.images,
    tagsOnEtsy: listing.tags,
    days,
    orders: sold
      .toSorted((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({
        receiptId: s.receiptId,
        at: s.createdAt,
        title: s.title,
        size: s.sizeKey,
        quantity: s.quantity,
        revenueCents: saleRevenue(s),
        status: s.status,
        country: s.country,
        costCents: saleCosts.get(s.transactionId) ?? null,
      })),
    fees: [...(m?.byCategory ?? [])].map(([category, cents]) => ({ category, cents })).filter((f) => f.cents !== 0),
    feesEstimatedCents: m?.estimatedFees ?? 0,
    pipeline: item ? { itemId: item.id, chainId: item.chainId } : null,
  }
}
