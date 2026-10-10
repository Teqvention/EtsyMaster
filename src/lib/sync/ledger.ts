import type { LedgerCategory } from "./types"

// Etsy's payment ledger names its entries loosely: `ledger_type` values like
// "listing", "renew_sold_auto", "transaction", "PROLIST" (Etsy Ads),
// "offsite_ads_fee", "vat_seller_services", "PAYMENT_PROCESSING_FEE",
// "DISBURSE2", "REFUND"; the description says the same in words. Both are
// matched, in an order that keeps the specific ones from falling into the
// general ones (a refund of a processing fee is a refund; VAT on a listing
// fee is VAT).

const RULES: [RegExp, LedgerCategory][] = [
  [/refund|reversal|chargeback/, "refund"],
  [/disburse|deposit|payout|transfer to bank/, "payout"],
  [/\bvat\b|vat_|tax on (seller|etsy) fees|sales tax on fees/, "vat"],
  [/offsite/, "offsite_ads"],
  [/prolist|etsy ads|promoted listing|advertis/, "ads"],
  [/processing/, "processing"],
  [/shipping_label|shipping label|postage|label/, "shipping_label"],
  [/subscription|etsy plus|pattern/, "subscription"],
  [/onboarding|setup|set up|shop opening|registration/, "setup"],
  [/listing|renew/, "listing"],
  [/transaction|shipping_transaction/, "transaction"],
  [/payment|sale|gross/, "sale"],
]

export function ledgerCategory(type: string, description: string, amountCents: number): LedgerCategory {
  const text = `${type} ${description}`.toLowerCase()
  for (const [pattern, category] of RULES) {
    if (!pattern.test(text)) continue
    // A fee handed back (on a refunded order) is a credit on that fee: it lowers the fees.
    if (category === "refund" && amountCents > 0 && /fee/.test(text)) {
      return RULES.find(([p, c]) => c !== "refund" && c !== "sale" && p.test(text))?.[1] ?? "other_fee"
    }
    // Money out that only looks like a sale is a fee.
    if (category === "sale" && amountCents < 0) return "other_fee"
    return category
  }
  return amountCents < 0 ? "other_fee" : "other"
}
