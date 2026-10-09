// Shapes the dashboard renders. They are deliberately smaller than the
// Etsy Open API v3 payloads (ShopReceipt, ShopListing, ...) so the UI does not
// depend on the API's wire format — map API responses into these in `data.ts`.

export type OrderStatus = "paid" | "shipped" | "completed" | "canceled"

export type Order = {
  /** Etsy `receipt_id` */
  id: number
  buyerName: string
  country: string
  itemCount: number
  /** Grand total in the shop currency's minor unit (cents). */
  totalCents: number
  status: OrderStatus
  /** ISO 8601 */
  createdAt: string
  /** ISO 8601 */
  shipBy: string
}

export type DailyStat = {
  /** YYYY-MM-DD */
  date: string
  revenueCents: number
  orders: number
  visits: number
}

export type Shop = {
  name: string
  ownerName: string
  ownerEmail: string
  currency: string
}

export type Metric = {
  value: number
  /** Change vs. the previous period of equal length, as a fraction (0.12 = +12%). */
  change: number
}

export type ShopSummary = {
  periodDays: number
  revenueCents: Metric
  orders: Metric
  visits: Metric
  /** Orders / visits, as a fraction. */
  conversionRate: Metric
}

// --- Market research (other shops' listings, via the public search API) ---

/** The seller behind a listing, as far as the public API reveals it. */
export type ListingShop = {
  id: number
  name: string
  url: string
  iconUrl: string | null
  /** Lifetime sales across every listing in the shop (Etsy `transaction_sold_count`). */
  totalSales: number
  activeListings: number
  favorites: number
  /** Reviews in the past year, and their average (0–5). */
  reviewCount: number
  reviewAverage: number
  country: string | null
  /** ISO 8601 */
  openedAt: string
}

export type Confidence = "low" | "medium" | "high"

/**
 * Our own guess at how a listing sells. Etsy does not expose per-listing sales,
 * so this is fuzzy math over public signals — see `estimate.ts` for the model.
 */
export type SalesEstimate = {
  /** Lifetime units sold, best guess. */
  sales: number
  /** Plausible range — the spread between the individual signals. */
  salesLow: number
  salesHigh: number
  /** Lifetime sales × current price, in display-currency cents. */
  revenueCents: number
  /** Average units per 30 days since the listing was first created. */
  salesPerMonth: number
  revenuePerMonthCents: number
  /** 0–100 on a log scale of sales per month; drives the heat ramp. */
  heat: number
  confidence: Confidence
  /** What each public counter implies on its own, before blending. */
  signals: { source: SignalSource; sales: number }[]
}

export type SignalSource = "reviews" | "favorites" | "views"

export type Listing = {
  /** Etsy `listing_id` */
  id: number
  title: string
  url: string
  /** In display-currency cents (converted by Etsy when the shop prices differently). */
  priceCents: number
  currency: string
  /** Seller-currency price, when it differs from the display currency. */
  originalPrice: { cents: number; currency: string } | null
  images: { thumb: string; medium: string; full: string }[]
  /** Average colour of the primary image, as a placeholder while it loads. */
  color: string | null
  favorites: number
  views: number
  /** Listing reviews. Costs one extra request, so only known once opened. */
  reviewCount: number | null
  quantity: number
  tags: string[]
  materials: string[]
  isPersonalizable: boolean
  isDigital: boolean
  /** ISO 8601 — first published, survives renewals. */
  createdAt: string
  /** ISO 8601 — last edit. */
  updatedAt: string
  ageDays: number
  shopId: number
  /** Null if Etsy didn't return the shop alongside the listing. */
  shop: ListingShop | null
  estimate: SalesEstimate
}

export type ListingSort = "score" | "sales" | "created" | "price-asc" | "price-desc"

export type ListingQuery = {
  keywords: string
  sort: ListingSort
  /** Etsy buyer taxonomy node id. */
  categoryId?: number
  /** Whole display-currency units, as the search API expects. */
  minPrice?: number
  maxPrice?: number
  shopLocation?: string
}

export type ListingPage = {
  listings: Listing[]
  /** Total matches Etsy reports for the query. */
  total: number
  /** Offset for the next page, or null at the end. */
  nextOffset: number | null
}

export type Category = { id: number; name: string }

// --- Shop analysis ---

/** Order a shop's active listings are fetched in, which decides the sample. */
export type ShopListingSort = "created" | "updated" | "price-desc" | "score"

/** A buyer review, reduced to what the analysis counts. */
export type ShopReview = {
  listingId: number
  rating: number
  /** Unix ms */
  createdAt: number
}

export type ShopReviewPage = {
  reviews: ShopReview[]
  /** Total reviews Etsy reports for the window. */
  total: number
  nextOffset: number | null
}
