"use client"

import * as React from "react"

import type { AnalysisPlan } from "@/lib/etsy/analysis"
import type { ListingShop } from "@/lib/etsy/types"

// Shops looked up on the Shops page, kept in localStorage like liked
// listings. Each entry holds the shop as last seen and a summary of its last
// analysis, so the list renders without API calls and reopening a shop can
// pick up the scope it was analysed with.

export type ShopAnalysisSummary = {
  plan: AnalysisPlan
  /** Listings the analysis covered. */
  listings: number
  /** False when the run was stopped or failed part way. */
  complete: boolean
  revenuePerMonthCents: number
  salesPerMonth: number
  /** Top earners, best first. */
  top: { title: string; thumb: string | null }[]
  /** ISO 8601 */
  analysedAt: string
}

export type ShopVisit = {
  shop: ListingShop
  /** ISO 8601 */
  viewedAt: string
  analysis: ShopAnalysisSummary | null
}

type History = Record<number, ShopVisit>

const STORAGE_KEY = "etsy-research:shops"
const MAX_SHOPS = 50
const EMPTY: History = {}

const listeners = new Set<() => void>()
let raw: string | null = null
let history: History = EMPTY

function read(): History {
  const next = localStorage.getItem(STORAGE_KEY)
  if (next !== raw) {
    raw = next
    try {
      history = next ? (JSON.parse(next) as History) : EMPTY
    } catch {
      history = EMPTY
    }
  }
  return history
}

function write(next: History) {
  // Oldest views fall off once the list is full.
  const kept = Object.values(next)
    .sort((a, b) => b.viewedAt.localeCompare(a.viewedAt))
    .slice(0, MAX_SHOPS)
  history = Object.fromEntries(kept.map((v) => [v.shop.id, v]))
  raw = JSON.stringify(history)
  localStorage.setItem(STORAGE_KEY, raw)
  listeners.forEach((notify) => notify())
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) notify()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(notify)
    window.removeEventListener("storage", onStorage)
  }
}

export function useShopHistory() {
  return React.useSyncExternalStore(subscribe, read, () => EMPTY)
}

/** The stored visit for a shop, read once (e.g. to seed state). */
export function getShopVisit(shopId: number): ShopVisit | null {
  return read()[shopId] ?? null
}

export function recordShopVisit(shop: ListingShop) {
  const current = read()
  write({
    ...current,
    [shop.id]: {
      shop,
      viewedAt: new Date().toISOString(),
      analysis: current[shop.id]?.analysis ?? null,
    },
  })
}

export function recordShopAnalysis(shop: ListingShop, analysis: ShopAnalysisSummary) {
  const current = read()
  write({
    ...current,
    [shop.id]: {
      shop,
      viewedAt: current[shop.id]?.viewedAt ?? analysis.analysedAt,
      analysis,
    },
  })
}

export function forgetShop(shopId: number) {
  const next = { ...read() }
  delete next[shopId]
  write(next)
}
