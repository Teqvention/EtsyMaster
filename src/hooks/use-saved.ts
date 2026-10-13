"use client"

import * as React from "react"

import { changeCategories, refreshCategories } from "@/hooks/use-categories"
import type { Listing } from "@/lib/etsy/types"
import { isWithin, movedFolder } from "@/lib/saved/folders"
import type { SavedListing, SaveRequest } from "@/lib/saved/types"

// Listings filed into folders, for the shop gallery's badges and the Saved
// page. Loaded once per session; every change shows at once and the server's
// answer then replaces it (or the change is undone when it fails).

const listeners = new Set<() => void>()
let saved: SavedListing[] | null = null
let byListing = new Map<number, SavedListing>()
let loading: Promise<void> | null = null

function set(next: SavedListing[]) {
  saved = next
  byListing = new Map(next.map((s) => [s.listingId, s]))
  listeners.forEach((notify) => notify())
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  if (saved === null) refreshSaved()
  return () => {
    listeners.delete(notify)
  }
}

/** Null until loaded. */
export function useSaved() {
  return React.useSyncExternalStore(subscribe, () => saved, () => null)
}

/** The folder the listing is saved in, if any. */
export function useSavedFolder(listingId: number) {
  return React.useSyncExternalStore(
    subscribe,
    () => byListing.get(listingId)?.folder ?? null,
    () => null
  )
}

export function refreshSaved() {
  loading ??= fetch("/api/saved", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then(set)
    .catch(() => {
      if (saved === null) set([])
    })
    .finally(() => {
      loading = null
    })
  return loading
}

export function toSaveRequest(listing: Listing): SaveRequest {
  const photo = listing.images[0]
  return {
    listingId: listing.id,
    title: listing.title,
    url: listing.url,
    image: photo?.full ?? "",
    thumb: photo?.medium ?? "",
    color: listing.color,
    shop: listing.shop?.name ?? null,
    priceCents: listing.priceCents,
    currency: listing.currency,
    salesPerMonth: listing.estimate.salesPerMonth,
    tags: listing.tags,
    photos: listing.images.map((i) => i.full),
  }
}

/** Files the listings into `folder`, moving any saved in another. */
export function saveToFolder(listings: SaveRequest[], folder: string) {
  const ids = new Set(listings.map((l) => l.listingId))
  const savedAt = new Date().toISOString()
  return change(
    (list) => [...listings.map((l) => ({ ...l, folder, savedAt })), ...list.filter((s) => !ids.has(s.listingId))],
    { method: "POST", body: JSON.stringify({ folder, listings }) }
  )
}

export function removeFromSaved(listingIds: number[]) {
  const ids = new Set(listingIds)
  return change((list) => list.filter((s) => !ids.has(s.listingId)), {
    method: "DELETE",
    body: JSON.stringify({ ids: listingIds }),
  })
}

async function change(apply: (list: SavedListing[]) => SavedListing[], init: RequestInit) {
  await (loading ?? (saved === null ? refreshSaved() : null))
  const before = saved ?? []
  set(apply(before))
  try {
    const response = await fetch("/api/saved", {
      ...init,
      headers: { "Content-Type": "application/json" },
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? response.statusText)
    set(result)
  } catch (error) {
    set(before)
    throw error
  }
}

/**
 * Moves (or renames) a folder with everything in it to the path `to`, into a
 * folder of that name if there is one. Shows at once; answers the new path.
 */
export async function moveSavedFolder(from: string, to: string) {
  await (loading ?? (saved === null ? refreshSaved() : null))
  const before = saved ?? []
  const move = (path: string) => movedFolder(path, from, to)
  set(before.map((s) => (isWithin(s.folder, from) ? { ...s, folder: move(s.folder) } : s)))
  changeCategories("saved", (list) => {
    const kept = new Map<string, { name: string; count: number }>()
    for (const c of list) {
      const name = move(c.name)
      kept.set(name.toLowerCase(), { name, count: (kept.get(name.toLowerCase())?.count ?? 0) + c.count })
    }
    return [...kept.values()]
  })
  try {
    const response = await fetch("/api/saved/folders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? response.statusText)
    set(result.saved)
    return result.name as string
  } catch (error) {
    set(before)
    throw error
  } finally {
    refreshCategories("saved")
  }
}

/** Takes away an empty folder, and the empty folders in it. */
export async function deleteSavedFolder(name: string) {
  changeCategories("saved", (list) => list.filter((c) => !isWithin(c.name, name)))
  try {
    const response = await fetch("/api/saved/folders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? response.statusText)
  } finally {
    refreshCategories("saved")
  }
}

/** Where each of `listingIds` is saved right now (null: not saved), to put back later. */
export type SavedSnapshot = { listingId: number; entry: SavedListing | null }[]

export function snapshotSaved(listingIds: Iterable<number>): SavedSnapshot {
  return [...listingIds].map((listingId) => ({ listingId, entry: byListing.get(listingId) ?? null }))
}

/** Puts the listings back where `snapshot` found them: in their old folder, or out of Saved. */
export async function restoreSaved(snapshot: SavedSnapshot) {
  const folders = new Map<string, SaveRequest[]>()
  const unsaved: number[] = []
  for (const { listingId, entry } of snapshot) {
    if (!entry) {
      unsaved.push(listingId)
      continue
    }
    const { folder, ...rest } = entry
    const request: SaveRequest & { savedAt?: string } = { ...rest }
    delete request.savedAt
    folders.set(folder, [...(folders.get(folder) ?? []), request])
  }
  for (const [folder, listings] of folders) await saveToFolder(listings, folder)
  if (unsaved.length) await removeFromSaved(unsaved)
}

/**
 * Files each group into its folder, one request per folder, and returns how
 * to undo all of it.
 */
export async function fileInFolders(groups: { folder: string; listings: SaveRequest[] }[]) {
  const before = snapshotSaved(groups.flatMap((g) => g.listings.map((l) => l.listingId)))
  for (const { folder, listings } of groups) {
    if (listings.length) await saveToFolder(listings, folder)
  }
  return () => restoreSaved(before)
}
