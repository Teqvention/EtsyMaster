import type { ListingShop } from "@/lib/etsy/types"
import {
  countTags,
  hasPrimary,
  hasSecondary,
  joinTags,
  primarySpelling,
  sameTag,
  secondarySpelling,
  tagName,
  tagUnder,
  withPrimary,
  withSecondary,
  type PrimaryTag,
  type TagCount,
} from "@/lib/tags"

import type { ShopAnalysisSummary, ShopHistory, ShopTag, ShopVisit } from "./types"

// The Shops page's list changes one small step at a time: a shop viewed, an
// analysis summed up, a tag set, a like, a shop removed. The browser shows a
// step at once and sends it; the server applies it to the list in the
// database, in one transaction, so steps from any tab or address all land.
// Shared by both, so they agree on what each step does.

/** Shops kept that are neither tagged nor liked; those are never dropped. */
export const MAX_SHOPS = 2000

export type ShopOp =
  | { type: "visit"; shop: ListingShop; at: string }
  | { type: "analysis"; shop: ListingShop; analysis: ShopAnalysisSummary }
  /** `primary` null takes the shops' tags off; a name makes it their only primary tag (as before several were possible). */
  | { type: "tag"; shops: ListingShop[]; primary: string | null; at: string }
  /** Puts a primary tag on the shops, next to the ones they carry, or takes it off with its secondary ones. */
  | { type: "primary"; shops: ListingShop[]; primary: string; on: boolean; at: string }
  | { type: "secondary"; shops: ListingShop[]; primary: string; secondary: string; on: boolean; at: string }
  | { type: "like"; shop: ListingShop; liked: boolean; at: string }
  | { type: "forget"; shopId: number }

export function applyOps(history: ShopHistory, ops: ShopOp[]): ShopHistory {
  const next: ShopHistory = { ...history }
  for (const op of ops) applyOp(next, op)
  return trim(next)
}

function applyOp(list: ShopHistory, op: ShopOp) {
  const blank = (shop: ListingShop, at: string): ShopVisit => ({ shop, viewedAt: at, analysis: null })
  switch (op.type) {
    case "visit": {
      const current = list[op.shop.id]
      list[op.shop.id] = { ...current, shop: op.shop, viewedAt: op.at, analysis: current?.analysis ?? null }
      return
    }
    case "analysis": {
      const current = list[op.shop.id]
      list[op.shop.id] = {
        ...current,
        shop: op.shop,
        viewedAt: current?.viewedAt ?? op.analysis.analysedAt,
        analysis: op.analysis,
      }
      return
    }
    case "tag": {
      const name = op.primary === null ? null : tagName(op.primary)
      if (name === "") return
      // A tag in use already keeps the spelling it was first given.
      const spelling = name && primarySpelling(shopTags(list), name)
      for (const shop of op.shops) {
        const visit = list[shop.id] ?? blank(shop, op.at)
        // Moving to another primary tag leaves the secondary ones behind.
        const kept = spelling ? tagUnder(tagsOf(visit), spelling) : undefined
        list[shop.id] = withTags(visit, spelling ? [{ primary: spelling, secondary: kept?.secondary ?? [] }] : [], op.at)
      }
      return
    }
    case "primary": {
      const name = tagName(op.primary)
      if (!name) return
      const spelling = primarySpelling(shopTags(list), name)
      for (const shop of op.shops) {
        const visit = list[shop.id] ?? blank(shop, op.at)
        list[shop.id] = withTags(visit, withPrimary(tagsOf(visit), spelling, op.on), op.at)
      }
      return
    }
    case "secondary": {
      const name = tagName(op.secondary)
      if (!name) return
      const spelling = secondarySpelling(shopTags(list), op.primary, name)
      for (const shop of op.shops) {
        const visit = list[shop.id]
        // Only on shops filed under that primary tag.
        if (!visit || !hasPrimary(tagsOf(visit), op.primary)) continue
        list[shop.id] = withTags(visit, withSecondary(tagsOf(visit), op.primary, spelling, op.on), op.at)
      }
      return
    }
    case "like": {
      const { likedAt, ...visit } = list[op.shop.id] ?? blank(op.shop, op.at)
      list[op.shop.id] = op.liked
        ? { ...visit, likedAt: likedAt ?? op.at, likeChangedAt: op.at }
        : { ...visit, likeChangedAt: op.at }
      return
    }
    case "forget":
      delete list[op.shopId]
      return
  }
}

/** Every tag the shop carries, its first primary tag first. */
export const tagsOf = (visit: ShopVisit | undefined): ShopTag[] => (visit ? joinTags(visit.tag, visit.tags) : [])

/** The visit carrying `tags` (none takes them off), changed `at`. */
function withTags(visit: ShopVisit, tags: ShopTag[], at: string): ShopVisit {
  const next: ShopVisit = { ...visit, tagChangedAt: at }
  delete next.tag
  delete next.tags
  return tags.length ? { ...next, tag: tags[0], tags } : next
}

/** Oldest views fall off once the list is full, unless tagged or liked. */
function trim(list: ShopHistory): ShopHistory {
  const visits = Object.values(list)
  const keep = (v: ShopVisit) => !!v.tag || !!v.likedAt
  if (visits.filter((v) => !keep(v)).length <= MAX_SHOPS) return list
  const dropped = visits
    .filter((v) => !keep(v))
    .sort((a, b) => b.viewedAt.localeCompare(a.viewedAt))
    .slice(MAX_SHOPS)
  const next = { ...list }
  for (const v of dropped) delete next[v.shop.id]
  return next
}

// --- Copies made elsewhere ---

/** Flat labels from before primary tags: the first becomes the primary tag, the rest go under it. */
export function fromLabels(list: ShopHistory): ShopHistory {
  if (!Object.values(list).some((v) => v.labels)) return list
  return Object.fromEntries(
    Object.entries(list).map(([id, { labels, ...visit }]) => [
      id,
      labels?.length && !visit.tag ? { ...visit, tag: { primary: labels[0], secondary: labels.slice(1) } } : visit,
    ])
  )
}

/**
 * Another copy of the list folded in (an older browser's, say), shop by
 * shop: a tag and a like go with whichever copy changed them last (a copy
 * from before those were timed keeps the one it has), the analysis with the
 * newer analysis, the rest with the newer visit. Nothing is removed.
 */
export function mergeHistories(base: ShopHistory, copy: ShopHistory): ShopHistory {
  const merged: ShopHistory = { ...base }
  for (const [key, visit] of Object.entries(fromLabels(copy))) {
    const id = Number(key)
    merged[id] = merged[id] ? mergeVisit(merged[id], visit) : visit
  }
  return trim(merged)
}

/** The copy whose `field` changed last; when neither says, the one that has it set. */
function newer(a: ShopVisit, b: ShopVisit, field: "tagChangedAt" | "likeChangedAt", has: (v: ShopVisit) => boolean) {
  const x = a[field] ?? ""
  const y = b[field] ?? ""
  if (x || y) return y > x ? b : a
  return has(b) && !has(a) ? b : a
}

function mergeVisit(a: ShopVisit, b: ShopVisit): ShopVisit {
  const seen = b.viewedAt > a.viewedAt ? b : a
  const tagged = newer(a, b, "tagChangedAt", (v) => !!v.tag)
  const liked = newer(a, b, "likeChangedAt", (v) => !!v.likedAt)
  const analysed = (b.analysis?.analysedAt ?? "") > (a.analysis?.analysedAt ?? "") ? b : a
  const merged: ShopVisit = {
    ...seen,
    analysis: analysed.analysis,
    tag: tagged.tag,
    tags: tagged.tags,
    tagChangedAt: tagged.tagChangedAt,
    likedAt: liked.likedAt,
    likeChangedAt: liked.likeChangedAt,
  }
  // Unset ones stay out, as in a copy that never had them.
  for (const key of ["tag", "tags", "tagChangedAt", "likedAt", "likeChangedAt"] as const) {
    if (merged[key] === undefined) delete merged[key]
  }
  return merged
}

// --- Tags ---

export { sameTag, tagName }
export type { PrimaryTag, TagCount }

/** Every primary tag in use, A–Z, with how many shops carry it and its secondary tags (A–Z, counted). */
export function shopTags(history: ShopHistory): PrimaryTag[] {
  return countTags(Object.values(history).map(tagsOf))
}

/** Whether the shop carries the primary tag `primary`. */
export const hasPrimaryTag = (visit: ShopVisit | undefined, primary: string) => hasPrimary(tagsOf(visit), primary)

/** Whether the shop carries the secondary tag under `primary` (under any primary tag when that's left out). */
export const hasSecondaryTag = (visit: ShopVisit | undefined, secondary: string, primary?: string) =>
  hasSecondary(tagsOf(visit), secondary, primary)

// --- Checking what the browser sends ---

const isShop = (s: unknown): s is ListingShop =>
  !!s && typeof (s as ListingShop).id === "number" && typeof (s as ListingShop).name === "string"
const isTime = (t: unknown): t is string => typeof t === "string" && !Number.isNaN(Date.parse(t))

export function isShopOp(value: unknown): value is ShopOp {
  const op = value as ShopOp
  if (!op || typeof op !== "object") return false
  switch (op.type) {
    case "visit":
      return isShop(op.shop) && isTime(op.at)
    case "analysis":
      return isShop(op.shop) && !!op.analysis && isTime(op.analysis.analysedAt)
    case "tag":
      return Array.isArray(op.shops) && op.shops.every(isShop) && (op.primary === null || typeof op.primary === "string") && isTime(op.at)
    case "primary":
      return (
        Array.isArray(op.shops) &&
        op.shops.every(isShop) &&
        typeof op.primary === "string" &&
        typeof op.on === "boolean" &&
        isTime(op.at)
      )
    case "secondary":
      return (
        Array.isArray(op.shops) &&
        op.shops.every(isShop) &&
        typeof op.primary === "string" &&
        typeof op.secondary === "string" &&
        typeof op.on === "boolean" &&
        isTime(op.at)
      )
    case "like":
      return isShop(op.shop) && typeof op.liked === "boolean" && isTime(op.at)
    case "forget":
      return Number.isInteger(op.shopId)
    default:
      return false
  }
}

export type { ShopTag }
