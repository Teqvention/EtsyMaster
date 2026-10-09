import { getShopListings, PAGE_SIZE } from "@/lib/etsy/listings"
import { respond } from "@/lib/etsy/respond"
import type { ShopListingSort } from "@/lib/etsy/types"

const SORTS: ShopListingSort[] = ["created", "updated", "price-desc", "score"]

// One page of a shop's active listings: the detail panel's "more from" (the
// defaults), and the shop analysis (bigger pages, in a chosen order).
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/shops/[shopId]/listings">
) {
  const id = Number((await params).shopId)
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Invalid shop id" }, { status: 400 })
  }
  const search = new URL(request.url).searchParams
  const offset = Number(search.get("offset")) || 0
  const limit = Number(search.get("limit")) || PAGE_SIZE
  const sort = search.get("sort") as ShopListingSort | null
  return respond(() =>
    getShopListings(id, offset, limit, sort && SORTS.includes(sort) ? sort : "created")
  )
}
