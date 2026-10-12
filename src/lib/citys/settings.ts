import { listAccounts } from "@/lib/accounts/store"
import { readDoc, updateDoc } from "@/lib/db/documents"

import type { RankingScope } from "./types"

// How the city pages are set up, in one document (citys/settings): which
// shops the ranking counts, which of our accounts are city shops (their
// listings tell which places we have), and the shape every city photo is
// made in.

const FILE = "citys/settings"

export type CitySettings = {
  scope: RankingScope
  /** Our accounts that sell city posters. */
  accounts: string[]
  /** Width ÷ height every city photo is painted at, so all of them fit every composition alike. */
  ratio: number
  /** Shops the City Stealer takes reference photos from; all shops in the ranking when empty. */
  stealer: number[]
}

/** Our city shops before any were picked: the accounts whose shop names say so. */
const CITY_SHOP = /slow\s*miles|citys?\s*in\s*black/i

const DEFAULT: CitySettings = {
  scope: { primary: "citys", secondary: [], excluded: [] },
  accounts: [],
  ratio: 3 / 4,
  stealer: [],
}

export async function citySettings(): Promise<CitySettings> {
  const held = await readDoc<Partial<CitySettings> | null>(FILE, null)
  const settings = { ...DEFAULT, ...held, scope: { ...DEFAULT.scope, ...held?.scope } }
  if (!held?.accounts) {
    const accounts = await listAccounts().catch(() => [])
    settings.accounts = accounts.filter((a) => CITY_SHOP.test(a.shop?.name ?? a.label)).map((a) => a.id)
  }
  return settings
}

export type SettingsPatch = Partial<Omit<CitySettings, "scope">> & { scope?: Partial<RankingScope> }

export async function patchSettings(patch: SettingsPatch): Promise<CitySettings> {
  const current = await citySettings()
  const next: CitySettings = {
    ...current,
    ...(Array.isArray(patch.accounts) && { accounts: patch.accounts.filter((a) => typeof a === "string") }),
    ...(typeof patch.ratio === "number" && patch.ratio > 0.4 && patch.ratio < 2.5 && { ratio: patch.ratio }),
    ...(Array.isArray(patch.stealer) && { stealer: patch.stealer.filter(Number.isInteger) }),
    scope: {
      ...current.scope,
      ...(typeof patch.scope?.primary === "string" && patch.scope.primary.trim() && { primary: patch.scope.primary.trim() }),
      ...(Array.isArray(patch.scope?.secondary) && { secondary: patch.scope.secondary.filter((s) => typeof s === "string") }),
      ...(Array.isArray(patch.scope?.excluded) && { excluded: patch.scope.excluded.filter(Number.isInteger) }),
    },
  }
  await updateDoc<CitySettings | null>(FILE, null, () => next)
  return next
}
