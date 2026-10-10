import { withReviewCount } from "./estimate"
import { formatCurrency } from "./format"
import type { Listing, ListingShop, ShopListingSort, ShopReview } from "./types"

// Everything the shop analysis shows, computed in the browser from the sample
// of listings (and reviews) it fetched. Pure functions: the page recomputes as
// each page of data lands, so insights fill in while the fetch runs.

const DAY_MS = 24 * 60 * 60 * 1000
/** Listings and reviews come 100 per request (plus one batch call per listing page). */
const PER_REQUEST = 100

// --- The plan: what to fetch ---

export type ReviewWindow = "none" | "90d" | "1y" | "all"

export const REVIEW_WINDOWS: { value: ReviewWindow; label: string; days: number | null }[] = [
  { value: "none", label: "No reviews", days: 0 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "1y", label: "Last 12 months", days: 365 },
  { value: "all", label: "All time", days: null },
]

export const SHOP_SORTS: { value: ShopListingSort; label: string; hint: string }[] = [
  { value: "created", label: "Newest first", hint: "Most recently created listings" },
  {
    value: "updated",
    label: "Recently updated",
    hint: "Listings auto-renew when they sell, so this leans toward recent sellers",
  },
  { value: "score", label: "Etsy ranking", hint: "The shop's own default order" },
  { value: "price-desc", label: "Highest price", hint: "Most expensive first" },
]

export type AnalysisPlan = {
  /** How many of the shop's active listings to fetch. */
  limit: number
  sort: ShopListingSort
  reviews: ReviewWindow
}

/** Unix seconds to fetch reviews from, rounded to the day so the server cache hits. */
export function reviewsSince(window: ReviewWindow) {
  const days = REVIEW_WINDOWS.find((w) => w.value === window)?.days
  if (!days) return undefined
  return dayStart(Date.now() - days * DAY_MS)
}

/**
 * Unix seconds to fetch reviews from when every review in the window up to
 * `heldAt` (ISO 8601) is held already: the start of that day, or of the
 * window if that's later.
 */
export function newReviewsSince(window: ReviewWindow, heldAt: string) {
  return Math.max(reviewsSince(window) ?? 0, dayStart(Date.parse(heldAt)))
}

function dayStart(ms: number) {
  return Math.floor(ms / DAY_MS) * (DAY_MS / 1000)
}

/**
 * Expected API requests for a plan. Review counts in a window aren't known up
 * front, so those assume reviews arrived evenly since the shop opened.
 */
export function planCost(plan: AnalysisPlan, shop: ListingShop) {
  const listings = Math.ceil(plan.limit / PER_REQUEST) * 2
  return listings + expectedReviewPages(plan.reviews, shop)
}

function expectedReviewPages(window: ReviewWindow, shop: ListingShop) {
  const days = REVIEW_WINDOWS.find((w) => w.value === window)?.days
  if (days === 0 || days === undefined) return 0
  const ageDays = Math.max((Date.now() - Date.parse(shop.openedAt)) / DAY_MS, 1)
  const share = days === null ? 1 : Math.min(days / ageDays, 1)
  return Math.max(1, Math.ceil((shop.reviewCount * share) / PER_REQUEST))
}

/** A sensible first plan: the whole shop if it's small, and the deepest review window that stays cheap. */
export function defaultPlan(shop: ListingShop): AnalysisPlan {
  const limit = shop.activeListings <= 500 ? shop.activeListings : 500
  const reviews =
    (["all", "1y", "90d"] as const).find((w) => expectedReviewPages(w, shop) <= 20) ?? "none"
  return { limit: Math.max(limit, 1), sort: "created", reviews }
}

// --- Reviews ---

/**
 * With every review the shop has, each listing's review count is exact, and
 * the estimates are redone with it — the strongest signal there is. A partial
 * window would undercount, so it only feeds the "recent" numbers.
 */
export function applyReviews(listings: Listing[], reviews: ShopReview[]) {
  const counts = countByListing(reviews)
  return listings.map((l) => withReviewCount(l, counts.get(l.id) ?? 0))
}

export function countByListing(reviews: ShopReview[]) {
  const counts = new Map<number, number>()
  for (const r of reviews) counts.set(r.listingId, (counts.get(r.listingId) ?? 0) + 1)
  return counts
}

// --- Insights ---

export type Share = { listings: number; revenue: number }

export type Band = {
  label: string
  listings: number
  revenueCents: number
  /** Fractions of the sample. */
  share: Share
}

export type TagStat = {
  tag: string
  listings: number
  revenueCents: number
  revenueShare: number
  /** Average revenue per listing with the tag ÷ the sample's average. */
  lift: number
}

export type Segment = { label: string; hint: string; count: number; share: Share }

export type ReviewMonth = {
  /** YYYY-MM */
  month: string
  count: number
  averageRating: number | null
}

export type ShopInsights = {
  count: number
  salesPerMonth: number
  revenuePerMonthCents: number
  /** Sum of the sample's estimated lifetime sales. */
  lifetimeSales: number
  medianPriceCents: number
  medianSalesPerMonth: number
  /** Listings making 80% of the sample's revenue, top earners first. */
  hitsFor80: number
  /** Cumulative revenue share against listing share, top earners first. */
  curve: { listings: number; revenue: number }[]
  priceBands: Band[]
  cohorts: Band[]
  tags: TagStat[]
  segments: Segment[]
}

export function analyse(listings: Listing[], currency: string): ShopInsights {
  const count = listings.length
  const revenue = sum(listings, (l) => l.estimate.revenuePerMonthCents)
  const byRevenue = [...listings].sort(
    (a, b) => b.estimate.revenuePerMonthCents - a.estimate.revenuePerMonthCents
  )

  return {
    count,
    salesPerMonth: sum(listings, (l) => l.estimate.salesPerMonth),
    revenuePerMonthCents: revenue,
    lifetimeSales: sum(listings, (l) => l.estimate.sales),
    medianPriceCents: median(listings.map((l) => l.priceCents)),
    medianSalesPerMonth: median(listings.map((l) => l.estimate.salesPerMonth)),
    ...concentration(byRevenue, revenue),
    priceBands: priceBands(listings, revenue, currency),
    cohorts: cohorts(listings, revenue),
    tags: tagStats(listings, revenue),
    segments: segments(listings, revenue),
  }
}

// The Lorenz curve, thinned to ~100 points so big shops chart quickly.
function concentration(byRevenue: Listing[], total: number) {
  const n = byRevenue.length
  const curve = [{ listings: 0, revenue: 0 }]
  const every = Math.max(1, Math.floor(n / 100))
  let running = 0
  let hitsFor80 = n
  byRevenue.forEach((l, i) => {
    running += l.estimate.revenuePerMonthCents
    const share = total ? running / total : 0
    if (hitsFor80 === n && share >= 0.8) hitsFor80 = i + 1
    if ((i + 1) % every === 0 || i === n - 1) {
      curve.push({ listings: (i + 1) / n, revenue: share })
    }
  })
  return { curve, hitsFor80: n ? hitsFor80 : 0 }
}

// Fixed, round price steps (in currency units) read better than quantiles;
// the empty steps at either end are dropped.
const PRICE_STEPS = [0, 10, 25, 50, 100, 250, 500, 1000]

function priceBands(listings: Listing[], revenue: number, currency: string): Band[] {
  const price = (units: number) =>
    formatCurrency(units * 100, currency, { maximumFractionDigits: 0 })
  const bands = PRICE_STEPS.map((low, i) => {
    const high = PRICE_STEPS[i + 1]
    const inBand = listings.filter((l) => {
      const units = l.priceCents / 100
      return units >= low && (high === undefined || units < high)
    })
    return toBand(
      high === undefined ? `${price(low)}+` : `${price(low)}–${price(high)}`,
      inBand,
      listings.length,
      revenue
    )
  })
  const first = bands.findIndex((b) => b.listings > 0)
  const last = bands.findLastIndex((b) => b.listings > 0)
  return first === -1 ? [] : bands.slice(first, last + 1)
}

// By the year each listing was first published.
function cohorts(listings: Listing[], revenue: number): Band[] {
  const years = new Map<number, Listing[]>()
  for (const l of listings) {
    const year = new Date(l.createdAt).getUTCFullYear()
    years.set(year, [...(years.get(year) ?? []), l])
  }
  if (years.size === 0) return []
  const min = Math.min(...years.keys())
  const max = Math.max(...years.keys())
  return Array.from({ length: max - min + 1 }, (_, i) =>
    toBand(String(min + i), years.get(min + i) ?? [], listings.length, revenue)
  )
}

function toBand(label: string, inBand: Listing[], total: number, revenue: number): Band {
  const revenueCents = sum(inBand, (l) => l.estimate.revenuePerMonthCents)
  return {
    label,
    listings: inBand.length,
    revenueCents,
    share: {
      listings: total ? inBand.length / total : 0,
      revenue: revenue ? revenueCents / revenue : 0,
    },
  }
}

const MAX_TAGS = 15

function tagStats(listings: Listing[], revenue: number): TagStat[] {
  const tags = new Map<string, { listings: number; revenueCents: number }>()
  for (const l of listings) {
    for (const tag of new Set(l.tags.map((t) => t.toLowerCase().trim()))) {
      const stat = tags.get(tag) ?? { listings: 0, revenueCents: 0 }
      stat.listings++
      stat.revenueCents += l.estimate.revenuePerMonthCents
      tags.set(tag, stat)
    }
  }

  // A tag on a single listing is that listing, not a pattern.
  const minListings = listings.length >= 10 ? 2 : 1
  const average = listings.length ? revenue / listings.length : 0
  return [...tags]
    .filter(([, s]) => s.listings >= minListings)
    .map(([tag, s]) => ({
      tag,
      listings: s.listings,
      revenueCents: s.revenueCents,
      revenueShare: revenue ? s.revenueCents / revenue : 0,
      lift: average ? s.revenueCents / s.listings / average : 0,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, MAX_TAGS)
}

const NEW_DAYS = 90

function segments(listings: Listing[], revenue: number): Segment[] {
  const defs = [
    { label: "Digital", hint: "Instant downloads", match: (l: Listing) => l.isDigital },
    {
      label: "Personalizable",
      hint: "Buyers can add a personalization",
      match: (l: Listing) => l.isPersonalizable,
    },
    {
      label: `New (${NEW_DAYS}d)`,
      hint: `First listed in the last ${NEW_DAYS} days`,
      match: (l: Listing) => l.ageDays <= NEW_DAYS,
    },
  ]
  return defs.map(({ label, hint, match }) => {
    const band = toBand(label, listings.filter(match), listings.length, revenue)
    return { label, hint, count: band.listings, share: band.share }
  })
}

/** Reviews per calendar month, oldest first, with empty months filled in. */
export function reviewMonths(reviews: ShopReview[], maxMonths = 24): ReviewMonth[] {
  if (reviews.length === 0) return []
  const months = new Map<string, { count: number; ratings: number }>()
  for (const r of reviews) {
    const key = new Date(r.createdAt).toISOString().slice(0, 7)
    const m = months.get(key) ?? { count: 0, ratings: 0 }
    m.count++
    m.ratings += r.rating
    months.set(key, m)
  }

  const now = new Date()
  const oldest = new Date(Math.min(...reviews.map((r) => r.createdAt)))
  const span =
    (now.getUTCFullYear() - oldest.getUTCFullYear()) * 12 +
    now.getUTCMonth() -
    oldest.getUTCMonth() +
    1
  const length = Math.min(span, maxMonths)

  return Array.from({ length }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (length - 1 - i), 1))
    const key = d.toISOString().slice(0, 7)
    const m = months.get(key)
    return {
      month: key,
      count: m?.count ?? 0,
      averageRating: m ? m.ratings / m.count : null,
    }
  })
}

// --- Helpers ---

function sum<T>(items: T[], by: (item: T) => number) {
  return items.reduce((total, item) => total + by(item), 0)
}

function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
