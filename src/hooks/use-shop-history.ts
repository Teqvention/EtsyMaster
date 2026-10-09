"use client"

import * as React from "react"

import type { AnalysisPlan } from "@/lib/etsy/analysis"
import type { ListingShop } from "@/lib/etsy/types"

// Shops looked up on the Shops page, kept in localStorage like liked
// listings. Each entry holds the shop as last seen, a summary of its last
// analysis and the labels it's filed under, so the list renders without API
// calls and reopening a shop can pick up the scope it was analysed with.

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
  /** Names the shop is filed under, as first typed; matched case-insensitively. */
  labels?: string[]
}

type History = Record<number, ShopVisit>

const STORAGE_KEY = "etsy-research:shops"
/** Unlabelled shops kept; labelled ones are never dropped. */
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
  // Oldest views fall off once the list is full, unless filed under a label.
  const visits = Object.values(next).sort((a, b) => b.viewedAt.localeCompare(a.viewedAt))
  const labelled = visits.filter((v) => v.labels?.length)
  const kept = [...labelled, ...visits.filter((v) => !v.labels?.length).slice(0, MAX_SHOPS)]
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
      ...current[shop.id],
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
      ...current[shop.id],
      shop,
      viewedAt: current[shop.id]?.viewedAt ?? analysis.analysedAt,
      analysis,
    },
  })
}

// --- Labels ---

export type ShopLabel = { name: string; count: number }

const sameLabel = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Every label in use, A–Z, with how many shops carry it. */
export function shopLabels(history: History): ShopLabel[] {
  const labels = new Map<string, ShopLabel>()
  for (const visit of Object.values(history)) {
    for (const name of visit.labels ?? []) {
      const key = name.toLowerCase()
      const label = labels.get(key) ?? { name, count: 0 }
      labels.set(key, { ...label, count: label.count + 1 })
    }
  }
  return [...labels.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function useShopLabels() {
  const history = useShopHistory()
  return React.useMemo(() => shopLabels(history), [history])
}

export function hasLabel(visit: ShopVisit, label: string) {
  return visit.labels?.some((l) => sameLabel(l, label)) ?? false
}

/**
 * Files the shops under `label`, or takes them out of it. A label that exists
 * already keeps the spelling it was first given.
 */
export function setShopLabel(shops: ListingShop[], label: string, on: boolean) {
  const current = read()
  const name = label.trim().replace(/\s+/g, " ").slice(0, 32)
  if (!name) return
  const spelling = shopLabels(current).find((l) => sameLabel(l.name, name))?.name ?? name
  const next = { ...current }
  const now = new Date().toISOString()
  for (const shop of shops) {
    const visit = next[shop.id] ?? { shop, viewedAt: now, analysis: null }
    const others = (visit.labels ?? []).filter((l) => !sameLabel(l, spelling))
    next[shop.id] = { ...visit, labels: on ? [...others, spelling] : others }
  }
  write(next)
}

export function forgetShop(shopId: number) {
  const next = { ...read() }
  delete next[shopId]
  write(next)
}
