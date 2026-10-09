import type { AnalysisPlan } from "@/lib/etsy/analysis"
import type { Listing, ListingShop, ShopReview } from "@/lib/etsy/types"

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
