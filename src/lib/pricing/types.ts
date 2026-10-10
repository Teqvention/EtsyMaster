import { SIZE_KEYS, type SizeKey } from "@/lib/catalog/sizes"

// Price profiles: what each of the twelve sizes costs the buyer, in one
// currency. A shop (upload account) has one; every new listing gets its
// prices, and Artikel can move a shop's listings to another one. Low, mid and
// high are made on first use; any number of custom ones can follow.
// Stored as the "prices" document.

export type PriceTier = "low" | "mid" | "high" | "custom"

export type PriceProfile = {
  id: string
  name: string
  tier: PriceTier
  currency: "EUR"
  /** Cents per size; every size has one. */
  prices: Record<SizeKey, number>
  note?: string
  /** ISO 8601 */
  createdAt: string
  updatedAt: string
}

/** Euro prices of the three starting profiles. Free shipping is in the price. */
export const STARTING_PRICES: Record<Exclude<PriceTier, "custom">, number[]> = {
  //      13x18  A4     27x35  A3     30x40  40x50  A2     45x60  50x70  A1     60x90  70x100
  low: [14.9, 19.9, 21.9, 24.9, 23.9, 29.9, 33.9, 35.9, 38.9, 45.9, 48.9, 52.9],
  mid: [17.9, 24.9, 26.9, 30.9, 28.9, 34.9, 39.9, 41.9, 44.9, 54.9, 57.9, 61.9],
  high: [21.9, 29.9, 32.9, 37.9, 35.9, 44.9, 49.9, 52.9, 56.9, 69.9, 74.9, 79.9],
}

export const TIER_LABEL: Record<PriceTier, string> = { low: "Low", mid: "Mid", high: "High", custom: "Custom" }

export function pricesFromEuros(euros: number[]): Record<SizeKey, number> {
  return Object.fromEntries(SIZE_KEYS.map((key, i) => [key, Math.round(euros[i] * 100)])) as Record<SizeKey, number>
}

/** The lowest price: what Etsy shows on the listing card. */
export const fromPrice = (profile: PriceProfile) => Math.min(...Object.values(profile.prices))

// --- What a sale leaves over ---

/** Where a sale ships to: Gelato's print and shipping cost differ by country. */
export const DESTINATIONS = ["DE", "US", "GB"] as const
export type Destination = (typeof DESTINATIONS)[number]
export const DESTINATION_LABEL: Record<Destination, string> = {
  DE: "Germany",
  US: "United States",
  GB: "United Kingdom",
}

/** The numbers the profit per size is worked out with, as Prices lets them be set. */
export type ProfitAssumptions = {
  destination: Destination
  /** VAT paid on Gelato's invoice and Etsy's fees, counted as cost: 0 where it's reclaimed. */
  costVat: number
  /** VAT inside our price that goes to the tax office: 0 for a small business without VAT. */
  salesVat: number
}

export const DEFAULT_ASSUMPTIONS: ProfitAssumptions = { destination: "DE", costVat: 0.19, salesVat: 0 }

/** One size's cost at Gelato, before VAT, in cents (EUR). */
export type SizeCost = {
  productCents: number
  /** The cheapest shipping to the destination; null when Gelato couldn't be asked. */
  shippingCents: number | null
}

export type GelatoCosts = {
  destination: Destination
  sizes: Record<SizeKey, SizeCost>
  /**
   * live: asked Gelato's price and quote APIs · measured: what Gelato showed
   * as cost on CitysInBlack's products in October 2026, print only.
   */
  source: "live" | "measured"
  /** ISO 8601 */
  at: string
  error?: string
}

/** Euros per US dollar: the listing fee is charged in dollars. */
export type ExchangeRate = { rate: number; date: string | null; source: "ecb" | "fallback" }

// --- The market ---

/** Prices of one size across listings, cents (EUR). */
export type PriceSpread = { count: number; min: number; p25: number; median: number; p75: number; max: number }

export type MarketShop = {
  shopId: number
  name: string
  url: string
  totalSales: number
  activeListings: number
  /** Where the listings came from: the library's best sellers, or the shop's own ranking. */
  source: "library" | "shop"
  /** Listings looked at, and the physical ones among them (downloads left out). */
  sampled: number
  physical: number
  /** The price Etsy shows on each listing: usually its cheapest size. */
  fromPrice: PriceSpread | null
  /** Per size, read from the listings' inventories (needs an Etsy connection). */
  sizes: Partial<Record<SizeKey, PriceSpread>>
  /** Sizes they sell that aren't ours, e.g. "8 x 10 in", with how many listings have them. */
  otherSizes: { label: string; count: number }[]
  /** ISO 8601 */
  at: string
  error?: string
}

export type MarketAnalysis = {
  shops: MarketShop[]
  /** Every shop's listings together. */
  sizes: Partial<Record<SizeKey, PriceSpread>>
  /** Why there are no prices per size, if there aren't. */
  inventoryNote: string | null
  /** ISO 8601 of the last run */
  at: string | null
}

/** Prices the market suggests: each size's median across the strong shops. */
export type MarketSuggestion = {
  prices: Record<SizeKey, number>
  /** Sizes the market had too few prices for, filled in from the mid profile's steps. */
  estimated: SizeKey[]
}

/** GET /api/prices: everything the Prices page shows. */
export type PricesState = {
  profiles: (PriceProfile & { usedBy: string[] })[]
  assumptions: ProfitAssumptions
  costs: GelatoCosts & { refreshing: boolean }
  usd: ExchangeRate
  market: MarketAnalysis & { running: boolean }
  /** Shops the market analysis looks at, by name. */
  marketShops: string[]
  suggestion: MarketSuggestion | null
}
