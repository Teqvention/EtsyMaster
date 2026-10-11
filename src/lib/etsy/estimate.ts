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
// them: favorites, views and reviews. Favorites and views are attention, and
// they rank a shop's sellers best (a backtest on 37 shops, Oct 2026: the top
// tenth by favorites and views a month made 63% of the next year's sales,
// against 45% for the top tenth by reviews alone). They are turned into
// sales with a ratio each and mixed in log space, favorites weighing 70%.
//
// Reviews are actual buyers, but few: most listings have none, and at one
// review per eleven sales a single review is noise. So reviews only take over
// as they add up: they weigh r / (r + 6) against the attention, about 14% at
// one review, half at six, 83% at thirty. No reviews is no evidence, not
// evidence of no sales.
//
// The ratios are the medians of 95 shops with every review and visible sales
// (Oct 2026): 9% of buyers leave a review, and a sale comes with about 10
// favorites and 100 views. A shop analysis measures them for the shop instead
// (see `calibrate.ts`). Treat every output as an order of magnitude.

/** Typical rates, for listings seen without their shop's. */
export const TYPICAL = {
  /** Share of buyers who leave a review. */
  reviewRate: 0.09,
  /** Favorites per sale (lifetime). */
  favoritesPerSale: 10,
  /** Listing views per sale (lifetime). */
  viewsPerSale: 100,
} as const

export type Rates = { reviewRate: number; favoritesPerSale: number; viewsPerSale: number }

/** Favorites' share of the attention; views have the rest. */
const FAVORITES_SHARE = 0.7
/** Reviews weigh r / (r + REVIEW_HALF): half at this many. */
const REVIEW_HALF = 6

const DAYS_PER_MONTH = 30

// Heat maps sales/month onto 0–100 between these, on a log scale:
// 0.1/mo (one sale a year) is cold, 300/mo (ten a day) is as hot as it gets.
const HEAT_MIN = Math.log10(0.1)
const HEAT_MAX = Math.log10(300)

/** How much `reviews` count against the attention: 0 for none, near 1 for many. */
export const reviewWeight = (reviews: number) => reviews / (reviews + REVIEW_HALF)

type Signal = { source: SignalSource; sales: number; weight: number; per: number }

/**
 * Lifetime sales its favorites, views and reviews point to, blended as above;
 * `reviews` null when not known. Each signal comes with its share of the blend.
 */
export function blendSales(
  input: { favorites: number; views: number; reviews: number | null },
  rates: Rates
): { sales: number; signals: Signal[] } {
  const reviewShare = input.reviews === null ? 0 : reviewWeight(input.reviews)
  // Etsy omits `views` on some listings; 0 there means "unknown", not "none".
  const hasViews = input.views > 0
  const favoritesShare = (1 - reviewShare) * (hasViews ? FAVORITES_SHARE : 1)
  const signals: Signal[] = [
    {
      source: "favorites",
      sales: input.favorites / rates.favoritesPerSale,
      weight: favoritesShare,
      per: rates.favoritesPerSale,
    },
  ]
  if (hasViews) {
    signals.push({
      source: "views",
      sales: input.views / rates.viewsPerSale,
      weight: (1 - reviewShare) * (1 - FAVORITES_SHARE),
      per: rates.viewsPerSale,
    })
  }
  if (input.reviews !== null) {
    signals.unshift({ source: "reviews", sales: input.reviews / rates.reviewRate, weight: reviewShare, per: rates.reviewRate })
  }
  const mixed = signals.reduce((total, s) => total + s.weight * Math.log1p(s.sales), 0)
  return { sales: Math.expm1(mixed), signals }
}

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

export function estimateSales(input: EstimateInput, rates: Rates = TYPICAL): SalesEstimate {
  const { sales: blended, signals } = blendSales(
    { favorites: input.favorites, views: input.views, reviews: input.reviewCount },
    rates
  )
  const months = Math.max(input.ageDays, DAYS_PER_MONTH) / DAYS_PER_MONTH
  return toEstimate({
    sales: blended,
    salesPerMonth: blended / months,
    priceCents: input.priceCents,
    signals,
    cap: input.shopTotalSales,
    confidence: confidenceOf(input.reviewCount, signals),
  })
}

/** An estimate from lifetime sales and a pace, in the shape the app shows. */
export function toEstimate({
  sales,
  salesPerMonth,
  priceCents,
  signals,
  cap,
  confidence,
}: {
  sales: number
  salesPerMonth: number
  priceCents: number
  signals: Signal[]
  cap: number | null
  confidence: Confidence
}): SalesEstimate {
  const clamp = (n: number) => Math.min(Math.max(n, 0), cap ?? Infinity)
  const lifetime = clamp(sales)
  const values = signals.filter((s) => s.weight > 0).map((s) => clamp(s.sales))
  return {
    sales: Math.round(lifetime),
    salesLow: Math.round(Math.min(lifetime, ...values)),
    salesHigh: Math.round(Math.max(lifetime, ...values)),
    revenueCents: Math.round(lifetime) * priceCents,
    salesPerMonth,
    revenuePerMonthCents: Math.round(salesPerMonth * priceCents),
    heat: heatOf(salesPerMonth),
    confidence,
    signals: signals.map((s) => ({ source: s.source, sales: Math.round(s.sales), weight: s.weight, per: s.per })),
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

export function heatOf(salesPerMonth: number) {
  if (salesPerMonth <= 0) return 0
  const t = (Math.log10(salesPerMonth) - HEAT_MIN) / (HEAT_MAX - HEAT_MIN)
  return Math.round(Math.min(Math.max(t, 0), 1) * 100)
}

// Reviews decide it once there are enough of them; without, favorites and
// views agreeing within 3× is the best it gets.
export function confidenceOf(reviews: number | null, signals: Signal[]): Confidence {
  if (reviews !== null && reviews >= 10) return "high"
  const attention = signals.filter((s) => s.source !== "reviews")
  const spread =
    attention.length > 1
      ? Math.abs(Math.log10(1 + attention[0].sales) - Math.log10(1 + attention[1].sales))
      : Infinity
  if ((reviews !== null && reviews >= 3) || spread < 0.5) return "medium"
  return "low"
}
