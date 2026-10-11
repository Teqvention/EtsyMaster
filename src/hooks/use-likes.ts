"use client"

import * as React from "react"

import type { Listing } from "@/lib/etsy/types"
import { applyLikeOps, type LikeOp, type Likes } from "@/lib/likes/ops"
import { createSyncedStore } from "@/lib/synced-store"

export type { LikedListing } from "@/lib/likes/ops"

// Liked listings, kept in the database with a snapshot of each listing so the
// Liked page renders without any API calls; every change goes there as a step
// (see `synced-store.ts`). Likes an older version kept in the browser alone
// are folded in once.

// Plenty for the detail gallery, and keeps hundreds of likes small.
const MAX_STORED_IMAGES = 4
const EMPTY: Likes = {}

const { read, subscribe, change } = createSyncedStore<Likes, LikeOp>({
  api: "/api/likes",
  key: "etsy-research:liked",
  legacyKey: "etsy-research:liked",
  empty: EMPTY,
  apply: applyLikeOps,
  what: "your likes",
})

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
  if (read()[listing.id]) change({ type: "unlike", listingId: listing.id })
  else change({ type: "like", listing: snapshot(listing), at: new Date().toISOString() })
}

/** Refreshes the stored snapshot (e.g. once reviews are known), if liked. */
export function refreshLiked(listing: Listing) {
  if (read()[listing.id]) change({ type: "refresh", listing: snapshot(listing) })
}
