import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import type { StoredAnalysis } from "./types"

// One file per shop: data/shops/<shopId>.json, replaced whenever a new run
// of that shop settles. Written to a temporary file first, so a crash mid
// write never leaves half an analysis behind.

const ROOT = path.join(process.cwd(), "data", "shops")

function file(shopId: number) {
  if (!Number.isInteger(shopId) || shopId <= 0) throw new Error("Invalid shop id")
  return path.join(ROOT, `${shopId}.json`)
}

/** The shop's last analysis, or null if it was never analysed. */
export async function getStoredAnalysis(shopId: number): Promise<StoredAnalysis | null> {
  try {
    return JSON.parse(await readFile(file(shopId), "utf8")) as StoredAnalysis
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

/**
 * Keeps `analysis` as the shop's latest — unless it's a run stopped part way
 * that got less than the one already kept, which stays.
 */
export async function storeAnalysis(analysis: StoredAnalysis) {
  if (analysis.status !== "done") {
    const kept = await getStoredAnalysis(analysis.shop.id)
    if (kept && kept.listings.length > analysis.listings.length) {
      return { ok: true, analysedAt: kept.analysedAt, kept: true }
    }
  }
  const target = file(analysis.shop.id)
  await mkdir(ROOT, { recursive: true })
  const temporary = `${target}.${process.pid}-${Date.now()}.tmp`
  await writeFile(temporary, JSON.stringify(analysis))
  await rename(temporary, target)
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
