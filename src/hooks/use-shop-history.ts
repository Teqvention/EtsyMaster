"use client"

import * as React from "react"

import type { ListingShop } from "@/lib/etsy/types"
import {
  applyOps,
  fromLabels,
  hasPrimaryTag,
  hasSecondaryTag,
  shopTags,
  tagName,
  type ShopOp,
} from "@/lib/shops/history-ops"
import type { ShopAnalysisSummary, ShopHistory as History, ShopVisit } from "@/lib/shops/types"
import { createSyncedStore } from "@/lib/synced-store"

export type { PrimaryTag, TagCount } from "@/lib/shops/history-ops"
export type { ShopAnalysisSummary, ShopTag, ShopVisit } from "@/lib/shops/types"
export { hasPrimaryTag, hasSecondaryTag, shopTags, tagName }

// Shops looked up on the Shops page. Each entry holds the shop as last seen,
// a summary of its last analysis, the tags it's filed under (a primary one
// and secondary ones beneath it) and whether it's liked, so the list renders
// without API calls and reopening a shop can pick up the scope it was
// analysed with. The database holds it; every change goes there as a step
// (see `history-ops.ts` and `synced-store.ts`). The list an older version
// kept in the browser alone is folded into the server's once.

const EMPTY: History = {}

const store = createSyncedStore<History, ShopOp>({
  api: "/api/shops/history",
  key: "etsy-research:shops",
  legacyKey: "etsy-research:shops",
  empty: EMPTY,
  apply: applyOps,
  fromLegacy: (legacy) => fromLabels(legacy as History),
  what: "the shop list",
})

const { read, subscribe, change } = store

export function useShopHistory() {
  return React.useSyncExternalStore(subscribe, read, () => EMPTY)
}

/** The visit for a shop, read once (e.g. to seed state). */
export function getShopVisit(shopId: number): ShopVisit | null {
  return read()[shopId] ?? null
}

const now = () => new Date().toISOString()

export function recordShopVisit(shop: ListingShop) {
  change({ type: "visit", shop, at: now() })
}

export function recordShopAnalysis(shop: ListingShop, analysis: ShopAnalysisSummary) {
  change({ type: "analysis", shop, analysis })
}

// --- Tags ---

export function useShopTags() {
  const history = useShopHistory()
  return React.useMemo(() => shopTags(history), [history])
}

/**
 * Files the shops under the primary tag, or (null) takes their tags off. A
 * shop moving to another primary tag leaves its secondary ones behind; a tag
 * in use already keeps the spelling it was first given.
 */
export function setPrimaryTag(shops: ListingShop[], primary: string | null) {
  if (primary !== null && !tagName(primary)) return
  change({ type: "tag", shops, primary, at: now() })
}

/** Puts the secondary tag on the shops filed under `primary`, or takes it off them. */
export function setSecondaryTag(shops: ListingShop[], primary: string, secondary: string, on: boolean) {
  if (!tagName(secondary)) return
  change({ type: "secondary", shops, primary, secondary, on, at: now() })
}

// --- Likes ---

export function useIsShopLiked(shopId: number) {
  return React.useSyncExternalStore(
    subscribe,
    () => !!read()[shopId]?.likedAt,
    () => false
  )
}

/** Likes the shop, or takes the like back. */
export function toggleShopLike(shop: ListingShop) {
  change({ type: "like", shop, liked: !read()[shop.id]?.likedAt, at: now() })
}

export function forgetShop(shopId: number) {
  change({ type: "forget", shopId })
}
