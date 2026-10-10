import type { SizeKey } from "@/lib/catalog/sizes"

// Our own shops' numbers, pulled from Etsy and Gelato once a day (and on
// demand): every listing with its counters, a daily snapshot of the counters
// (views and favourites only exist as running totals, so a day's views are
// the difference between two snapshots), sales, the payment ledger (every fee
// Etsy charged, Etsy Ads included) and Gelato's production costs. Read by
// Artikel and Performance. Stored as documents under sync/<account>/.
//
// What Etsy's API doesn't give at all: visits and conversion from Shop Stats,
// Etsy Ads clicks and impressions, and ad spend per listing (the ledger has
// the shop's daily ad charge only).

export type SyncedListing = {
  listingId: number
  account: string
  shopId: number
  title: string
  state: "active" | "inactive" | "draft" | "sold_out" | "expired" | string
  url: string
  /** Lowest variant price, cents. */
  priceCents: number
  currency: string
  /** Running totals, as of the last sync. */
  views: number
  favorites: number
  tags: string[]
  sectionId: number | null
  /** Photo URLs (570xN) in listing order, with Etsy's image ids. */
  images: { id: number; url: string; fullUrl: string }[]
  hasVideo: boolean
  /** Variants: size, price, Etsy product id. */
  variants: { productId: number; sizeKey: SizeKey | null; label: string; priceCents: number }[]
  /** Epoch ms */
  createdAt: number
  updatedAt: number
  /** Epoch ms the listing fee runs out (four months after it was made or renewed). */
  endsAt: number | null
}

/** One day's running totals per listing: the document sync/<account>/daily/<YYYY-MM-DD>. */
export type DailySnapshot = {
  date: string
  /** Epoch ms the snapshot was taken. */
  at: number
  listings: Record<string, { views: number; favorites: number; state: string; priceCents: number }>
}

export type Sale = {
  account: string
  receiptId: number
  transactionId: number
  listingId: number
  productId: number | null
  sizeKey: SizeKey | null
  title: string
  quantity: number
  /** Item price × quantity, cents, what the buyer paid for the item before discounts. */
  amountCents: number
  /** Shipping the buyer paid on this transaction, cents. */
  shippingCents: number
  /** The receipt's discount share on this transaction, cents. */
  discountCents: number
  currency: string
  country: string | null
  /** Epoch ms */
  createdAt: number
  status: string
  /** The receipt's refunds, this transaction's share, cents. */
  refundCents?: number
}

/** Receipt states that earned nothing: the money went back or never came. */
export const VOID_SALE = ["canceled", "fully refunded"]

/** What a sale brought in, cents: item and shipping, less discount and refunds; 0 when void. */
export const saleRevenue = (sale: Sale) =>
  VOID_SALE.includes(sale.status)
    ? 0
    : sale.amountCents + sale.shippingCents - sale.discountCents - (sale.refundCents ?? 0)

/**
 * Fee categories, from the ledger's `ledger_type`/`description`:
 * listing (incl. renewals), transaction (6.5 %), processing (payment
 * processing), ads (Etsy Ads), offsite_ads, shipping_label, vat (VAT on
 * seller fees), subscription (Etsy Plus), setup (shop opening), other_fee;
 * sale (money in), refund, payout (money moved to the bank), other.
 */
export type LedgerCategory =
  | "listing"
  | "transaction"
  | "processing"
  | "ads"
  | "offsite_ads"
  | "shipping_label"
  | "vat"
  | "subscription"
  | "setup"
  | "other_fee"
  | "sale"
  | "refund"
  | "payout"
  | "other"

export type LedgerEntry = {
  account: string
  entryId: number
  /** Signed cents as Etsy books them: fees negative, sales positive. */
  amountCents: number
  currency: string
  description: string
  ledgerType: string
  referenceType: string | null
  referenceId: string | null
  /** The order (receipt id) an entry that points at a payment belongs to, e.g. a processing fee; looked up from Etsy's payments. */
  receiptId?: string
  category: LedgerCategory
  /** Epoch ms */
  createdAt: number
}

/** What Gelato charged for one order (production plus shipping, VAT included). */
export type ProductionCost = {
  account: string
  storeId: string
  orderId: string
  /** Etsy receipt id the order came from. */
  receiptId: string
  totalCents: number
  currency: string
  status: string
  /** Epoch ms */
  createdAt: number
}

export type SyncStatus = {
  account: string
  /** Epoch ms of the last finished sync per part. */
  listings: number | null
  sales: number | null
  ledger: number | null
  costs: number | null
  running: boolean
  error?: string
  /** The account's name and shop, for lists. */
  label?: string
  shopName?: string | null
  /** Why the account can't sync (no shop, no Etsy connection); absent when it can. */
  blocked?: string
  /** What a running sync is at, e.g. "Listings 300 of 1,148". */
  step?: string
  /** Epoch ms the next scheduled sync is due, while the schedule runs. */
  nextAt?: number | null
}

/** A shop section as the last sync read it. */
export type SyncedSection = { id: number; title: string; count: number }

export const SYNC_PARTS = ["listings", "sales", "ledger", "costs"] as const
export type SyncPart = (typeof SYNC_PARTS)[number]

/** Ledger categories that are fees (money Etsy kept), as opposed to sales, refunds and payouts. */
export const FEE_CATEGORIES: LedgerCategory[] = [
  "listing",
  "transaction",
  "processing",
  "ads",
  "offsite_ads",
  "shipping_label",
  "vat",
  "subscription",
  "setup",
  "other_fee",
]

// lib/sync/store.ts exports (for Artikel and Performance):
//   listings(account?: string): Promise<SyncedListing[]>
//   snapshots(account: string, from: string, to: string): Promise<DailySnapshot[]>   (YYYY-MM-DD, inclusive)
//   sales(from?: number, to?: number, account?: string): Promise<Sale[]>             (epoch ms)
//   ledger(from?: number, to?: number, account?: string): Promise<LedgerEntry[]>
//   costs(from?: number, to?: number, account?: string): Promise<ProductionCost[]>
//   syncStatus(): Promise<SyncStatus[]>
//   sections(account: string): Promise<SyncedSection[]>
//   dayKey(ms?: number): string   (local YYYY-MM-DD, the key of daily snapshots)
//   patchListing(account, listingId, change): Promise<void>   (keeps the local copy current after a change on Etsy)
// lib/sync/run.ts:
//   syncAccount(account: string, parts?: SyncPart[]): Promise<void>
//   syncAll(): Promise<void>
//   startSync(): void   (daily schedule, from instrumentation; also resumes Artikel's queued bulk actions)
// Routes: GET /api/sync → SyncStatus[] · POST /api/sync { account? } starts a sync → SyncStatus[]
