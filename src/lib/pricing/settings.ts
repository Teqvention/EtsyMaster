import { readDoc, updateDoc } from "@/lib/db/documents"
import { overview } from "@/lib/keywords/library"

import { DEFAULT_ASSUMPTIONS, DESTINATIONS, type Destination, type ProfitAssumptions } from "./types"

// What Prices remembers between visits: the assumptions the profit per size
// is worked out with, and the shops the market analysis looks at (until it's
// told otherwise: TheWorldGallery and the keyword library's biggest sellers).
// Stored as the "pricing/settings" document.

const FILE = "pricing/settings"
const MAX_SHOPS = 6

type Saved = { assumptions?: Partial<ProfitAssumptions>; marketShops?: string[] | null }

export type PricingSettings = { assumptions: ProfitAssumptions; marketShops: string[] }

export async function pricingSettings(): Promise<PricingSettings> {
  const saved = await readDoc<Saved>(FILE, {})
  return {
    assumptions: { ...DEFAULT_ASSUMPTIONS, ...saved.assumptions },
    marketShops: saved.marketShops ?? (await defaultShops()),
  }
}

async function defaultShops() {
  const library = await overview().catch(() => null)
  const strongest = [...(library?.shops ?? [])].sort((a, b) => b.totalSales - a.totalSales).map((s) => s.name)
  return unique(["TheWorldGallery", ...strongest]).slice(0, 4)
}

const unique = (names: string[]) => {
  const seen = new Set<string>()
  return names.filter((n) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
}

const clampVat = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.3) : fallback

export async function updatePricingSettings(patch: { assumptions?: Partial<ProfitAssumptions>; marketShops?: string[] }) {
  const current = await pricingSettings()
  await updateDoc<Saved>(FILE, {}, (saved) => ({
    ...saved,
    ...(patch.assumptions && {
      assumptions: {
        destination: DESTINATIONS.includes(patch.assumptions.destination as Destination)
          ? patch.assumptions.destination
          : current.assumptions.destination,
        costVat: clampVat(patch.assumptions.costVat, current.assumptions.costVat),
        salesVat: clampVat(patch.assumptions.salesVat, current.assumptions.salesVat),
      },
    }),
    ...(patch.marketShops && {
      marketShops: unique(
        patch.marketShops.map((name) => name.trim().replace(/^.*etsy\.com\/(?:[a-z-]+\/)?shop\//i, "").split(/[/?#]/)[0])
      )
        .filter((name) => /^[A-Za-z0-9]{2,40}$/.test(name))
        .slice(0, MAX_SHOPS),
    }),
  }))
  return pricingSettings()
}
