import { deleteDoc, docKeys, readDoc, readDocs, updateDoc, writeDoc } from "@/lib/db/documents"
import { calibrateShop } from "@/lib/etsy/calibrate"

import { applyOps, fromLabels, mergeHistories, type ShopOp } from "./history-ops"
import type { ShopHistory, StoredAnalysis } from "./types"

// The Shops page's list of shops (looked up, imported, tagged, liked) in one
// document. The database holds it: the browser sends each change as a step
// (`ShopOp`), applied here in one transaction, so changes from every tab and
// address land and none overwrites another. A whole copy (an older browser's)
// is merged in, never put in place of the list. Every few hours the list is
// also kept under backups/shop-history/, the last few dozen of them.
const FILE = "shop-history"
const BACKUPS = "backups/shop-history/"
const BACKUP_EVERY_MS = 6 * 60 * 60 * 1000
const BACKUPS_KEPT = 30

export async function getShopHistory(): Promise<ShopHistory> {
  const history = await readDoc<ShopHistory | null>(FILE, null)
  if (history) return fromLabels(history)
  // Never kept here yet: start from the shops analysed before.
  const recovered = await fromAnalyses()
  await writeDoc(FILE, recovered)
  return recovered
}

/** Applies the steps to the list; answers with the list as it is now. */
export async function changeShopHistory(ops: ShopOp[]) {
  const next = await updateDoc<ShopHistory | null>(FILE, null, (current) =>
    applyOps(fromLabels(current ?? {}), ops)
  )
  await backUp(next!)
  return next!
}

/** Folds a whole copy of the list into the one kept; answers with the result. */
export async function importShopHistory(copy: ShopHistory) {
  const next = await updateDoc<ShopHistory | null>(FILE, null, (current) =>
    mergeHistories(fromLabels(current ?? {}), copy)
  )
  await backUp(next!)
  return next!
}

/** Keeps a copy of the list when the last one is a few hours old. */
async function backUp(history: ShopHistory) {
  const keys = await docKeys(BACKUPS)
  const last = keys.at(-1)?.slice(BACKUPS.length)
  if (last && Date.now() - Date.parse(last) < BACKUP_EVERY_MS) return
  await writeDoc(`${BACKUPS}${new Date().toISOString()}`, history)
  for (const key of keys.slice(0, Math.max(0, keys.length + 1 - BACKUPS_KEPT))) await deleteDoc(key)
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
    const { listings } = calibrateShop(stored.listings, stored.reviews, stored.shop, {
      reviewsComplete: stored.plan.reviews === "all" && stored.status === "done",
      analysedAt: stored.analysedAt,
    })
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
