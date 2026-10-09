"use client"

import * as React from "react"

import type { Listing, ListingShop } from "@/lib/etsy/types"
import { toLibraryRequest, type LibraryOverview } from "@/lib/keywords/types"

// The keyword library as the browser sees it: the Keywords page's overview,
// and whether a shop is in it, for the button in the shop header. Both read
// from one store, so adding a shop shows on the Keywords page without a reload.

export type Membership = { updatedAt: string; listings: number }

const listeners = new Set<() => void>()
let library: LibraryOverview | null = null
let loading: Promise<void> | null = null
/** Per shop: its membership, null when it isn't in the library, absent until asked. */
const members = new Map<number, Membership | null>()
const asking = new Set<number>()

function notify() {
  listeners.forEach((n) => n())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setLibrary(next: LibraryOverview) {
  library = next
  // The overview lists every shop in the library, so it answers membership too.
  for (const [id] of members) members.set(id, null)
  for (const shop of next.shops) {
    members.set(shop.id, { updatedAt: shop.updatedAt, listings: shop.listings })
  }
  notify()
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? res.statusText)
  return data as T
}

export function refreshLibrary() {
  loading ??= request<LibraryOverview>("/api/keywords")
    .then(setLibrary)
    .finally(() => {
      loading = null
    })
  return loading
}

/** The library's overview; null until loaded. */
export function useKeywordLibrary() {
  const overview = React.useSyncExternalStore(subscribe, () => library, () => null)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    refreshLibrary().catch((e: Error) => setError(e.message))
  }, [])
  return { library: overview, error }
}

/** Whether the shop is in the library: undefined while asking. */
export function useLibraryMembership(shopId: number) {
  const membership = React.useSyncExternalStore(
    subscribe,
    () => members.get(shopId),
    () => undefined
  )
  React.useEffect(() => {
    if (members.has(shopId) || asking.has(shopId)) return
    asking.add(shopId)
    fetch(`/api/keywords/shops/${shopId}`, { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 404) return null
        if (!res.ok) throw new Error(res.statusText)
        return (await res.json()) as Membership
      })
      .then((found) => {
        members.set(shopId, found)
        notify()
      })
      .catch((error) => console.error("Keyword library:", error))
      .finally(() => asking.delete(shopId))
  }, [shopId])
  return membership
}

/** Adds the shop with its analysed listings, or replaces what the library had of it. */
export async function addToLibrary(shop: ListingShop, listings: Listing[]) {
  const next = await request<LibraryOverview>("/api/keywords", {
    method: "POST",
    body: JSON.stringify(toLibraryRequest(shop, listings)),
  })
  setLibrary(next)
  return next
}

export async function removeFromLibrary(shopId: number) {
  const next = await request<LibraryOverview>("/api/keywords", {
    method: "DELETE",
    body: JSON.stringify({ shopId }),
  })
  setLibrary(next)
  return next
}

/** Asks Gemini to read the library; takes a while. */
export async function analyseLibrary() {
  const next = await request<LibraryOverview>("/api/keywords/analysis", { method: "POST" })
  setLibrary(next)
  return next
}
