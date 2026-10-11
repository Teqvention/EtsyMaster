import { blendSales, confidenceOf, toEstimate, TYPICAL, type Rates } from "./estimate"
import type { CountSnapshot, Listing, ListingRank, ListingShop, RankTier, ShopReview } from "./types"

// A shop analysis, calibrated on the shop itself. With every review it ever
// got and the lifetime sales Etsy reports, the shop's own rates replace the
// typical ones: how many buyers leave a review (3% to 22% from shop to shop),
// and how many favorites and views come with a sale. Each listing is then
// estimated as in `estimate.ts`, and the estimates are scaled so the analysed
// listings add up to the sales their reviews account for: the shop's total,
// less what listings no longer active sold.
//
// The ranking goes by the last 12 months. A listing's usual pace (its
// lifetime estimate spread over its age) says how much it would have sold in
// the year, so how many reviews to expect; the reviews it actually got move
// the estimate as far as their number allows. One or two reviews barely move
// a small seller, but a big one that got none in a year drops. The year's
// estimates are scaled to the year's sales, and the last 90 days against the
// year give the trend; where reviews are too few, favorites gained since an
// earlier analysis do.

const DAY_MS = 24 * 60 * 60 * 1000
const YEAR_DAYS = 365
const QUARTER_DAYS = 90
const DAYS_PER_MONTH = 30
/** Fewer reviews than this, and a shop's own rates are too noisy: typical ones stand in. */
const MIN_REVIEWS = 10
/** Reviews in the last year a listing needs for a trend of its own. */
const TREND_REVIEWS = 4
/** An earlier analysis this much older counts for favorites gained. */
const SNAPSHOT_MIN_DAYS = 3
/**
 * How firmly the usual pace holds against the year's reviews (a gamma prior's
 * shape): the year's estimate is (K + reviews) / (K / pace + review rate).
 */
const PACE_HOLD = 4

export type ShopCalibration = {
  /** Reviews per sale, measured from the shop's reviews and sales, or typical. */
  reviewRate: number
  favoritesPerSale: number
  viewsPerSale: number
  /** The rates were measured on this shop, not assumed. */
  measured: { reviewRate: boolean; attention: boolean }
  /** Every review the shop ever got is in. */
  reviewsComplete: boolean
  reviews: { all: number; onListings: number; year: number; yearOnListings: number }
  /** Share of the shop's sales the analysed listings made: their reviews ÷ all reviews. */
  coveredShare: number | null
  /** The shop's sales in the last 12 months (every listing, retired ones too), from its reviews. */
  salesLastYear: number | null
  /** The earlier analysis favorites gained are counted from. */
  snapshotAt: string | null
}

export type Calibrated = { listings: Listing[]; calibration: ShopCalibration }

export function calibrateShop(
  listings: Listing[],
  reviews: ShopReview[],
  shop: ListingShop,
  {
    reviewsComplete,
    analysedAt = new Date().toISOString(),
    snapshots = [],
  }: { reviewsComplete: boolean; analysedAt?: string | null; snapshots?: CountSnapshot[] }
): Calibrated {
  const now = Date.parse(analysedAt ?? "") || Date.now()
  const yearAgo = now - YEAR_DAYS * DAY_MS
  const quarterAgo = now - QUARTER_DAYS * DAY_MS
  const held = new Set(listings.map((l) => l.id))

  // Reviews per listing: all of them, the last year's, the last 90 days'.
  const counts = new Map<number, { all: number; year: number; quarter: number }>()
  let onListings = 0
  let year = 0
  let yearOnListings = 0
  for (const r of reviews) {
    const recent = r.createdAt >= yearAgo
    if (recent) year++
    if (!held.has(r.listingId)) continue
    onListings++
    if (recent) yearOnListings++
    const c = counts.get(r.listingId) ?? { all: 0, year: 0, quarter: 0 }
    c.all++
    if (recent) c.year++
    if (r.createdAt >= quarterAgo) c.quarter++
    counts.set(r.listingId, c)
  }

  // The shop's own rates, where there's enough to measure them.
  const total = shop.totalSales || null
  const measuredRate = reviewsComplete && total !== null && reviews.length >= MIN_REVIEWS
  const reviewRate = measuredRate ? clamp(reviews.length / total, 0.01, 0.6) : TYPICAL.reviewRate
  const salesOfListings = reviewsComplete && onListings >= MIN_REVIEWS ? onListings / reviewRate : null
  const favorites = sum(listings, (l) => l.favorites)
  const views = sum(listings, (l) => l.views)
  const measuredAttention = salesOfListings !== null && onListings >= 2 * MIN_REVIEWS && favorites > 0
  const rates: Rates = {
    reviewRate,
    favoritesPerSale: measuredAttention ? clamp(favorites / salesOfListings, 0.5, 500) : TYPICAL.favoritesPerSale,
    viewsPerSale: measuredAttention && views > 0 ? clamp(views / salesOfListings, 5, 20_000) : TYPICAL.viewsPerSale,
  }

  // Lifetime: each listing blended, then scaled to what its reviews account for.
  const lifetime = listings.map((l) => {
    const c = counts.get(l.id)
    return blendSales({ favorites: l.favorites, views: l.views, reviews: reviewsComplete ? (c?.all ?? 0) : null }, rates)
  })
  const lifetimeScale = scaleTo(salesOfListings, sum(lifetime, (b) => b.sales))

  // The last 12 months: the usual pace over the year, against the year's reviews.
  const yearSalesOfListings = reviewsComplete && yearOnListings >= MIN_REVIEWS ? yearOnListings / reviewRate : null
  const recent = listings.map((l, i) => {
    const days = Math.min(Math.max(l.ageDays, 1), YEAR_DAYS)
    const paced = lifetime[i].sales * lifetimeScale * (days / Math.max(l.ageDays, 1))
    if (!reviewsComplete) return paced
    const r = counts.get(l.id)?.year ?? 0
    return (PACE_HOLD + r) / (PACE_HOLD / Math.max(paced, 0.05) + reviewRate)
  })
  const recentScale = scaleTo(yearSalesOfListings, sum(recent, (s) => s))

  const snapshot = earlierSnapshot(snapshots, now)
  const cap = total
  const estimated = listings.map((l, i) => {
    const days = Math.min(Math.max(l.ageDays, 1), YEAR_DAYS)
    const recentSales = recent[i] * recentScale
    const reviewCount = reviewsComplete ? (counts.get(l.id)?.all ?? 0) : null
    return {
      listing: l,
      recentSales,
      estimate: toEstimate({
        sales: lifetime[i].sales * lifetimeScale,
        salesPerMonth: recentSales / (Math.max(days, DAYS_PER_MONTH) / DAYS_PER_MONTH),
        priceCents: l.priceCents,
        signals: lifetime[i].signals,
        cap,
        confidence: confidenceOf(reviewCount, lifetime[i].signals),
      }),
      reviewCount,
    }
  })

  // Rank by sales a month over the last year; lifetime sales break ties.
  const order = listings
    .map((_, i) => i)
    .sort(
      (a, b) =>
        estimated[b].estimate.salesPerMonth - estimated[a].estimate.salesPerMonth ||
        estimated[b].estimate.sales - estimated[a].estimate.sales
    )
  const position = new Map(order.map((i, at) => [i, at + 1]))
  const n = listings.length

  // Thresholds for the flags: what a top quarter listing sells, and draws.
  const quarterIndex = Math.max(0, Math.ceil(n / 4) - 1)
  const topLifetime = estimated.map((e) => e.estimate.sales).sort((a, b) => b - a)[quarterIndex] ?? Infinity
  const pace = (l: Listing) => l.favorites / Math.max(l.ageDays, 7)
  const topPace = listings.map(pace).sort((a, b) => b - a)[quarterIndex] ?? Infinity

  const ranked = estimated.map((e, i): Listing => {
    const l = e.listing
    const c = counts.get(l.id) ?? { all: 0, year: 0, quarter: 0 }
    const gained = favoritesGained(l, snapshot, now)
    const { trend, trendFrom } = trendOf(l, c, reviewsComplete, gained)
    const flags: ListingRank["flags"] = []
    if (trend !== null && trend >= 1.5 && e.recentSales >= 1) flags.push("rising")
    if (l.ageDays <= QUARTER_DAYS && pace(l) >= topPace && l.favorites > 0) flags.push("new")
    if (reviewsComplete && c.year === 0 && c.all >= 3 && e.estimate.sales >= topLifetime) flags.push("sleeping")
    const at = position.get(i)!
    return {
      ...l,
      reviewCount: e.reviewCount ?? l.reviewCount,
      estimate: e.estimate,
      rank: {
        position: at,
        of: n,
        tier: tierOf(at, n),
        recentSales: Math.round(e.recentSales),
        trend,
        trendFrom,
        reviews: c,
        favoritesGained: gained,
        flags,
      },
    }
  })

  return {
    listings: ranked,
    calibration: {
      reviewRate,
      favoritesPerSale: rates.favoritesPerSale,
      viewsPerSale: rates.viewsPerSale,
      measured: { reviewRate: measuredRate, attention: measuredAttention },
      reviewsComplete,
      reviews: { all: reviews.length, onListings, year, yearOnListings },
      coveredShare: reviewsComplete && reviews.length >= MIN_REVIEWS ? onListings / reviews.length : null,
      salesLastYear: reviewsComplete && year >= MIN_REVIEWS ? Math.round(year / reviewRate) : null,
      snapshotAt: snapshot?.at ?? null,
    },
  }
}

/** Top 1%, 10% and 25% by position; small shops still get a top listing. */
function tierOf(position: number, n: number): RankTier {
  if (position <= Math.max(1, Math.round(n * 0.01))) return "top1"
  if (position <= Math.ceil(n * 0.1)) return "top10"
  if (position <= Math.ceil(n * 0.25)) return "top25"
  return "rest"
}

/**
 * The last 90 days' pace ÷ the last year's: from the listing's reviews when
 * it has enough of them, else from favorites gained lately against its
 * favorites a day since it was listed. Smoothed, so a single review can't
 * swing it.
 */
function trendOf(
  l: Listing,
  c: { year: number; quarter: number },
  reviewsComplete: boolean,
  gained: ListingRank["favoritesGained"]
): { trend: number | null; trendFrom: ListingRank["trendFrom"] } {
  if (reviewsComplete && c.year >= TREND_REVIEWS) {
    const yearDays = Math.min(Math.max(l.ageDays, 1), YEAR_DAYS)
    const quarterDays = Math.min(Math.max(l.ageDays, 1), QUARTER_DAYS)
    if (yearDays > quarterDays) {
      return { trend: ((c.quarter + 1) / quarterDays) / ((c.year + 1) / yearDays), trendFrom: "reviews" }
    }
  }
  if (gained && l.favorites >= 10 && l.ageDays > QUARTER_DAYS) {
    const lifetimePace = l.favorites / l.ageDays
    return { trend: (gained.perDay + lifetimePace * 0.1) / (lifetimePace * 1.1), trendFrom: "favorites" }
  }
  return { trend: null, trendFrom: null }
}

/** The newest snapshot taken a few days or more before `now`. */
function earlierSnapshot(snapshots: CountSnapshot[], now: number) {
  return (
    snapshots
      .filter((s) => now - Date.parse(s.at) >= SNAPSHOT_MIN_DAYS * DAY_MS)
      .sort((a, b) => b.at.localeCompare(a.at))[0] ?? null
  )
}

function favoritesGained(l: Listing, snapshot: CountSnapshot | null, now: number): ListingRank["favoritesGained"] {
  const before = snapshot?.counts[l.id]
  if (!snapshot || !before) return null
  const days = (now - Date.parse(snapshot.at)) / DAY_MS
  const count = Math.max(l.favorites - before[0], 0)
  return { count, since: snapshot.at, perDay: count / days }
}

/** The factor taking `sum` to `target`; 1 without a target. */
function scaleTo(target: number | null, total: number) {
  return target !== null && total > 0 ? target / total : 1
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function sum<T>(items: T[], by: (item: T) => number) {
  return items.reduce((total, item) => total + by(item), 0)
}
