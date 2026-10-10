import type { Account } from "@/lib/accounts/types"
import type { SizeKey } from "@/lib/catalog/sizes"
import { eurRates, toEur, type Rates } from "@/lib/pricing/fx"
import { costs, ledger, listings, sales, shopAccounts, snapshotBefore, snapshots, syncStatus } from "@/lib/sync/store"
import {
  FEE_CATEGORIES,
  saleRevenue,
  VOID_SALE,
  type DailySnapshot,
  type LedgerEntry,
  type ProductionCost,
  type Sale,
  type SyncedListing,
  type SyncStatus,
} from "@/lib/sync/types"

import { addDays, bucketOf, dayOf, daysBetween, monthStart, resolveRange, weekStart, type Range } from "./time"
import type { Bucket, BestSeller, ExpenseKey, PerformanceQuery, PerformanceReport, Totals } from "./types"

// The Performance page's numbers, worked out from what the sync keeps on
// disk each time they're asked for: a few thousand sales and ledger entries
// add up in milliseconds, so nothing is stored. `buildReport` does the sums
// on data handed to it; `performanceReport` reads that data first.

/** Days one listing fee pays for: four months. */
const LISTING_DAYS = 120
const BEST_SELLERS = 10
const EXPIRING_DAYS = 14
const DAY = 24 * 60 * 60 * 1000

export type ReportData = {
  /** Every account with a shop; `scope` the ones shown. */
  accounts: Account[]
  scope: Account[]
  sales: Sale[]
  ledger: LedgerEntry[]
  costs: ProductionCost[]
  listings: SyncedListing[]
  /** Per shown account, oldest first: the last one before the range, then the range's. */
  snapshots: DailySnapshot[][]
  sync: SyncStatus[]
  rates: Rates
  /** Epoch ms of "now". */
  now: number
}

export async function performanceReport(query: PerformanceQuery): Promise<PerformanceReport> {
  const accounts = await shopAccounts()
  const one = accounts.find((a) => a.id === query.account)
  const id = one?.id
  const [s, l, c, li, sync, rates] = await Promise.all([
    sales(undefined, undefined, id),
    ledger(undefined, undefined, id),
    costs(undefined, undefined, id),
    listings(id),
    syncStatus(),
    eurRates(),
  ])
  const data: ReportData = {
    accounts,
    scope: one ? [one] : accounts,
    sales: s,
    ledger: l,
    costs: c,
    listings: li,
    snapshots: [],
    sync,
    rates,
    now: Date.now(),
  }
  const today = dayOf(data.now)
  const range = resolveRange(query.range, query.offset, today, firstDay(data), query.by)
  const end = range.to < today ? range.to : today
  data.snapshots = await Promise.all(
    data.scope.map(async (a) => {
      const [before, within] = await Promise.all([snapshotBefore(a.id, addDays(range.from, -1)), snapshots(a.id, range.from, end)])
      return before ? [before, ...within] : within
    })
  )
  return buildReport(data, query, range)
}

/** The earliest day anything happened in the shown shops. */
export function firstDay(data: Pick<ReportData, "scope" | "sales" | "ledger" | "costs">) {
  let first = Infinity
  for (const list of [data.sales, data.ledger, data.costs]) for (const x of list) first = Math.min(first, x.createdAt)
  for (const a of data.scope) if (a.shop?.createdAt) first = Math.min(first, Date.parse(a.shop.createdAt))
  return Number.isFinite(first) ? dayOf(first) : null
}

// --- Money per day ---

type Day = { revenue: number; orders: number; items: number; expenses: Partial<Record<ExpenseKey, number>> }

type Ledgered = {
  /** Everything but listing fees, on the day it happened. */
  days: Map<string, Day>
  /** Listing fees on the day they were paid. */
  listingFees: Map<string, number>
}

const add = (to: Partial<Record<ExpenseKey, number>>, key: ExpenseKey, cents: number) => {
  to[key] = (to[key] ?? 0) + cents
}

function ledgered(data: ReportData): Ledgered {
  const days = new Map<string, Day>()
  const listingFees = new Map<string, number>()
  const at = (day: string) => {
    let entry = days.get(day)
    if (!entry) days.set(day, (entry = { revenue: 0, orders: 0, items: 0, expenses: {} }))
    return entry
  }
  const eur = (cents: number, currency: string) => toEur(cents, currency, data.rates) ?? cents

  const receipts = new Set<string>()
  for (const sale of data.sales) {
    if (VOID_SALE.includes(sale.status)) continue
    const day = at(dayOf(sale.createdAt))
    day.revenue += eur(saleRevenue(sale), sale.currency)
    day.items += sale.quantity
    const receipt = `${sale.account}:${sale.receiptId}`
    if (!receipts.has(receipt)) {
      receipts.add(receipt)
      day.orders++
    }
  }
  // Fees are booked negative; a fee given back (a refunded sale's transaction fee) positive.
  for (const entry of data.ledger) {
    if (!FEE_CATEGORIES.includes(entry.category)) continue
    const cents = -eur(entry.amountCents, entry.currency)
    const day = dayOf(entry.createdAt)
    if (entry.category === "listing") listingFees.set(day, (listingFees.get(day) ?? 0) + cents)
    else add(at(day).expenses, entry.category as ExpenseKey, cents)
  }
  for (const cost of data.costs) {
    if (/cancel/i.test(cost.status)) continue
    add(at(dayOf(cost.createdAt)).expenses, "production", eur(cost.totalCents, cost.currency))
  }
  // Opening a shop costs a one-off fee that may predate the ledger the sync can read.
  for (const account of data.scope) {
    if (account.setupFeeCents <= 0) continue
    if (data.ledger.some((e) => e.account === account.id && e.category === "setup")) continue
    add(at(dayOf(Date.parse(account.shop?.createdAt ?? account.createdAt))).expenses, "setup", account.setupFeeCents)
  }
  return { days, listingFees }
}

type DayRow = Day & { day: string; future: boolean }

/** Each day from `from` to `to`, listing fees spread over the days they pay for; days after today stay empty. */
function daily({ days, listingFees }: Ledgered, from: string, to: string, today: string): DayRow[] {
  const length = daysBetween(from, to) + 1
  if (length <= 0) return []
  const diff = new Float64Array(length + 1)
  for (const [day, cents] of listingFees) {
    const start = daysBetween(from, day)
    const a = Math.max(start, 0)
    const b = Math.min(start + LISTING_DAYS, length)
    if (a >= b) continue
    diff[a] += cents / LISTING_DAYS
    diff[b] -= cents / LISTING_DAYS
  }
  let share = 0
  return Array.from({ length }, (_, i) => {
    share += diff[i]
    const day = addDays(from, i)
    if (day > today) return { day, future: true, revenue: 0, orders: 0, items: 0, expenses: {} }
    const entry = days.get(day)
    const expenses = { ...entry?.expenses }
    if (Math.abs(share) > 1e-9) expenses.listing = share
    return { day, future: false, revenue: entry?.revenue ?? 0, orders: entry?.orders ?? 0, items: entry?.items ?? 0, expenses }
  })
}

function totalsOf(rows: Day[]): Totals & { expenses: Partial<Record<ExpenseKey, number>> } {
  const expenses: Partial<Record<ExpenseKey, number>> = {}
  let revenue = 0
  let orders = 0
  let items = 0
  for (const row of rows) {
    revenue += row.revenue
    orders += row.orders
    items += row.items
    for (const [key, cents] of Object.entries(row.expenses)) add(expenses, key as ExpenseKey, cents)
  }
  const spent = Object.values(expenses).reduce((sum, c) => sum + c, 0)
  return {
    revenueCents: Math.round(revenue),
    expensesCents: Math.round(spent),
    profitCents: Math.round(revenue - spent),
    orders,
    items,
    adsCents: Math.round((expenses.ads ?? 0) + (expenses.offsite_ads ?? 0)),
    expenses,
  }
}

const strip = (totals: ReturnType<typeof totalsOf>): Totals => ({
  revenueCents: totals.revenueCents,
  expensesCents: totals.expensesCents,
  profitCents: totals.profitCents,
  orders: totals.orders,
  items: totals.items,
  adsCents: totals.adsCents,
})

// --- The report ---

export function buildReport(data: ReportData, query: PerformanceQuery, range: Range): PerformanceReport {
  const today = dayOf(data.now)
  const accounts = data.accounts.map((a) => ({ id: a.id, label: a.label, shopName: a.shop?.name ?? null }))
  const scopeIds = new Set(data.scope.map((a) => a.id))
  const sync = data.sync.filter((s) => scopeIds.has(s.account))
  const account = data.scope.length === 1 && data.scope[0].id === query.account ? query.account : "all"
  const base = {
    accounts,
    account,
    range: {
      key: query.range,
      offset: Math.min(0, Math.trunc(query.offset)),
      from: range.from,
      to: range.to,
      today,
      by: range.by,
      label: range.label,
      previousLabel: range.previous?.label ?? null,
    },
    sync,
  }

  const synced = sync.some((s) => s.listings || s.sales || s.ledger || s.costs)
  if (!data.accounts.length || (!synced && !data.sales.length && !data.ledger.length && !data.listings.length)) {
    return { ...base, ...emptyReport(), state: data.accounts.length ? "no-sync" : "no-shop" }
  }

  const money = ledgered(data)
  const rows = daily(money, range.from, range.to, today)
  const totals = totalsOf(rows)

  // All time counts listing fees when paid; the month and week so far by time share.
  let allTime = 0
  for (const day of money.days.values()) {
    allTime += day.revenue - Object.values(day.expenses).reduce((sum, c) => sum + c, 0)
  }
  for (const cents of money.listingFees.values()) allTime -= cents
  const headline = {
    allTimeCents: Math.round(allTime),
    monthCents: totalsOf(daily(money, monthStart(today), today, today)).profitCents,
    weekCents: totalsOf(daily(money, weekStart(today), today, today)).profitCents,
  }

  const views = viewsPerDay(data.snapshots)
  const buckets: Bucket[] = []
  for (const row of rows) {
    const start = bucketOf(row.day, range.by)
    let bucket = buckets.at(-1)
    if (!bucket || bucket.start !== start) {
      bucket = { start, future: true, revenueCents: 0, expensesCents: 0, profitCents: 0, orders: 0, items: 0, adsCents: 0, expenses: {}, views: null }
      buckets.push(bucket)
    }
    bucket.future &&= row.future
    bucket.revenueCents += row.revenue
    bucket.orders += row.orders
    bucket.items += row.items
    for (const [key, cents] of Object.entries(row.expenses)) add(bucket.expenses, key as ExpenseKey, cents)
    const seen = views.get(row.day)
    if (seen) bucket.views = (bucket.views ?? 0) + seen.views
  }
  for (const bucket of buckets) {
    const spent = Object.values(bucket.expenses).reduce((sum, c) => sum + c, 0)
    bucket.expensesCents = Math.round(spent)
    bucket.profitCents = Math.round(bucket.revenueCents - spent)
    bucket.revenueCents = Math.round(bucket.revenueCents)
    bucket.adsCents = Math.round((bucket.expenses.ads ?? 0) + (bucket.expenses.offsite_ads ?? 0))
    for (const key of Object.keys(bucket.expenses) as ExpenseKey[]) bucket.expenses[key] = Math.round(bucket.expenses[key]!)
  }

  const end = range.to < today ? range.to : today
  const inRange = (day: string) => day >= range.from && day <= end

  let feesPaid = 0
  for (const [day, cents] of money.listingFees) if (inRange(day)) feesPaid += cents
  const now = data.now
  const live = data.listings.filter((l) => l.state === "active")

  let traffic: PerformanceReport["traffic"] = null
  const counted = [...views].filter(([day]) => inRange(day))
  if (counted.length) {
    traffic = {
      views: counted.reduce((sum, [, v]) => sum + v.views, 0),
      favorites: counted.reduce((sum, [, v]) => sum + v.favorites, 0),
      since: counted.map(([day]) => day).sort()[0],
    }
  }

  return {
    ...base,
    state: "ok",
    headline,
    totals: strip(totals),
    previous: range.previous ? strip(totalsOf(daily(money, range.previous.from, range.previous.to, today))) : null,
    buckets,
    expenses: (Object.entries(totals.expenses) as [ExpenseKey, number][])
      .map(([key, cents]) => ({ key, cents: Math.round(cents) }))
      .filter((e) => e.cents !== 0)
      .sort((a, b) => b.cents - a.cents),
    bestSellers: bestSellers(data, inRange, totals),
    listings: {
      live: live.length,
      added: data.listings.filter((l) => inRange(dayOf(l.createdAt))).length,
      expiring: live.filter((l) => l.endsAt && l.endsAt > now && l.endsAt - now <= EXPIRING_DAYS * DAY).length,
      feesPaidCents: Math.round(feesPaid),
    },
    traffic,
    listingFees: listingFeeWeeks(money, end, today),
  }
}

function emptyReport(): Omit<PerformanceReport, "state" | "accounts" | "account" | "range" | "sync"> {
  const zero: Totals = { revenueCents: 0, expensesCents: 0, profitCents: 0, orders: 0, items: 0, adsCents: 0 }
  return {
    headline: { allTimeCents: 0, monthCents: 0, weekCents: 0 },
    totals: zero,
    previous: null,
    buckets: [],
    expenses: [],
    bestSellers: [],
    listings: { live: 0, added: 0, expiring: 0, feesPaidCents: 0 },
    traffic: null,
    listingFees: { weeks: [], prepaidCents: 0 },
  }
}

/** Views and favourites gained per day: each snapshot against the one before it (a new listing from zero). */
function viewsPerDay(perAccount: DailySnapshot[][]) {
  const days = new Map<string, { views: number; favorites: number }>()
  for (const list of perAccount) {
    for (let i = 1; i < list.length; i++) {
      const before = list[i - 1].listings
      let views = 0
      let favorites = 0
      for (const [id, now] of Object.entries(list[i].listings)) {
        views += Math.max(0, now.views - (before[id]?.views ?? 0))
        favorites += now.favorites - (before[id]?.favorites ?? 0)
      }
      const day = days.get(list[i].date) ?? { views: 0, favorites: 0 }
      days.set(list[i].date, { views: day.views + views, favorites: day.favorites + favorites })
    }
  }
  return days
}

/**
 * The range's best listings by revenue. Gelato bills per order, so an order
 * with several listings splits its cost by their share of its revenue; Etsy's
 * sale fees (transaction and processing) come off at the range's own rate.
 */
function bestSellers(data: ReportData, inRange: (day: string) => boolean, totals: ReturnType<typeof totalsOf>): BestSeller[] {
  const eur = (cents: number, currency: string) => toEur(cents, currency, data.rates) ?? cents
  const sold = data.sales.filter((s) => !VOID_SALE.includes(s.status) && inRange(dayOf(s.createdAt)))
  if (!sold.length) return []

  const production = new Map<string, number>()
  for (const cost of data.costs) {
    if (/cancel/i.test(cost.status)) continue
    const key = `${cost.account}:${cost.receiptId}`
    production.set(key, (production.get(key) ?? 0) + eur(cost.totalCents, cost.currency))
  }
  const receiptRevenue = new Map<string, number>()
  for (const sale of sold) {
    const key = `${sale.account}:${sale.receiptId}`
    receiptRevenue.set(key, (receiptRevenue.get(key) ?? 0) + eur(saleRevenue(sale), sale.currency))
  }
  const feeRate =
    totals.revenueCents > 0 ? ((totals.expenses.transaction ?? 0) + (totals.expenses.processing ?? 0)) / totals.revenueCents : 0

  const byListing = new Map<number, { sales: Sale[]; revenue: number; production: number; receipts: Set<string> }>()
  for (const sale of sold) {
    const key = `${sale.account}:${sale.receiptId}`
    const revenue = eur(saleRevenue(sale), sale.currency)
    const share = (receiptRevenue.get(key) ?? 0) > 0 ? revenue / receiptRevenue.get(key)! : 0
    const entry = byListing.get(sale.listingId) ?? { sales: [], revenue: 0, production: 0, receipts: new Set() }
    entry.sales.push(sale)
    entry.revenue += revenue
    entry.production += (production.get(key) ?? 0) * share
    entry.receipts.add(key)
    byListing.set(sale.listingId, entry)
  }

  const listed = new Map(data.listings.map((l) => [l.listingId, l]))
  return [...byListing]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, BEST_SELLERS)
    .map(([listingId, entry]) => {
      const listing = listed.get(listingId)
      const sizes = new Map<SizeKey, number>()
      for (const sale of entry.sales) if (sale.sizeKey) sizes.set(sale.sizeKey, (sizes.get(sale.sizeKey) ?? 0) + sale.quantity)
      return {
        listingId,
        account: entry.sales[0].account,
        title: listing?.title ?? entry.sales[0].title,
        url: listing?.url ?? null,
        image: listing?.images[0]?.url ?? null,
        orders: entry.receipts.size,
        items: entry.sales.reduce((sum, s) => sum + s.quantity, 0),
        revenueCents: Math.round(entry.revenue),
        productionCents: Math.round(entry.production),
        leftCents: Math.round(entry.revenue * (1 - feeRate) - entry.production),
        topSize: [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      }
    })
}

/** Twelve weeks up to `end`: listing fees paid each week, and the share of all fees those days used up. */
function listingFeeWeeks(money: Ledgered, end: string, today: string): PerformanceReport["listingFees"] {
  const last = weekStart(end)
  const first = addDays(last, -7 * 11)
  const rows = daily(money, first, addDays(last, 6), today)
  const weeks = Array.from({ length: 12 }, (_, i) => ({ start: addDays(first, i * 7), paidCents: 0, sharedCents: 0 }))
  for (const row of rows) {
    const week = weeks[Math.floor(daysBetween(first, row.day) / 7)]
    week.sharedCents += row.expenses.listing ?? 0
    week.paidCents += money.listingFees.get(row.day) ?? 0
  }
  let prepaid = 0
  for (const [day, cents] of money.listingFees) {
    const used = Math.min(Math.max(daysBetween(day, today) + 1, 0), LISTING_DAYS)
    if (day <= today) prepaid += (cents * (LISTING_DAYS - used)) / LISTING_DAYS
  }
  return {
    weeks: weeks.map((w) => ({ ...w, paidCents: Math.round(w.paidCents), sharedCents: Math.round(w.sharedCents) })),
    prepaidCents: Math.round(prepaid),
  }
}
