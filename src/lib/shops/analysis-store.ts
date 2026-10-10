import { readDoc, updateDoc } from "@/lib/db/documents"

import type { StoredAnalysis } from "./types"

// One document per shop: shops/<shopId>, replaced whenever a new run of
// that shop settles.

function file(shopId: number) {
  if (!Number.isInteger(shopId) || shopId <= 0) throw new Error("Invalid shop id")
  return `shops/${shopId}`
}

/** The shop's last analysis, or null if it was never analysed. */
export async function getStoredAnalysis(shopId: number): Promise<StoredAnalysis | null> {
  return readDoc<StoredAnalysis | null>(file(shopId), null)
}

/**
 * Keeps `analysis` as the shop's latest — unless it's a run stopped part way
 * that got less than the one already kept, which stays.
 */
export async function storeAnalysis(analysis: StoredAnalysis) {
  let kept: StoredAnalysis | null = null
  await updateDoc<StoredAnalysis | null>(file(analysis.shop.id), null, (current) => {
    if (analysis.status !== "done" && current && current.listings.length > analysis.listings.length) kept = current
    return kept ?? analysis
  })
  if (kept) return { ok: true, analysedAt: (kept as StoredAnalysis).analysedAt, kept: true }
  return { ok: true, analysedAt: analysis.analysedAt }
}

export function isStoredAnalysis(value: unknown): value is StoredAnalysis {
  const v = value as StoredAnalysis
  return (
    !!v &&
    typeof v.shop?.id === "number" &&
    typeof v.shop?.name === "string" &&
    typeof v.plan?.limit === "number" &&
    (v.status === "done" || v.status === "stopped" || v.status === "error") &&
    Array.isArray(v.listings) &&
    Array.isArray(v.reviews) &&
    typeof v.analysedAt === "string" &&
    !Number.isNaN(Date.parse(v.analysedAt))
  )
}
