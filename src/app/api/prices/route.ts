import { respond } from "@/lib/mockups/respond"
import { pricesState } from "@/lib/pricing/state"
import { addProfile } from "@/lib/pricing/store"
import type { PriceTier } from "@/lib/pricing/types"

// Price profiles, with the shops using each, and everything Prices shows
// around them: Gelato's costs, the profit assumptions, the market analysis.
export async function GET() {
  return respond(pricesState)
}

// A new profile: JSON { name, tier?, prices: { [sizeKey]: cents }, note? }.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    name?: unknown
    tier?: unknown
    prices?: unknown
    note?: unknown
  } | null
  if (!body || typeof body.name !== "string" || !body.prices || typeof body.prices !== "object") {
    return Response.json({ error: "A name and prices are needed" }, { status: 400 })
  }
  const tier = (["low", "mid", "high", "custom"] as PriceTier[]).includes(body.tier as PriceTier)
    ? (body.tier as PriceTier)
    : "custom"
  return respond(() =>
    addProfile({
      name: body.name as string,
      tier,
      prices: body.prices as Record<string, number>,
      note: typeof body.note === "string" ? body.note : undefined,
    })
  )
}
