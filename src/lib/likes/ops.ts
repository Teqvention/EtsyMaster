import type { Listing } from "@/lib/etsy/types"

// Liked listings, each with a snapshot of the listing so the Liked page
// renders without the Etsy API. Changed one step at a time, by the browser
// and the server alike (see `synced-store.ts`); kept in the document "liked".

export type LikedListing = { listing: Listing; likedAt: string }
export type Likes = Record<number, LikedListing>

export type LikeOp =
  | { type: "like"; listing: Listing; at: string }
  | { type: "unlike"; listingId: number }
  /** A fresher snapshot of a liked listing (e.g. once its reviews are known). */
  | { type: "refresh"; listing: Listing }

export function applyLikeOps(likes: Likes, ops: LikeOp[]): Likes {
  const next = { ...likes }
  for (const op of ops) {
    if (op.type === "like") next[op.listing.id] = { listing: op.listing, likedAt: next[op.listing.id]?.likedAt ?? op.at }
    else if (op.type === "unlike") delete next[op.listingId]
    else if (next[op.listing.id]) next[op.listing.id] = { ...next[op.listing.id], listing: op.listing }
  }
  return next
}

/** A copy kept elsewhere folded in: every like in either, liked when first liked. */
export function mergeLikes(base: Likes, copy: Likes): Likes {
  const next = { ...base }
  for (const [key, liked] of Object.entries(copy)) {
    const id = Number(key)
    const held = next[id]
    next[id] = !held ? liked : liked.likedAt < held.likedAt ? { ...held, likedAt: liked.likedAt } : held
  }
  return next
}

const isListing = (l: unknown): l is Listing =>
  !!l && Number.isInteger((l as Listing).id) && typeof (l as Listing).title === "string"

export function isLikeOp(value: unknown): value is LikeOp {
  const op = value as LikeOp
  if (!op || typeof op !== "object") return false
  if (op.type === "like") return isListing(op.listing) && typeof op.at === "string" && !Number.isNaN(Date.parse(op.at))
  if (op.type === "unlike") return Number.isInteger(op.listingId)
  if (op.type === "refresh") return isListing(op.listing)
  return false
}

export function isLikes(value: unknown): value is Likes {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => isListing((v as LikedListing)?.listing) && typeof (v as LikedListing).likedAt === "string")
  )
}
