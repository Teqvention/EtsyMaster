"use client"

import * as React from "react"

import type { CategorySummary } from "@/lib/mockups/types"
import { ancestry, cleanFolder } from "@/lib/saved/folders"

// Categories for pickers, two lists apart: the mockup categories scenes are
// filed under, and the Saved page's folders steals are filed into (which
// nest, named by their path: see lib/saved/folders.ts). Re-read
// from the server whenever a picker opens, but created here first, so a new
// one can be picked the instant it's named while the server catches up behind.

export type Categories = "mockups" | "saved"

const URLS: Record<Categories, string> = {
  mockups: "/api/mockups/categories",
  saved: "/api/saved/folders",
}

const EMPTY: CategorySummary[] = []
const listeners = new Set<() => void>()
const lists: Record<Categories, CategorySummary[]> = { mockups: EMPTY, saved: EMPTY }

function set(of: Categories, next: CategorySummary[]) {
  lists[of] = next.toSorted((a, b) => a.name.localeCompare(b.name))
  listeners.forEach((notify) => notify())
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

export function useCategories(of: Categories) {
  return React.useSyncExternalStore(subscribe, () => lists[of], () => EMPTY)
}

/** Reloads the list; categories created here that the server hasn't stored yet stay. */
export async function refreshCategories(of: Categories) {
  try {
    const response = await fetch(URLS[of], { cache: "no-store" })
    if (!response.ok) return
    const stored: CategorySummary[] = await response.json()
    const known = new Set(stored.map((c) => c.name.toLowerCase()))
    set(of, [...stored, ...lists[of].filter((c) => !known.has(c.name.toLowerCase()))])
  } catch {
    // Keep what's there; the next open tries again.
  }
}

/**
 * The category by that name, created first if there's none. A folder's path
 * makes the folders it's in too, each keeping the spelling it has.
 */
export function createCategory(of: Categories, name: string) {
  const clean = of === "saved" ? cleanFolder(name) : name.trim().replace(/\s+/g, " ").slice(0, 40)
  const find = (n: string) => lists[of].find((c) => c.name.toLowerCase() === n.toLowerCase())
  const existing = find(clean)
  if (existing) return existing.name
  let stored = ""
  const added: CategorySummary[] = []
  for (const path of of === "saved" ? ancestry(clean) : [clean]) {
    // The part this step adds, after the parents as already spelled.
    const next = stored ? `${stored}${path.slice(stored.length)}` : path
    const known = find(next) ?? added.find((c) => c.name.toLowerCase() === next.toLowerCase())
    stored = known?.name ?? next
    if (!known) added.push({ name: stored, count: 0 })
  }
  set(of, [...lists[of], ...added])
  fetch(URLS[of], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: clean }),
  }).catch(() => {})
  return stored
}

/** Changes the list at once, ahead of the server (which the next refresh reads). */
export function changeCategories(of: Categories, change: (list: CategorySummary[]) => CategorySummary[]) {
  set(of, change(lists[of]))
}
