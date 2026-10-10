import { etsyRequest, type ApiMoney, type ApiPage } from "@/lib/etsy/client"
import { shopIdOf } from "@/lib/etsy/shop"

// The Etsy reads the sync needs beyond lib/etsy/shop.ts: orders (receipts
// with their transactions) and the payment ledger. Both need the shop
// owner's grant (transactions_r) and spend the account's own quota.

export type ApiTransaction = {
  transaction_id: number
  receipt_id: number
  listing_id: number | null
  product_id: number | null
  title: string | null
  quantity: number
  price: ApiMoney
  shipping_cost: ApiMoney
  /** Epoch seconds */
  created_timestamp: number
  variations?: { property_id: number; value_id: number | null; formatted_name: string; formatted_value: string }[]
  product_data?: { property_id: number; property_name: string | null; values: string[] }[]
}

export type ApiReceipt = {
  receipt_id: number
  status: string
  country_iso: string | null
  is_paid: boolean
  /** Epoch seconds */
  created_timestamp: number
  updated_timestamp: number
  total_price: ApiMoney
  total_shipping_cost: ApiMoney
  discount_amt: ApiMoney
  grandtotal: ApiMoney
  transactions: ApiTransaction[]
  refunds?: { amount: ApiMoney; created_timestamp: number; reason: string | null; status: string }[]
}

export type ApiLedgerEntry = {
  entry_id: number
  ledger_id: number
  /** Minor units of `currency`, signed. */
  amount: number
  currency: string
  description: string
  balance: number
  /** Epoch seconds */
  created_timestamp: number
  create_date?: number
  ledger_type: string
  reference_type: string | null
  reference_id: string | null
}

/** A buyer's payment for one order: what ties processing fees in the ledger to the order. */
export type ApiPayment = {
  payment_id: number
  receipt_id: number
}

const PAGE = 100

/** Receipts changed since `since` (epoch ms), oldest change first; every receipt when absent. */
export async function receiptsPage(account: string, offset: number, since?: number) {
  const shopId = await shopIdOf(account)
  return etsyRequest<ApiPage<ApiReceipt>>(`/shops/${shopId}/receipts`, {
    account,
    auth: true,
    params: {
      limit: PAGE,
      offset,
      sort_on: "updated",
      sort_order: "asc",
      ...(since !== undefined && { min_last_modified: Math.floor(since / 1000) }),
    },
  })
}

/** Ledger entries made from `from` to `to` (epoch ms), one page. */
export async function ledgerPage(account: string, from: number, to: number, offset: number) {
  const shopId = await shopIdOf(account)
  return etsyRequest<ApiPage<ApiLedgerEntry>>(`/shops/${shopId}/payment-account/ledger-entries`, {
    account,
    auth: true,
    params: {
      min_created: Math.floor(from / 1000),
      max_created: Math.floor(to / 1000),
      limit: PAGE,
      offset,
    },
  })
}

/** The payments with these ids (up to 100), each with its order. */
export async function paymentsByIds(account: string, ids: string[]) {
  const shopId = await shopIdOf(account)
  return etsyRequest<ApiPage<ApiPayment>>(`/shops/${shopId}/payments`, {
    account,
    auth: true,
    params: { payment_ids: ids.join(",") },
  })
}

export const SYNC_PAGE = PAGE

/** Whole cents of an Etsy money object, in its own currency. */
export const cents = (money: ApiMoney | null | undefined) =>
  money ? Math.round((money.amount / money.divisor) * 100) : 0
