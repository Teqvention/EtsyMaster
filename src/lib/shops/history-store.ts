import { readDoc, readDocs, writeDoc } from "@/lib/db/documents"
import { applyReviews } from "@/lib/etsy/analysis"

import type { ShopHistory, StoredAnalysis } from "./types"

// The Shops page's list of shops (looked up, imported, labelled) in one
// document, so it outlives the browser's storage and server restarts. The
// browser sends the whole list back after each change.
const FILE = "shop-history"

export async function getShopHistory(): Promise<ShopHistory> {
  const history = await readDoc<ShopHistory | null>(FILE, null)
  if (history) return history
  // Never kept here yet: start from the shops analysed before.
  const recovered = await fromAnalyses()
  await writeDoc(FILE, recovered)
  return recovered
}

export async function putShopHistory(history: ShopHistory) {
  await writeDoc(FILE, history)
  return { ok: true }
}

export function isShopHistory(value: unknown): value is ShopHistory {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (v) => !!v && typeof v.shop?.id === "number" && typeof v.viewedAt === "string"
    )
  )
}

async function fromAnalyses(): Promise<ShopHistory> {
  const analyses = await readDocs<StoredAnalysis | null>("shops/")
  const history: ShopHistory = {}
  for (const stored of analyses.values()) {
    if (!stored?.shop) continue
    const listings =
      stored.plan.reviews === "all" && stored.status === "done"
        ? applyReviews(stored.listings, stored.reviews)
        : stored.listings
    const top = [...listings]
      .sort((a, b) => b.estimate.revenuePerMonthCents - a.estimate.revenuePerMonthCents)
      .slice(0, 3)
    history[stored.shop.id] = {
      shop: stored.shop,
      viewedAt: stored.analysedAt,
      analysis: {
        plan: stored.plan,
        listings: listings.length,
        complete: stored.status === "done",
        revenuePerMonthCents: listings.reduce((total, l) => total + l.estimate.revenuePerMonthCents, 0),
        salesPerMonth: listings.reduce((total, l) => total + l.estimate.salesPerMonth, 0),
        top: top.map((l) => ({ title: l.title, thumb: l.images[0]?.thumb ?? null })),
        analysedAt: stored.analysedAt,
      },
    }
  }
  return history
}
