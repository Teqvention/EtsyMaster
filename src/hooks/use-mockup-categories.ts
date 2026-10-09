"use client"

import * as React from "react"

import type { CategorySummary } from "@/lib/mockups/types"

// Mockup categories for pickers outside the mockups page. Re-read from the
// server whenever a picker opens, but created here first, so a new category
// can be picked the instant it's named while the server catches up behind.

const EMPTY: CategorySummary[] = []
const listeners = new Set<() => void>()
let categories: CategorySummary[] = EMPTY

function set(next: CategorySummary[]) {
  categories = next.toSorted((a, b) => a.name.localeCompare(b.name))
  listeners.forEach((notify) => notify())
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

export function useMockupCategories() {
  return React.useSyncExternalStore(subscribe, () => categories, () => EMPTY)
}

/** Reloads the list; categories created here that the server hasn't stored yet stay. */
export async function refreshCategories() {
  try {
    const response = await fetch("/api/mockups/categories", { cache: "no-store" })
    if (!response.ok) return
    const stored: CategorySummary[] = await response.json()
    const known = new Set(stored.map((c) => c.name.toLowerCase()))
    set([...stored, ...categories.filter((c) => !known.has(c.name.toLowerCase()))])
  } catch {
    // Keep what's there; the next open tries again.
  }
}

/** The category by that name, created first if there's none. */
export function createCategory(name: string) {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40)
  const existing = categories.find((c) => c.name.toLowerCase() === clean.toLowerCase())
  if (existing) return existing.name
  set([...categories, { name: clean, count: 0 }])
  fetch("/api/mockups/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: clean }),
  }).catch(() => {})
  return clean
}
