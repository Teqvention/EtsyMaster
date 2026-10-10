import { SIZE_KEYS, type SizeKey } from "@/lib/catalog/sizes"
import { newId, readDoc, updateDoc } from "@/lib/db/documents"
import { NotFoundError } from "@/lib/mockups/storage"

import { STARTING_PRICES, pricesFromEuros, type PriceProfile, type PriceTier } from "./types"

// Price profiles in the "prices" document. Low, mid and high are made the
// first time the list is read; after that they're ordinary profiles that can
// be edited (not deleted while a shop uses them).

const FILE = "prices"

function starting(): PriceProfile[] {
  const now = new Date().toISOString()
  return (["low", "mid", "high"] as const).map((tier) => ({
    id: tier,
    name: { low: "Low", mid: "Mid", high: "High" }[tier],
    tier,
    currency: "EUR",
    prices: pricesFromEuros(STARTING_PRICES[tier]),
    createdAt: now,
    updatedAt: now,
  }))
}

export async function listProfiles(): Promise<PriceProfile[]> {
  const list = await readDoc<PriceProfile[] | null>(FILE, null)
  if (list) return list
  return updateDoc<PriceProfile[] | null>(FILE, null, (current) => current ?? starting()) as Promise<PriceProfile[]>
}

export async function getProfile(id: string) {
  const profile = (await listProfiles()).find((p) => p.id === id)
  if (!profile) throw new NotFoundError("Unknown price profile")
  return profile
}

export type ProfileInput = { name: string; tier?: PriceTier; prices: Partial<Record<SizeKey, number>>; note?: string }

function cleanPrices(prices: Partial<Record<SizeKey, number>>, base?: Record<SizeKey, number>) {
  const out = {} as Record<SizeKey, number>
  for (const key of SIZE_KEYS) {
    const value = prices[key] ?? base?.[key]
    if (!Number.isFinite(value) || (value as number) < 20) throw new Error(`Price for ${key} is missing`)
    out[key] = Math.round(value as number)
  }
  return out
}

export async function addProfile(input: ProfileInput) {
  const now = new Date().toISOString()
  const profile: PriceProfile = {
    id: newId("p-"),
    name: input.name.trim().slice(0, 40) || "Custom",
    tier: input.tier ?? "custom",
    currency: "EUR",
    prices: cleanPrices(input.prices),
    note: input.note?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  }
  await listProfiles()
  await updateDoc<PriceProfile[]>(FILE, [], (list) => [...list, profile])
  return profile
}

export async function updateProfile(id: string, patch: Partial<ProfileInput>) {
  await listProfiles()
  let found = false
  const list = await updateDoc<PriceProfile[]>(FILE, [], (list) =>
    list.map((p) => {
      if (p.id !== id) return p
      found = true
      return {
        ...p,
        ...(patch.name !== undefined && { name: patch.name.trim().slice(0, 40) || p.name }),
        ...(patch.tier !== undefined && { tier: patch.tier }),
        ...(patch.note !== undefined && { note: patch.note.trim() || undefined }),
        ...(patch.prices && { prices: cleanPrices(patch.prices, p.prices) }),
        updatedAt: new Date().toISOString(),
      }
    })
  )
  if (!found) throw new NotFoundError("Unknown price profile")
  return list.find((p) => p.id === id)!
}

export async function deleteProfile(id: string, inUse: boolean) {
  if (inUse) throw new Error("A shop uses this profile. Give the shop another one first.")
  await listProfiles()
  await updateDoc<PriceProfile[]>(FILE, [], (list) => list.filter((p) => p.id !== id))
}
