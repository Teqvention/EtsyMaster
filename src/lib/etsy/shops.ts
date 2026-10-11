import { cacheLife } from "next/cache"

import { etsyGet, type ApiPage, type ApiReview, type ApiShop } from "./client"
import { MAX_PAGE_SIZE, toShop } from "./listings"
import type { ListingShop, ShopReviewPage } from "./types"

// Whole-shop data for the shop analysis: finding a shop by name, and paging
// through its buyer reviews. Listings come from `getShopListings`.

/**
 * A shop by numeric id, name, or any etsy.com/shop/<name> URL. Etsy's name
 * search is fuzzy, so only an exact (case-insensitive) match counts.
 */
export async function findShop(input: string): Promise<ListingShop | null> {
  "use cache"
  cacheLife("hours")

  const query = parseShopInput(input)
  if (!query) return null

  if ("id" in query) {
    return toShop(await etsyGet<ApiShop>(`/shops/${query.id}`))
  }

  const page = await etsyGet<ApiPage<ApiShop>>("/shops", {
    shop_name: query.name,
    limit: 25,
  })
  const name = query.name.toLowerCase()
  const shop = page.results.find((s) => s.shop_name.toLowerCase() === name)
  return shop ? toShop(shop) : null
}

function parseShopInput(input: string): { id: number } | { name: string } | null {
  const text = input.trim()
  if (/^\d+$/.test(text)) return { id: Number(text) }

  const fromUrl = text.match(/etsy\.com\/(?:[a-z-]+\/)?shop\/([A-Za-z0-9]+)/i)
  const name = fromUrl?.[1] ?? text
  // Shop names are 4–20 letters and digits, nothing else.
  return /^[A-Za-z0-9]{2,40}$/.test(name) ? { name } : null
}

/**
 * One page of a shop's reviews, newest first, optionally only those since
 * `since` (Unix seconds — round it so the cache key holds still). `pool`
 * names the accounts to fetch with (the analysis accounts when absent).
 */
export async function getShopReviews(
  shopId: number,
  offset = 0,
  since?: number,
  pool?: string[]
): Promise<ShopReviewPage> {
  "use cache"
  cacheLife("hours")

  const page = await etsyGet<ApiPage<ApiReview>>(
    `/shops/${shopId}/reviews`,
    { limit: MAX_PAGE_SIZE, offset, min_created: since },
    pool
  )

  const next = offset + page.results.length
  return {
    reviews: page.results.map((r) => ({
      listingId: r.listing_id,
      rating: r.rating,
      createdAt: r.created_timestamp * 1000,
    })),
    total: page.count,
    nextOffset: page.results.length > 0 && next < page.count ? next : null,
  }
}
