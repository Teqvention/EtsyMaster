import { SIZE_KEYS, type SizeKey } from "@/lib/catalog/sizes"

import type { ProfitAssumptions, SizeCost } from "./types"

// What one sale of one size leaves over once Gelato has printed and shipped
// it and Etsy has taken its fees. Plain arithmetic, so Prices works it out
// again with every keystroke, and its tools can turn it around: the price
// that leaves a given margin.

/** Etsy's fees for a shop in Germany selling through Etsy Payments. */
export const ETSY_FEES = {
  /** Of the item price (and of shipping, which is free here). */
  transaction: 0.065,
  /** Payment processing in Germany: 4 % of the order and 0.30 €. */
  processing: 0.04,
  processingFixedCents: 30,
  /** Every sale renews the listing (it's made to order, so it never sells out) for another 0.20 $. */
  listingUsdCents: 20,
}

export type Profit = {
  priceCents: number
  /** The VAT inside the price that goes to the tax office. */
  salesVatCents: number
  /** Gelato's print and shipping, with VAT where it counts as cost. */
  printCents: number
  shippingCents: number
  /** Transaction fee and payment processing. */
  feesCents: number
  listingCents: number
  profitCents: number
  /** Profit as a share of the price. */
  margin: number
}

export function profitOf(priceCents: number, cost: SizeCost, a: ProfitAssumptions, eurPerUsd: number): Profit {
  const withVat = (cents: number) => cents * (1 + a.costVat)
  const salesVatCents = priceCents - priceCents / (1 + a.salesVat)
  const printCents = withVat(cost.productCents)
  const shippingCents = withVat(cost.shippingCents ?? 0)
  const feesCents = withVat(priceCents * (ETSY_FEES.transaction + ETSY_FEES.processing) + ETSY_FEES.processingFixedCents)
  const listingCents = withVat(ETSY_FEES.listingUsdCents * eurPerUsd)
  const profitCents = priceCents - salesVatCents - printCents - shippingCents - feesCents - listingCents
  return {
    priceCents,
    salesVatCents,
    printCents,
    shippingCents,
    feesCents,
    listingCents,
    profitCents,
    margin: priceCents > 0 ? profitCents / priceCents : 0,
  }
}

/** The price that leaves `margin` of itself over; null when the fees alone eat more than that. */
export function priceForMargin(margin: number, cost: SizeCost, a: ProfitAssumptions, eurPerUsd: number) {
  const vat = 1 + a.costVat
  const kept = 1 / (1 + a.salesVat) - (ETSY_FEES.transaction + ETSY_FEES.processing) * vat - margin
  if (kept <= 0.02) return null
  const fixed =
    (cost.productCents + (cost.shippingCents ?? 0) + ETSY_FEES.processingFixedCents + ETSY_FEES.listingUsdCents * eurPerUsd) *
    vat
  return fixed / kept
}

/** The price ending in `ending` cents (90 → x.90) nearest to `cents`, or the next one up. */
export function roundToEnding(cents: number, ending: number, direction: "nearest" | "up" = "nearest") {
  const base = Math.floor(cents / 100) * 100 + ending
  const candidates = [base - 100, base, base + 100].filter((c) => c > 0)
  if (direction === "up") return candidates.find((c) => c >= Math.round(cents)) ?? base + 100
  return candidates.reduce((best, c) => (Math.abs(c - cents) < Math.abs(best - cents) ? c : best))
}

/** Every size's price changed by `change`, keeping whole cents. */
export function mapPrices(prices: Record<SizeKey, number>, change: (cents: number, size: SizeKey) => number) {
  return Object.fromEntries(SIZE_KEYS.map((key) => [key, Math.max(0, Math.round(change(prices[key], key)))])) as Record<
    SizeKey,
    number
  >
}
