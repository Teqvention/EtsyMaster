import type { ListingShop } from "@/lib/etsy/types"

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
  /** `primary` null takes the shops' tags off. */
  | { type: "tag"; shops: ListingShop[]; primary: string | null; at: string }
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
      const spelling = name && (shopTags(list).find((t) => sameTag(t.name, name))?.name ?? name)
      for (const shop of op.shops) {
        const { tag, ...visit } = list[shop.id] ?? blank(shop, op.at)
        list[shop.id] = spelling
          ? {
              ...visit,
              // Moving to another primary tag leaves the secondary ones behind.
              tag: { primary: spelling, secondary: tag && sameTag(tag.primary, spelling) ? tag.secondary : [] },
              tagChangedAt: op.at,
            }
          : { ...visit, tagChangedAt: op.at }
      }
      return
    }
    case "secondary": {
      const name = tagName(op.secondary)
      if (!name) return
      const spelling =
        shopTags(list)
          .find((t) => sameTag(t.name, op.primary))
          ?.secondary.find((s) => sameTag(s.name, name))?.name ?? name
      for (const shop of op.shops) {
        const visit = list[shop.id]
        // Only on shops filed under that primary tag.
        if (!visit?.tag || !sameTag(visit.tag.primary, op.primary)) continue
        const others = visit.tag.secondary.filter((s) => !sameTag(s, spelling))
        list[shop.id] = {
          ...visit,
          tag: { ...visit.tag, secondary: op.on ? [...others, spelling] : others },
          tagChangedAt: op.at,
        }
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
    tagChangedAt: tagged.tagChangedAt,
    likedAt: liked.likedAt,
    likeChangedAt: liked.likeChangedAt,
  }
  // Unset ones stay out, as in a copy that never had them.
  for (const key of ["tag", "tagChangedAt", "likedAt", "likeChangedAt"] as const) {
    if (merged[key] === undefined) delete merged[key]
  }
  return merged
}

// --- Tags ---

export type TagCount = { name: string; count: number }
/** A primary tag in use, with its secondary tags. */
export type PrimaryTag = TagCount & { secondary: TagCount[] }

export const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** What a typed tag is saved as: single spaces, at most 32 characters. */
export const tagName = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, 32)

/** Every primary tag in use, A–Z, with how many shops carry it and its secondary tags (A–Z, counted). */
export function shopTags(history: ShopHistory): PrimaryTag[] {
  const primaries = new Map<string, { name: string; count: number; secondary: Map<string, TagCount> }>()
  for (const { tag } of Object.values(history)) {
    if (!tag) continue
    const key = tag.primary.toLowerCase()
    const primary = primaries.get(key) ?? { name: tag.primary, count: 0, secondary: new Map() }
    primary.count += 1
    for (const name of tag.secondary) {
      const held = primary.secondary.get(name.toLowerCase()) ?? { name, count: 0 }
      primary.secondary.set(name.toLowerCase(), { ...held, count: held.count + 1 })
    }
    primaries.set(key, primary)
  }
  const byName = (a: TagCount, b: TagCount) => a.name.localeCompare(b.name)
  return [...primaries.values()]
    .map((p) => ({ name: p.name, count: p.count, secondary: [...p.secondary.values()].sort(byName) }))
    .sort(byName)
}

/** Whether the shop's primary tag is `primary`. */
export const hasPrimaryTag = (visit: ShopVisit | undefined, primary: string) =>
  !!visit?.tag && sameTag(visit.tag.primary, primary)

/** Whether the shop carries the secondary tag (under whichever primary tag it has). */
export const hasSecondaryTag = (visit: ShopVisit | undefined, secondary: string) =>
  visit?.tag?.secondary.some((s) => sameTag(s, secondary)) ?? false

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
