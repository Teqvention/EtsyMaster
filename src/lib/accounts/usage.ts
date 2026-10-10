import { etsyRequest } from "@/lib/etsy/client"
import { combine, usageOf, type EtsyUsage } from "@/lib/etsy/usage"
import { accountProgress } from "@/lib/pipeline/progress"
import type { AccountProgress } from "@/lib/pipeline/types"

import { getKey, getTokens, isLive, listAccounts } from "./store"
import type { AccountRole } from "./types"

// What the sidebar shows per account: the quota left on its key and, while
// uploads run, how far its share has come.

export type AccountUsage = {
  id: string
  label: string
  role: AccountRole
  shopName: string | null
  connected: boolean
  usage: EtsyUsage | null
  progress: AccountProgress | null
}

export type UsageState = {
  accounts: AccountUsage[]
  /** Both analysis keys together: what research and shop analyses can still spend. */
  analysis: EtsyUsage | null
}

/** Every account's quota; `refresh` asks Etsy for a fresh reading (one request per key). */
export async function usageState(refresh = false): Promise<UsageState> {
  const accounts = await listAccounts()
  if (refresh) {
    await Promise.all(
      accounts.map(async (a) => {
        if (!(await getKey(a.id))) return
        await etsyRequest("/openapi-ping", { account: a.id }).catch(() => {})
      })
    )
  }
  const progress = await accountProgress().catch(() => [] as AccountProgress[])
  const rows = await Promise.all(
    accounts.map(async (a) => ({
      id: a.id,
      label: a.label,
      role: a.role,
      shopName: a.shop?.name ?? null,
      connected: isLive(await getTokens(a.id)),
      usage: await usageOf(a.id),
      progress: progress.find((p) => p.account === a.id) ?? null,
    }))
  )
  // Upload accounts first (the ones the sidebar always shows), then analysis.
  rows.sort((a, b) => (a.role === b.role ? 0 : a.role === "upload" ? -1 : 1))
  return {
    accounts: rows,
    analysis: combine(rows.filter((r) => r.role === "analysis").map((r) => r.usage)),
  }
}
