import type { AnalysisPlan } from "@/lib/etsy/analysis"
import type { CountSnapshot, Listing, ListingShop, ShopReview } from "@/lib/etsy/types"
import type { Tag } from "@/lib/tags"

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

/**
 * What a shop is filed under: a primary tag ("City") and the secondary tags
 * that narrow it down ("Cartoon", "Funky"), as first typed; matched
 * case-insensitively. A shop can carry several (see `lib/tags.ts`).
 */
export type ShopTag = Tag

/** A shop in the Shops page's list. */
export type ShopVisit = {
  shop: ListingShop
  /** ISO 8601 */
  viewedAt: string
  analysis: ShopAnalysisSummary | null
  /** The first primary tag, where versions before several were possible read it. */
  tag?: ShopTag
  /** Every primary tag, `tag` first; read through `tagsOf`, which settles where the two disagree. */
  tags?: ShopTag[]
  /** ISO 8601: when the tag was last set or taken off; the later one wins where copies meet. */
  tagChangedAt?: string
  /** Flat labels from before tags had a primary one: read into `tag` when loaded. */
  labels?: string[]
  /** ISO 8601, while the shop is liked. */
  likedAt?: string
  /** ISO 8601: when it was last liked or unliked. */
  likeChangedAt?: string
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
  /** ISO 8601: every review in the window up to then is held (absent before this was kept). */
  reviewsAt?: string | null
  /** ISO 8601 */
  analysedAt: string
  /** Favorites and views at earlier analyses, oldest first: what was gained since. Kept by the server. */
  snapshots?: CountSnapshot[]
}
