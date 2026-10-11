import { getListingsById, MAX_PAGE_SIZE } from "@/lib/etsy/listings"
import { poolParam, respond } from "@/lib/etsy/respond"

// Listings in full by id (`?ids=1,2,3`, at most 100), for the shop analysis;
// `accounts` names the Etsy accounts to fetch with (see `poolParam`).
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams
  const ids = (search.get("ids") ?? "").split(",").map(Number)
  if (ids.length > MAX_PAGE_SIZE || !ids.every((id) => Number.isInteger(id) && id > 0)) {
    return Response.json({ error: `Between 1 and ${MAX_PAGE_SIZE} listing ids are required` }, { status: 400 })
  }
  return respond(() => getListingsById(ids, poolParam(search)))
}
