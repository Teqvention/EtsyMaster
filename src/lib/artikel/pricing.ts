import type { PriceProfile } from "@/lib/pricing/types"
import type { SyncedListing } from "@/lib/sync/types"

import type { PriceChange, Rounding } from "./types"

// New prices for a listing's sizes: up or down by a percentage or an amount,
// rounded to a price ending (.90, .95, .99), or a price profile's price for
// each size. Plain arithmetic on the synced prices, so the preview and the
// queue work them out the same way.

/** Etsy's lowest price, about $0.20. */
const MIN_PRICE = 20

/**
 * `cents` moved to the nearest price ending in `rounding` (90 → x.90), but
 * never back past `before`: a raise stays a raise, a cut a cut.
 */
export function roundPrice(cents: number, before: number, rounding: Rounding) {
  if (rounding === "none") return Math.round(cents)
  const ending = Number(rounding)
  const below = Math.floor((cents - ending) / 100) * 100 + ending
  const above = below + 100
  let next = cents - below <= above - cents ? below : above
  if (cents > before && next <= before) next = above
  if (cents < before && next >= before) next = below
  return next
}

export function changedPrice(before: number, change: Extract<PriceChange, { kind: "price" }>) {
  const raw = change.mode === "percent" ? before * (1 + change.value / 100) : before + change.value
  return roundPrice(raw, before, change.rounding)
}

export type PlannedPrice = { productId: number; label: string; before: number; after: number }

/** Each size's price before and after; `skip` says why nothing changes. */
export function plannedPrices(
  listing: SyncedListing,
  change: PriceChange,
  profile?: PriceProfile
): { prices: PlannedPrice[]; skip?: string } {
  if (!listing.variants.length) return { prices: [], skip: "No sizes synced yet" }
  if (change.kind === "profile") {
    if (!profile) return { prices: [], skip: "Unknown price profile" }
    if (listing.currency !== profile.currency) {
      return { prices: [], skip: `Prices are in ${listing.currency}, the profile in ${profile.currency}` }
    }
    if (!listing.variants.some((v) => v.sizeKey)) return { prices: [], skip: "None of its sizes is one of ours" }
  } else if (change.mode === "amount" && listing.currency !== "EUR") {
    return { prices: [], skip: `Prices are in ${listing.currency}, the amount in EUR` }
  }
  const prices = listing.variants.map((v) => ({
    productId: v.productId,
    label: v.label || "Price",
    before: v.priceCents,
    after:
      change.kind === "profile"
        ? v.sizeKey
          ? profile!.prices[v.sizeKey]
          : v.priceCents
        : changedPrice(v.priceCents, change),
  }))
  if (prices.some((p) => p.after < MIN_PRICE)) return { prices, skip: "A size would go below Etsy's lowest price" }
  if (prices.every((p) => p.after === p.before)) return { prices, skip: "Already at these prices" }
  return { prices }
}

const euros = (cents: number) => (cents / 100).toFixed(2)

/** The change in words, e.g. "Price +10 %, ending .90". */
export function priceLabel(change: Extract<PriceChange, { kind: "price" }>) {
  const sign = change.value < 0 ? "−" : "+"
  const amount = change.mode === "percent" ? `${Math.abs(change.value)} %` : `€${euros(Math.abs(change.value))}`
  return `Price ${sign}${amount}${change.rounding === "none" ? "" : `, ending .${change.rounding}`}`
}
