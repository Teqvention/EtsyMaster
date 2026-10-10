import type { AnalysisPlan } from "@/lib/etsy/analysis"
import type { Listing, ListingShop, ShopReview } from "@/lib/etsy/types"

export type ShopAnalysisSummary = {
  plan: AnalysisPlan
  /** Listings the analysis covered. */
  listings: number
  /** False when the run was stopped or failed part way. */
  complete: boolean
  revenuePerMonthCents: number
  salesPerMonth: number
  /** Top earners, best first. */
  top: { title: string; thumb: string | null }[]
  /** ISO 8601 */
  analysedAt: string
}

/** A shop in the Shops page's list. */
export type ShopVisit = {
  shop: ListingShop
  /** ISO 8601 */
  viewedAt: string
  analysis: ShopAnalysisSummary | null
  /** Names the shop is filed under, as first typed; matched case-insensitively. */
  labels?: string[]
}

export type ShopHistory = Record<number, ShopVisit>

// A shop analysis as it stood when it settled, kept on the server so a shop
// analysed before opens with its listings straight away — in any browser,
// after any restart — and costs no quota until asked to update.

export type StoredAnalysis = {
  shop: ListingShop
  plan: AnalysisPlan
  /** How the run ended; stopped and failed runs keep what they fetched. */
  status: "done" | "stopped" | "error"
  listings: Listing[]
  listingTotal: number | null
  reviews: ShopReview[]
  reviewTotal: number | null
  /** ISO 8601 */
  analysedAt: string
}
