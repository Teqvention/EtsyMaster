import type {
  Confidence,
  Listing,
  ListingShop,
  SalesEstimate,
  SignalSource,
} from "./types"

// DIY sales estimate for a listing we don't own.
//
// Etsy publishes no per-listing sales, but three public counters move with
// them: reviews, favorites, and views. Each one is turned into a sales guess
// with a conversion ratio, and the guesses are blended in log space (a
// weighted geometric mean), because the signals disagree by multiples, not by
// a few units. How far apart they land is reported as the range and the
// confidence.
//
// The ratios were calibrated on a sample of live search results (Oct 2026):
// across listings with reviews, the median was ~90 favorites and ~2,400 views
// per review. With roughly one buyer in seven leaving a review, that is about
// one sale per 14 favorites and per 360 views. Treat every output as an order
// of magnitude, not a number.

/** Share of buyers who leave a review. */
const REVIEW_RATE = 0.15
/** Favorites per sale. */
const FAVORITES_PER_SALE = 14
/** Views per sale (listing page views, lifetime). */
const VIEWS_PER_SALE = 360

/** Reviews are actual buyers, so they count most when we have them. */
const WEIGHTS = { reviews: 3, favorites: 2, views: 2 } as const

const DAYS_PER_MONTH = 30

// Heat maps sales/month onto 0–100 between these, on a log scale:
// 0.1/mo (one sale a year) is cold, 300/mo (ten a day) is as hot as it gets.
const HEAT_MIN = Math.log10(0.1)
const HEAT_MAX = Math.log10(300)

export type EstimateInput = {
  priceCents: number
  favorites: number
  views: number
  /** Null when not fetched yet. */
  reviewCount: number | null
  ageDays: number
  /** Lifetime sales of the whole shop; one listing can't outsell it. */
  shopTotalSales: number | null
}

export function estimateSales(input: EstimateInput): SalesEstimate {
  const signals: { source: SignalSource; sales: number }[] = []

  if (input.reviewCount !== null) {
    signals.push({ source: "reviews", sales: input.reviewCount / REVIEW_RATE })
  }
  signals.push({ source: "favorites", sales: input.favorites / FAVORITES_PER_SALE })
  // Etsy omits `views` on some listings; 0 there means "unknown", not "none".
  if (input.views > 0) {
    signals.push({ source: "views", sales: input.views / VIEWS_PER_SALE })
  }

  let weighted = 0
  let totalWeight = 0
  for (const { source, sales } of signals) {
    weighted += WEIGHTS[source] * Math.log1p(sales)
    totalWeight += WEIGHTS[source]
  }

  const cap = input.shopTotalSales ?? Infinity
  const clamp = (n: number) => Math.min(Math.max(n, 0), cap)

  const sales = clamp(Math.expm1(weighted / totalWeight))
  const values = signals.map((s) => clamp(s.sales))
  const salesLow = Math.min(sales, ...values)
  const salesHigh = Math.max(sales, ...values)

  const months = Math.max(input.ageDays, DAYS_PER_MONTH) / DAYS_PER_MONTH
  const salesPerMonth = sales / months

  return {
    sales: Math.round(sales),
    salesLow: Math.round(salesLow),
    salesHigh: Math.round(salesHigh),
    revenueCents: Math.round(sales) * input.priceCents,
    salesPerMonth,
    revenuePerMonthCents: Math.round(salesPerMonth * input.priceCents),
    heat: heatOf(salesPerMonth),
    confidence: confidenceOf(signals, salesLow, salesHigh),
    signals: signals.map((s) => ({ source: s.source, sales: Math.round(s.sales) })),
  }
}

// A shop reporting 0 lifetime sales has usually hidden its sales count rather
// than sold nothing, so 0 means "no cap", not "cap at zero".
export function shopSalesCap(shop: ListingShop | null) {
  return shop?.totalSales || null
}

/** The listing with its review count known, and the estimate redone with it. */
export function withReviewCount(listing: Listing, reviewCount: number): Listing {
  return {
    ...listing,
    reviewCount,
    estimate: estimateSales({
      priceCents: listing.priceCents,
      favorites: listing.favorites,
      views: listing.views,
      reviewCount,
      ageDays: listing.ageDays,
      shopTotalSales: shopSalesCap(listing.shop),
    }),
  }
}

function heatOf(salesPerMonth: number) {
  if (salesPerMonth <= 0) return 0
  const t = (Math.log10(salesPerMonth) - HEAT_MIN) / (HEAT_MAX - HEAT_MIN)
  return Math.round(Math.min(Math.max(t, 0), 1) * 100)
}

// Agreement between signals, in orders of magnitude. Without reviews we never
// claim "high": favorites and views are both attention, not purchases.
function confidenceOf(
  signals: { source: SignalSource }[],
  low: number,
  high: number
): Confidence {
  if (signals.length < 2) return "low"
  const spread = Math.log10(1 + high) - Math.log10(1 + low)
  const hasReviews = signals.some((s) => s.source === "reviews")
  if (spread < 0.5 && hasReviews) return "high"
  if (spread < 1) return "medium"
  return "low"
}
