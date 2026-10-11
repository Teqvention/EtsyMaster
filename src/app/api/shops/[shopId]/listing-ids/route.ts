import { getShopListingIds, MAX_PAGE_SIZE } from "@/lib/etsy/listings"
import { poolParam, respond } from "@/lib/etsy/respond"
import type { ShopListingSort } from "@/lib/etsy/types"

const SORTS: ShopListingSort[] = ["created", "updated", "price-desc", "score"]

// One page of a shop's active listing ids, for the shop analysis: it fetches
// in full (`/api/listings/batch`) only the listings it doesn't hold yet.
// `accounts` names the Etsy accounts to fetch with (see `poolParam`).
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/shops/[shopId]/listing-ids">
) {
  const id = Number((await params).shopId)
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Invalid shop id" }, { status: 400 })
  }
  const search = new URL(request.url).searchParams
  const offset = Number(search.get("offset")) || 0
  const limit = Number(search.get("limit")) || MAX_PAGE_SIZE
  const sort = search.get("sort") as ShopListingSort | null
  return respond(() =>
    getShopListingIds(id, offset, limit, sort && SORTS.includes(sort) ? sort : "created", poolParam(search))
  )
}
