import { respond } from "@/lib/mockups/respond"
import { runMarketAnalysis } from "@/lib/pricing/market"
import { pricingSettings, updatePricingSettings } from "@/lib/pricing/settings"
import { pricesState } from "@/lib/pricing/state"

// Runs the market analysis on the saved shops (JSON { shops } saves new ones
// first) and answers with the whole Prices state once it's done: two or three
// Etsy requests per shop, a few seconds each.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { shops?: unknown } | null
  const shops = Array.isArray(body?.shops) ? body.shops.filter((s) => typeof s === "string") : null
  return respond(async () => {
    const settings = shops ? await updatePricingSettings({ marketShops: shops }) : await pricingSettings()
    if (!settings.marketShops.length) throw new Error("Add a shop to look at first")
    await runMarketAnalysis(settings.marketShops)
    return pricesState()
  })
}
