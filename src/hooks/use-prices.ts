"use client"

import * as React from "react"

import type { SizeKey } from "@/lib/catalog/sizes"
import type { PriceProfile, PriceTier, PricesState, ProfitAssumptions } from "@/lib/pricing/types"

// Everything the Prices page shows, shared module-wide. Gelato's costs are
// asked for in the background on the server; while they are (or while a
// market analysis runs elsewhere) the state is asked for again every few seconds.

const POLL = 3000

const listeners = new Set<() => void>()
let state: PricesState | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function set(next: PricesState) {
  state = next
  listeners.forEach((notify) => notify())
  if (timer) clearTimeout(timer)
  timer = null
  if (listeners.size && (next.costs.refreshing || next.market.running)) {
    timer = setTimeout(refreshPrices, POLL)
  }
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  if (state === null) refreshPrices()
  return () => {
    listeners.delete(notify)
  }
}

/** Null until loaded. */
export function usePrices() {
  return React.useSyncExternalStore(subscribe, () => state, () => null)
}

export async function refreshPrices() {
  try {
    const response = await fetch("/api/prices", { cache: "no-store" })
    if (response.ok) set(await response.json())
  } catch {
    // Keep what's there; the next visit tries again.
  }
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result as T
}

type ProfileInput = { name: string; tier?: PriceTier; prices: Record<SizeKey, number>; note?: string }

export async function createProfile(input: ProfileInput) {
  const profile = await call<PriceProfile>("/api/prices", { method: "POST", body: JSON.stringify(input) })
  await refreshPrices()
  return profile
}

export async function saveProfile(id: string, patch: Partial<ProfileInput>) {
  const profile = await call<PriceProfile>(`/api/prices/${id}`, { method: "PATCH", body: JSON.stringify(patch) })
  await refreshPrices()
  return profile
}

export async function deleteProfile(id: string) {
  await call(`/api/prices/${id}`, { method: "DELETE" })
  await refreshPrices()
}

export async function updatePricesSettings(patch: { assumptions?: Partial<ProfitAssumptions>; marketShops?: string[] }) {
  set(await call<PricesState>("/api/prices/settings", { method: "PATCH", body: JSON.stringify(patch) }))
}

/** Runs the market analysis (on `shops`, saved first, if given); resolves when it's done. */
export async function runMarket(shops?: string[]) {
  if (state) set({ ...state, market: { ...state.market, running: true } })
  try {
    set(await call<PricesState>("/api/prices/market", { method: "POST", body: JSON.stringify({ shops }) }))
  } catch (error) {
    await refreshPrices()
    throw error
  }
}

export async function refreshCosts() {
  set(await call<PricesState>("/api/prices/costs", { method: "POST" }))
}
