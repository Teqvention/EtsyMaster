"use client"

import * as React from "react"

import type { Listing } from "@/lib/etsy/types"

// Liked listings live in localStorage: no account needed, and each entry keeps
// a snapshot of the listing so the Liked page renders without any API calls.
// Other tabs stay in sync through the `storage` event.

export type LikedListing = { listing: Listing; likedAt: string }
type Likes = Record<number, LikedListing>

const STORAGE_KEY = "etsy-research:liked"
// Plenty for the detail gallery, and keeps hundreds of likes well under quota.
const MAX_STORED_IMAGES = 4
const EMPTY: Likes = {}

const listeners = new Set<() => void>()
let raw: string | null = null
let likes: Likes = EMPTY

function read(): Likes {
  const next = localStorage.getItem(STORAGE_KEY)
  if (next !== raw) {
    raw = next
    try {
      likes = next ? (JSON.parse(next) as Likes) : EMPTY
    } catch {
      likes = EMPTY
    }
  }
  return likes
}

function write(next: Likes) {
  raw = JSON.stringify(next)
  likes = next
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

function snapshot(listing: Listing): Listing {
  return { ...listing, images: listing.images.slice(0, MAX_STORED_IMAGES) }
}

export function useLikes() {
  return React.useSyncExternalStore(subscribe, read, () => EMPTY)
}

export function useIsLiked(listingId: number) {
  return React.useSyncExternalStore(
    subscribe,
    () => listingId in read(),
    () => false
  )
}

export function toggleLike(listing: Listing) {
  const { [listing.id]: existing, ...rest } = read()
  if (existing) write(rest)
  else
    write({
      ...rest,
      [listing.id]: { listing: snapshot(listing), likedAt: new Date().toISOString() },
    })
}

/** Refreshes the stored snapshot (e.g. once reviews are known), if liked. */
export function refreshLiked(listing: Listing) {
  const current = read()
  const existing = current[listing.id]
  if (!existing) return
  write({ ...current, [listing.id]: { ...existing, listing: snapshot(listing) } })
}
