import { respond } from "@/lib/etsy/respond"
import { getShopReviews } from "@/lib/etsy/shops"

// One page of a shop's reviews, for the shop analysis. `since` is Unix seconds.
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/shops/[shopId]/reviews">
) {
  const id = Number((await params).shopId)
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Invalid shop id" }, { status: 400 })
  }
  const search = new URL(request.url).searchParams
  const offset = Number(search.get("offset")) || 0
  const since = Number(search.get("since")) || undefined
  return respond(() => getShopReviews(id, offset, since))
}
