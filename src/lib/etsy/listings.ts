import { cacheLife } from "next/cache"

import {
  etsyGet,
  type ApiListing,
  type ApiMoney,
  type ApiPage,
  type ApiShop,
} from "./client"
import { estimateSales, shopSalesCap, withReviewCount } from "./estimate"
import type {
  Category,
  Listing,
  ListingIdPage,
  ListingPage,
  ListingQuery,
  ListingShop,
  ShopListingSort,
} from "./types"

// Live market data from Etsy's public search. Every function is cached: the
// counters behind the estimates move slowly, and the API key has a daily quota.

export const PAGE_SIZE = 48
export const DISPLAY_CURRENCY = process.env.ETSY_CURRENCY ?? "USD"

// Reviews fetched per "top sellers" page: enough to sharpen the ranking, few
// enough to keep the first load under the API's throttle.
const TOP_SELLER_REVIEWS = 20

const DAY_MS = 24 * 60 * 60 * 1000

const SORTS = {
  score: { sort_on: "score", sort_order: "desc" },
  created: { sort_on: "created", sort_order: "desc" },
  "price-asc": { sort_on: "price", sort_order: "asc" },
  "price-desc": { sort_on: "price", sort_order: "desc" },
} as const

export async function searchListings(
  query: ListingQuery,
  offset = 0
): Promise<ListingPage> {
  "use cache"
  cacheLife("hours")

  // "Top sellers" has no Etsy equivalent — Etsy ranks by keyword relevance
  // only, never by sales. Fetch by relevance, then re-rank by our estimate.
  const sort = query.sort === "sales" ? SORTS.score : SORTS[query.sort]

  const page = await etsyGet<ApiPage<ApiListing>>("/listings/active", {
    keywords: query.keywords,
    ...sort,
    taxonomy_id: query.categoryId,
    min_price: query.minPrice,
    max_price: query.maxPrice,
    shop_location: query.shopLocation,
    currency: DISPLAY_CURRENCY,
    limit: PAGE_SIZE,
    offset,
  })

  const listings = await hydrate(page.results)
  return toPage(
    page,
    offset,
    query.sort === "sales" ? await rankBySales(listings) : listings
  )
}

/** The most a single shop or batch request returns. */
export const MAX_PAGE_SIZE = 100

const SHOP_SORTS = {
  created: { sort_on: "created", sort_order: "desc" },
  updated: { sort_on: "updated", sort_order: "desc" },
  "price-desc": { sort_on: "price", sort_order: "desc" },
  score: { sort_on: "score", sort_order: "desc" },
} as const satisfies Record<ShopListingSort, object>

export async function getShopListings(
  shopId: number,
  offset = 0,
  limit = PAGE_SIZE,
  sort: ShopListingSort = "created"
): Promise<ListingPage> {
  "use cache"
  cacheLife("hours")

  const page = await etsyGet<ApiPage<ApiListing>>(
    `/shops/${shopId}/listings/active`,
    { limit: Math.min(limit, MAX_PAGE_SIZE), offset, ...SHOP_SORTS[sort] }
  )

  return toPage(page, offset, await hydrate(page.results))
}

/**
 * One page of a shop's active listings as ids: the shop analysis fetches in
 * full only the ones it doesn't hold yet, so building on an earlier run costs
 * one request per page plus those. `pool` names the accounts to fetch with
 * (the analysis accounts when absent).
 */
export async function getShopListingIds(
  shopId: number,
  offset = 0,
  limit = MAX_PAGE_SIZE,
  sort: ShopListingSort = "created",
  pool?: string[]
): Promise<ListingIdPage> {
  "use cache"
  cacheLife("hours")

  const page = await etsyGet<ApiPage<ApiListing>>(
    `/shops/${shopId}/listings/active`,
    { limit: Math.min(limit, MAX_PAGE_SIZE), offset, ...SHOP_SORTS[sort] },
    pool
  )

  const { total, nextOffset } = toPage(page, offset, [])
  return {
    ids: page.results.map((l) => l.listing_id),
    counts: Object.fromEntries(
      page.results.map((l) => [l.listing_id, { favorites: l.num_favorers, views: l.views ?? 0 }])
    ),
    total,
    nextOffset,
  }
}

/**
 * Listings in full by id (at most 100), in the order given; ones Etsy no
 * longer has are left out. `pool` as for `getShopListingIds`.
 */
export async function getListingsById(ids: number[], pool?: string[]): Promise<Listing[]> {
  "use cache"
  cacheLife("hours")

  return hydrate(ids.slice(0, MAX_PAGE_SIZE).map((listing_id) => ({ listing_id })), pool)
}

/** A single listing, plus its review count — which sharpens the estimate. */
export async function getListing(listingId: number): Promise<Listing | null> {
  "use cache"
  cacheLife("hours")

  const [[listing], reviews] = await Promise.all([
    hydrate([{ listing_id: listingId }]),
    etsyGet<ApiPage<unknown>>(`/listings/${listingId}/reviews`, { limit: 1 }),
  ])
  if (!listing) return null

  return withReviewCount(listing, reviews.count)
}

export async function getCategories(): Promise<Category[]> {
  "use cache"
  cacheLife("weeks")

  const nodes = await etsyGet<ApiPage<{ id: number; name: string }>>(
    "/buyer-taxonomy/nodes"
  )
  return nodes.results.map(({ id, name }) => ({ id, name }))
}

// Search and shop endpoints return bare listings; the batch endpoint adds the
// images and the shop (whose lifetime sales cap our estimate). One extra
// request per page instead of one per listing.
async function hydrate(results: Pick<ApiListing, "listing_id">[], pool?: string[]) {
  if (results.length === 0) return []

  const batch = await etsyGet<ApiPage<ApiListing>>(
    "/listings/batch",
    {
      listing_ids: results.map((r) => r.listing_id).join(","),
      includes: "Images,Shop",
      currency: DISPLAY_CURRENCY,
    },
    pool
  )

  // The batch endpoint doesn't promise order; keep the search ranking.
  const byId = new Map(batch.results.map((l) => [l.listing_id, l]))
  return results.flatMap((r) => {
    const listing = byId.get(r.listing_id)
    return listing ? [toListing(listing)] : []
  })
}

// "Top sellers": relevance puts the highest-selling listings anywhere in the
// ranking, so we sharpen the best candidates' estimates with their review
// count (the strongest public signal, absent from the batch payload) and
// re-rank the page by sales per month. Reviews cost one request per listing,
// so only the top slice by the cheap favorites+views estimate gets them.
async function rankBySales(listings: Listing[]): Promise<Listing[]> {
  const candidates = [...listings]
    .sort((a, b) => b.estimate.salesPerMonth - a.estimate.salesPerMonth)
    .slice(0, TOP_SELLER_REVIEWS)

  const sharpened = new Map<number, Listing>()
  await Promise.all(
    candidates.map(async (listing) => {
      try {
        const reviews = await etsyGet<ApiPage<unknown>>(
          `/listings/${listing.id}/reviews`,
          { limit: 1 }
        )
        sharpened.set(listing.id, withReviewCount(listing, reviews.count))
      } catch {
        // Keep the favorites+views-only estimate.
      }
    })
  )

  return listings
    .map((listing) => sharpened.get(listing.id) ?? listing)
    .sort((a, b) => b.estimate.salesPerMonth - a.estimate.salesPerMonth)
}

function toPage(
  page: ApiPage<ApiListing>,
  offset: number,
  listings: Listing[]
): ListingPage {
  const next = offset + page.results.length
  return {
    listings,
    total: page.count,
    nextOffset: page.results.length > 0 && next < page.count ? next : null,
  }
}

function toCents(money: ApiMoney) {
  return Math.round((money.amount * 100) / money.divisor)
}

export function toShop(shop: ApiShop): ListingShop {
  return {
    id: shop.shop_id,
    name: shop.shop_name,
    url: shop.url,
    iconUrl: shop.icon_url_fullxfull,
    totalSales: shop.transaction_sold_count,
    activeListings: shop.listing_active_count,
    favorites: shop.num_favorers,
    reviewCount: shop.review_count ?? 0,
    reviewAverage: shop.review_average ?? 0,
    country: shop.shop_location_country_iso ?? shop.shipping_from_country_iso,
    openedAt: new Date(shop.create_date * 1000).toISOString(),
  }
}

function toListing(api: ApiListing): Listing {
  const display = api.converted_price ?? api.price
  const priceCents = toCents(display)
  const createdMs = api.original_creation_timestamp * 1000
  const ageDays = Math.max(0, (Date.now() - createdMs) / DAY_MS)
  const shop = api.shop ? toShop(api.shop) : null
  const images = [...(api.images ?? [])].sort((a, b) => a.rank - b.rank)
  const views = api.views ?? 0

  return {
    id: api.listing_id,
    title: decodeEntities(api.title),
    url: api.url,
    priceCents,
    currency: display.currency_code,
    originalPrice:
      api.price.currency_code === display.currency_code
        ? null
        : { cents: toCents(api.price), currency: api.price.currency_code },
    images: images.map((img) => ({
      thumb: img.url_170x135,
      medium: img.url_570xN,
      full: img.url_fullxfull,
    })),
    color: images[0]?.hex_code ? `#${images[0].hex_code}` : null,
    favorites: api.num_favorers,
    views,
    reviewCount: null,
    quantity: api.quantity,
    tags: api.tags,
    materials: api.materials,
    isPersonalizable: api.is_personalizable,
    isDigital: api.listing_type === "download",
    createdAt: new Date(createdMs).toISOString(),
    updatedAt: new Date(api.last_modified_timestamp * 1000).toISOString(),
    ageDays,
    shopId: api.shop_id,
    shop,
    estimate: estimateSales({
      priceCents,
      favorites: api.num_favorers,
      views,
      reviewCount: null,
      ageDays,
      shopTotalSales: shopSalesCap(shop),
    }),
  }
}

// Titles arrive HTML-escaped (`&quot;`, `&#39;`, `&amp;`).
function decodeEntities(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}
