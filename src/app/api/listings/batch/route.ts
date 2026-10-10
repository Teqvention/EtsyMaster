import { getListingsById, MAX_PAGE_SIZE } from "@/lib/etsy/listings"
import { respond } from "@/lib/etsy/respond"

// Listings in full by id (`?ids=1,2,3`, at most 100), for the shop analysis.
export async function GET(request: Request) {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").map(Number)
  if (ids.length > MAX_PAGE_SIZE || !ids.every((id) => Number.isInteger(id) && id > 0)) {
    return Response.json({ error: `Between 1 and ${MAX_PAGE_SIZE} listing ids are required` }, { status: 400 })
  }
  return respond(() => getListingsById(ids))
}
