import type { SizeKey } from "@/lib/catalog/sizes"
import type { DailySnapshot, LedgerCategory, SyncedSection, SyncStatus } from "@/lib/sync/types"

// Artikel: every listing of our shops with its numbers over a date range,
// and bulk actions on them. The numbers come from the daily sync; actions go
// to Etsy through a queue that survives restarts and keeps each account's
// quota reserve.

// --- Internal tags: ours only, never on Etsy ---

export const TAG_COLORS = ["gray", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink"] as const
export type TagColor = (typeof TAG_COLORS)[number]

export type InternalTag = { id: string; name: string; color: TagColor }

/** The document "artikel/tags". */
export type TagsFile = {
  tags: InternalTag[]
  /** Listing id → tag ids. */
  assigned: Record<string, string[]>
}

// --- The table ---

export type ArtikelRow = {
  listingId: number
  account: string
  shop: string
  title: string
  state: string
  url: string
  thumb: string | null
  photos: number
  hasVideo: boolean
  currency: string
  priceMin: number
  priceMax: number
  /** Over the range: from the daily snapshots. */
  views: number
  favorites: number
  /** Running totals. */
  viewsTotal: number
  favoritesTotal: number
  /** Units and orders over the range. */
  sales: number
  orders: number
  /** Cents: item and shipping, less discounts and refunds. */
  revenueCents: number
  /** Etsy's fees on the listing in the range (transaction, processing, listing, VAT on them), cents. */
  feesCents: number
  /** Some of the fees are worked out, not booked yet. */
  feesEstimated: boolean
  /** What Gelato charged for its orders, cents. */
  costCents: number
  costEstimated: boolean
  /** Revenue less fees and Gelato, before ads. */
  profitCents: number
  /** The shop's Etsy Ads spend shared out by views: an estimate, Etsy doesn't say per listing. */
  adsEstCents: number
  sectionId: number | null
  section: string | null
  /** Internal tag ids. */
  tags: string[]
  /** Epoch ms */
  endsAt: number | null
  createdAt: number
}

export type ArtikelSummary = {
  currency: string
  /** Rows in another currency are left out of the sums. */
  mixedCurrency: boolean
  listings: number
  active: number
  views: number
  favorites: number
  orders: number
  sales: number
  revenueCents: number
  /** Every Etsy fee in the range except ads (transaction, processing, listing, VAT on fees, labels…). */
  feesCents: number
  /** Etsy Ads and Offsite Ads, from the ledger. */
  adsCents: number
  listingFeesCents: number
  costCents: number
  /** Revenue less fees, ads and Gelato. */
  profitCents: number
  /** Fees or costs that are worked out rather than booked. */
  estimated: boolean
}


export type ArtikelShop = {
  account: string
  label: string
  shop: string
  currency: string
  sections: SyncedSection[]
  listings: number
}

export type ArtikelState = {
  range: { from: string; to: string }
  /**
   * The first daily snapshot: views before it can't be split by day. Views
   * count up to `viewsUntil` (epoch ms): the last sync when the range runs up
   * to it, else the snapshot after the range.
   */
  coverage: { firstSnapshot: string | null; complete: boolean; viewsUntil: number | null }
  shops: ArtikelShop[]
  rows: ArtikelRow[]
  summary: ArtikelSummary
  tags: InternalTag[]
  sync: SyncStatus[]
  /** Price profiles a bulk action can set, cents per size. */
  profiles: { id: string; name: string; currency: string; prices: Record<SizeKey, number> }[]
}

/** One listing in depth: day by day, its orders and fees. */
export type ArtikelDetail = {
  row: ArtikelRow
  variants: { productId: number; sizeKey: SizeKey | null; label: string; priceCents: number }[]
  images: { id: number; url: string; fullUrl: string }[]
  tagsOnEtsy: string[]
  days: { date: string; views: number; favorites: number; orders: number; revenueCents: number }[]
  orders: { receiptId: number; at: number; title: string; size: string | null; quantity: number; revenueCents: number; status: string; country: string | null; costCents: number | null }[]
  /** Fees booked on the range's sales and listing fees, by kind. */
  fees: { category: LedgerCategory; cents: number }[]
  /** Fees on the range's sales not booked yet, worked out at Etsy's rates. */
  feesEstimatedCents: number
  /** The pipeline item that made it: only those can have a photo swapped. */
  pipeline: { itemId: string; chainId: string | null } | null
}

export type SnapshotPair = { base: DailySnapshot | null; end: DailySnapshot | null }

// --- Bulk actions ---

export type Rounding = "none" | "90" | "95" | "99"

export type PriceChange =
  | { kind: "price"; mode: "percent" | "amount"; /** Percent, or cents. */ value: number; rounding: Rounding }
  | { kind: "profile"; profileId: string }

export type ActionParams =
  | PriceChange
  | { kind: "section"; /** Matched by name in each shop; made where it's missing. */ title: string }
  | { kind: "state"; state: "active" | "inactive" }
  | { kind: "swapPhoto"; /** 1 is the thumbnail. */ rank: number; sceneId: string }
  | { kind: "reorderPhotos"; /** Current ranks in their new order; the rest follow as they were. */ order: number[] }

export type ActionKind = ActionParams["kind"]

/** Which listings an action is for; resolved to listing ids when it's made. */
export type ActionTarget =
  | { kind: "listings"; ids: number[] }
  | { kind: "shop"; account: string }
  | { kind: "all" }
  | { kind: "tag"; tagId: string }
  | { kind: "section"; account: string; sectionId: number }

export type ItemStatus = "queued" | "running" | "done" | "failed" | "skipped"

export type ActionItem = {
  listingId: number
  account: string
  title: string
  status: ItemStatus
  /** What's to be set, worked out when the action was made: running it twice changes nothing more. */
  plan?: {
    /** Product id → price, cents. */
    prices?: Record<string, number>
    /** Product id → price before, cents, as the preview showed it. */
    before?: Record<string, number>
    /** Size → price, cents: for products added since the sync. */
    sizePrices?: Partial<Record<SizeKey, number>>
    /** Image ids in their new order. */
    imageIds?: number[]
  }
  /** The outcome in words, e.g. "€24.90 → €26.90". */
  result?: string
  error?: string
  /** Epoch ms */
  at?: number
}

export type ActionStatus = "queued" | "running" | "paused" | "done" | "cancelled"

export type BulkAction = {
  id: string
  params: ActionParams
  /** In words, e.g. "Price +10 %, ending .90". */
  label: string
  target: string
  status: ActionStatus
  /** Why it waits, e.g. quota. */
  note?: string
  /** Epoch ms it tries again while paused for quota. */
  wakeAt?: number
  items: ActionItem[]
  /** Section id per account once found or made (section actions). */
  sectionIds?: Record<string, number>
  createdAt: number
  updatedAt: number
  finishedAt?: number
}

/** An action as the page lists it: counts instead of every item. */
export type ActionView = Omit<BulkAction, "items"> & {
  counts: Record<ItemStatus, number>
  total: number
  /** The latest finished items, newest first, for the progress list. */
  recent: ActionItem[]
  /** Failed items, for a look at why. */
  failed: ActionItem[]
  /** Why listings were left out, with how many each. */
  skips: { reason: string; count: number }[]
}

/** One listing's change in a preview. */
export type PreviewRow = {
  listingId: number
  account: string
  title: string
  thumb: string | null
  /** Price changes: per size, old → new. */
  prices?: { label: string; before: number; after: number }[]
  currency?: string
  /** Why it won't change, if it won't. */
  skip?: string
  /** Other kinds: what changes, in words. */
  change?: string
}

export type ActionPreview = {
  label: string
  /** The listings, changes first; long lists are cut (`changes + skipped` counts them all). */
  rows: PreviewRow[]
  changes: number
  skipped: number
  /** Etsy requests the action will take. */
  requests: number
  /** Shops among the targets that can't take changes yet, e.g. "CitysInBlack: Not connected to Etsy". */
  blocked: string[]
}

// Routes (src/app/api/artikel):
//   GET    /api/artikel?account&from&to          → ArtikelState (YYYY-MM-DD; the last 30 days by default)
//   GET    /api/artikel/listings/[id]?from&to    → ArtikelDetail
//   GET    /api/artikel/tags                     → TagsFile
//   POST   /api/artikel/tags                     { name, color? } → TagsFile
//   PATCH  /api/artikel/tags/[id]                { name?, color? } → TagsFile
//   DELETE /api/artikel/tags/[id]                → TagsFile
//   POST   /api/artikel/tags/assign              { listingIds, add?, remove? } → TagsFile
//   GET    /api/artikel/actions                  → ActionView[] (newest first)
//   POST   /api/artikel/actions                  { params, target } → ActionView[]
//   POST   /api/artikel/actions/preview          { params, target } → ActionPreview (asks Etsy nothing)
//   PATCH  /api/artikel/actions/[id]             { status?: "paused" | "running" | "cancelled", retry?: true } → ActionView[]
//   DELETE /api/artikel/actions/[id]             a finished, cancelled or paused action → ActionView[]
