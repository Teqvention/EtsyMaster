import { respond } from "@/lib/mockups/respond"
import { updatePricingSettings } from "@/lib/pricing/settings"
import { pricesState } from "@/lib/pricing/state"
import type { ProfitAssumptions } from "@/lib/pricing/types"

// What profits are worked out with and which shops the market analysis looks
// at: JSON { assumptions?: { destination?, costVat?, salesVat? }, marketShops?: string[] }.
// Answers with the whole Prices state.
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    assumptions?: unknown
    marketShops?: unknown
  } | null
  if (!body) return Response.json({ error: "Nothing to change" }, { status: 400 })
  const shops = Array.isArray(body.marketShops) ? body.marketShops.filter((s) => typeof s === "string") : undefined
  return respond(async () => {
    await updatePricingSettings({
      ...(body.assumptions && typeof body.assumptions === "object"
        ? { assumptions: body.assumptions as Partial<ProfitAssumptions> }
        : {}),
      ...(shops && { marketShops: shops }),
    })
    return pricesState()
  })
}
