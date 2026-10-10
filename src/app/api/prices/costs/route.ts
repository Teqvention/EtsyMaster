import { respond } from "@/lib/mockups/respond"
import { refreshCosts } from "@/lib/pricing/costs"
import { pricingSettings } from "@/lib/pricing/settings"
import { pricesState } from "@/lib/pricing/state"

// Asks Gelato for the costs to the current destination again. Answers right
// away with `costs.refreshing` set; the page asks again until it's clear.
export async function POST() {
  return respond(async () => {
    const { assumptions } = await pricingSettings()
    void refreshCosts(assumptions.destination)
    return pricesState()
  })
}
