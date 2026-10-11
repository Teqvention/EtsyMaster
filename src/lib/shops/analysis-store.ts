import { readDoc, updateDoc } from "@/lib/db/documents"

import type { CountSnapshot } from "@/lib/etsy/types"

import type { StoredAnalysis } from "./types"

// One document per shop: shops/<shopId>, replaced whenever a new run of
// that shop settles. The favorites and views of the one replaced are kept as
// a snapshot when it's a day or more older: Etsy only tells the totals, so
// what a listing gained between two analyses is the one timed signal
// besides reviews.

const DAY_MS = 24 * 60 * 60 * 1000
/** Snapshots kept per shop, newest last. */
const SNAPSHOTS_KEPT = 8

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
  let snapshots: CountSnapshot[] = []
  await updateDoc<StoredAnalysis | null>(file(analysis.shop.id), null, (current) => {
    if (analysis.status !== "done" && current && current.listings.length > analysis.listings.length) kept = current
    snapshots = kept ? (current?.snapshots ?? []) : withSnapshot(current, analysis.analysedAt)
    return kept ?? { ...analysis, snapshots }
  })
  if (kept) return { ok: true, analysedAt: (kept as StoredAnalysis).analysedAt, kept: true, snapshots }
  return { ok: true, analysedAt: analysis.analysedAt, snapshots }
}

/** The snapshots, with the analysis being replaced added when it's a day or more older than `next`. */
function withSnapshot(current: StoredAnalysis | null, next: string): CountSnapshot[] {
  const snapshots = current?.snapshots ?? []
  if (!current?.listings.length || Date.parse(next) - Date.parse(current.analysedAt) < DAY_MS) return snapshots
  if (snapshots.some((s) => s.at === current.analysedAt)) return snapshots
  const counts = Object.fromEntries(current.listings.map((l) => [l.id, [l.favorites, l.views] as [number, number]]))
  return [...snapshots, { at: current.analysedAt, counts }].slice(-SNAPSHOTS_KEPT)
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
