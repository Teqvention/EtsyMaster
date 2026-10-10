import { listAccounts } from "@/lib/accounts/store"

import { gelatoCosts } from "./costs"
import { usdRate } from "./fx"
import { marketAnalysis, suggest } from "./market"
import { pricingSettings } from "./settings"
import { listProfiles } from "./store"
import type { PricesState } from "./types"

/** Everything the Prices page shows, from what's stored; stale Gelato costs are asked for again in the background. */
export async function pricesState(): Promise<PricesState> {
  const [profiles, accounts, settings, usd, market] = await Promise.all([
    listProfiles(),
    listAccounts(),
    pricingSettings(),
    usdRate(),
    marketAnalysis(),
  ])
  return {
    profiles: profiles.map((p) => ({
      ...p,
      usedBy: accounts.filter((a) => a.priceProfileId === p.id).map((a) => a.id),
    })),
    assumptions: settings.assumptions,
    costs: await gelatoCosts(settings.assumptions.destination),
    usd,
    market,
    marketShops: settings.marketShops,
    suggestion: suggest(market, profiles.find((p) => p.id === "mid") ?? profiles[0]),
  }
}
