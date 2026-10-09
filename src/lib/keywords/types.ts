import type { Listing } from "@/lib/etsy/types"

// The keyword library: every listing of the shops added to it, reduced to
// what its keywords say — title, tags and how well it sells. Aggregated into
// tag and title-phrase statistics on the Keywords page, and handed to the
// upload pipeline so our own titles and tags learn from what sells.
// Stored as data/keywords/library.json.

export type LibraryListing = {
  id: number
  title: string
  tags: string[]
  salesPerMonth: number
  revenuePerMonthCents: number
  favorites: number
  views: number
  priceCents: number
  url: string
  thumb: string | null
  /** In the top fifth of its shop by sales per month. */
  top: boolean
}

export type LibraryShop = {
  id: number
  name: string
  url: string
  iconUrl: string | null
  totalSales: number
  activeListings: number
  /** ISO 8601 */
  addedAt: string
  updatedAt: string
  listings: LibraryListing[]
}

export type LibraryShopSummary = Omit<LibraryShop, "listings"> & {
  listings: number
  topSellers: number
  salesPerMonth: number
}

/** A tag, or a phrase from titles, with how the listings using it sell. */
export type KeywordInsight = {
  keyword: string
  kind: "tag" | "phrase"
  /** Listings using it. */
  listings: number
  /** Shops using it. */
  shops: number
  /** Estimated sales per month of the listings using it, summed. */
  salesPerMonth: number
  avgSalesPerMonth: number
  /** 0–1: share of those listings that are top sellers in their shop. */
  topShare: number
  /** 0–100, relative to the best keyword of its kind. */
  score: number
}

/** What Gemini read out of the library. */
export type KeywordAnalysis = {
  summary: string
  winningPatterns: { title: string; detail: string; examples: string[] }[]
  titleStructures: { pattern: string; why: string; example: string }[]
  tagStrategies: { strategy: string; detail: string; tags: string[] }[]
  gaps: { opportunity: string; detail: string; keywords: string[] }[]
  avoid: { pattern: string; why: string }[]
}

export type LibraryAnalysis = {
  insights: KeywordAnalysis
  /** ISO 8601 */
  createdAt: string
  /** The library it was made from, to tell when it's out of date. */
  basis: { shops: number; listings: number }
}

export type LibraryStats = { shops: number; listings: number; keywords: number }

export type LibraryOverview = {
  stats: LibraryStats
  shops: LibraryShopSummary[]
  /** Across every listing in the library. */
  averageSalesPerMonth: number
  tags: KeywordInsight[]
  phrases: KeywordInsight[]
  analysis: LibraryAnalysis | null
}

/** A listing using a keyword, for the Keywords page's drill-down. */
export type KeywordListing = Omit<LibraryListing, "tags" | "favorites" | "views"> & { shop: string }

/** What the browser sends when a shop is added: its analysed listings. */
export type LibraryShopRequest = {
  shop: Omit<LibraryShop, "addedAt" | "updatedAt" | "listings">
  listings: Omit<LibraryListing, "top">[]
}

export function toLibraryRequest(
  shop: { id: number; name: string; url: string; iconUrl: string | null; totalSales: number; activeListings: number },
  listings: Listing[]
): LibraryShopRequest {
  return {
    shop: {
      id: shop.id,
      name: shop.name,
      url: shop.url,
      iconUrl: shop.iconUrl,
      totalSales: shop.totalSales,
      activeListings: shop.activeListings,
    },
    listings: listings.map((l) => ({
      id: l.id,
      title: l.title,
      tags: l.tags,
      salesPerMonth: l.estimate.salesPerMonth,
      revenuePerMonthCents: l.estimate.revenuePerMonthCents,
      favorites: l.favorites,
      views: l.views,
      priceCents: l.priceCents,
      url: l.url,
      thumb: l.images[0]?.medium ?? l.images[0]?.thumb ?? null,
    })),
  }
}
