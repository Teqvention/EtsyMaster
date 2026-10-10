import type { SizeKey } from "@/lib/catalog/sizes"
import type { SyncStatus } from "@/lib/sync/types"

// What the shops earn and spend, from the synced sales, Etsy's payment ledger
// and Gelato's production costs: per day, week or month of a range, for one
// shop or all of them. Money is in euros (cents), whatever the shop's currency.
//
// Listing fees are paid up front for four months of being listed, so a big
// upload day would read as a loss on that day and as free listing after. The
// range figures spread each fee over the days it pays for ("time share"); the
// all-time profit counts them when they were paid, since that money is gone.

export const RANGES = ["week", "month", "30d", "90d", "year", "all"] as const
export type RangeKey = (typeof RANGES)[number]

export const RANGE_LABEL: Record<RangeKey, string> = {
  week: "Week",
  month: "Month",
  "30d": "30 days",
  "90d": "90 days",
  year: "Year",
  all: "All time",
}

export const GRAINS = ["day", "week", "month"] as const
export type Grain = (typeof GRAINS)[number]

export type PerformanceQuery = {
  /** An account id, or "all". */
  account: string
  range: RangeKey
  /** 0 for the current period, -1 for the one before… */
  offset: number
  /** Bucket size; the range's own default when absent. */
  by?: Grain
}

/** Where money goes: Gelato's production, and Etsy's fees by kind (lib/sync's fee categories). */
export type ExpenseKey =
  | "production"
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

export const EXPENSE_LABEL: Record<ExpenseKey, string> = {
  production: "Gelato production",
  listing: "Listing fees",
  transaction: "Transaction fees",
  processing: "Payment processing",
  ads: "Etsy Ads",
  offsite_ads: "Offsite Ads",
  shipping_label: "Shipping labels",
  vat: "VAT on fees",
  subscription: "Etsy Plus",
  setup: "Shop setup",
  other_fee: "Other fees",
}

export type Totals = {
  /** Items and shipping, less discounts and refunds. */
  revenueCents: number
  expensesCents: number
  profitCents: number
  orders: number
  items: number
  /** Etsy Ads and Offsite Ads. */
  adsCents: number
}

export type Bucket = Totals & {
  /** First day, YYYY-MM-DD. */
  start: string
  /** Hasn't begun yet: drawn empty. */
  future: boolean
  expenses: Partial<Record<ExpenseKey, number>>
  /** Listing views, from the daily snapshots; null where there are none. */
  views: number | null
}

export type BestSeller = {
  listingId: number
  account: string
  title: string
  url: string | null
  image: string | null
  orders: number
  items: number
  revenueCents: number
  /** Gelato's cost of the orders, matched by receipt. */
  productionCents: number
  /** Revenue less Etsy's sale fees (at the range's rate) and production. */
  leftCents: number
  /** The size sold most. */
  topSize: SizeKey | null
}

export type PerformanceReport = {
  /** no-shop: no account has an Etsy shop · no-sync: nothing synced yet. */
  state: "ok" | "no-shop" | "no-sync"
  /** Every account with a shop, for the shop picker. */
  accounts: { id: string; label: string; shopName: string | null }[]
  /** The account shown, or "all". */
  account: string
  range: {
    key: RangeKey
    offset: number
    /** YYYY-MM-DD, inclusive; `to` can lie ahead in the current period. */
    from: string
    to: string
    today: string
    by: Grain
    /** "Oct 6 – 12", "October 2026", "Since Mar 3, 2025". */
    label: string
    /** What `previous` covers, in words: "the same days of September". */
    previousLabel: string | null
  }
  /** Profit: all time when paid, this month and this week by time share. */
  headline: { allTimeCents: number; monthCents: number; weekCents: number }
  totals: Totals
  /** The period before, as far into it as this one has got; null for all time. */
  previous: Totals | null
  buckets: Bucket[]
  /** The range's expenses by kind, biggest first. */
  expenses: { key: ExpenseKey; cents: number }[]
  bestSellers: BestSeller[]
  listings: {
    /** Active now. */
    live: number
    /** Made within the range. */
    added: number
    /** Active, and their four months run out within two weeks: renewal fees ahead. */
    expiring: number
    /** Listing fees paid within the range. */
    feesPaidCents: number
  }
  /** Views and favourites gained in the range; null without two snapshots to compare. */
  traffic: { views: number; favorites: number; since: string } | null
  /** Twelve weeks of listing fees up to the range's end: paid then, against their time share. */
  listingFees: {
    weeks: { start: string; paidCents: number; sharedCents: number }[]
    /** Paid already for days still to come. */
    prepaidCents: number
  }
  /** The shown accounts' sync. */
  sync: SyncStatus[]
}
