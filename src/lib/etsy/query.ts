import type { ListingQuery, ListingSort } from "./types"

// URL <-> ListingQuery, shared by the search page (which keeps filters in the
// address bar) and the API route (which reads them back).

const SORTS: ListingSort[] = ["score", "sales", "created", "price-asc", "price-desc"]

type ParamSource = { get(name: string): string | null }

function toNumber(value: string | null) {
  if (!value) return undefined
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export function parseListingQuery(params: ParamSource): ListingQuery {
  const sort = params.get("sort") as ListingSort | null
  return {
    keywords: params.get("q")?.trim() ?? "",
    sort: sort && SORTS.includes(sort) ? sort : "score",
    categoryId: toNumber(params.get("category")),
    minPrice: toNumber(params.get("min")),
    maxPrice: toNumber(params.get("max")),
    shopLocation: params.get("loc")?.trim() || undefined,
  }
}

export function listingQueryToParams(query: ListingQuery) {
  const params = new URLSearchParams()
  if (query.keywords) params.set("q", query.keywords)
  if (query.sort !== "score") params.set("sort", query.sort)
  if (query.categoryId !== undefined) params.set("category", String(query.categoryId))
  if (query.minPrice !== undefined) params.set("min", String(query.minPrice))
  if (query.maxPrice !== undefined) params.set("max", String(query.maxPrice))
  if (query.shopLocation) params.set("loc", query.shopLocation)
  return params
}
