import { searchListings } from "@/lib/etsy/listings"
import { parseListingQuery } from "@/lib/etsy/query"
import { respond } from "@/lib/etsy/respond"

// One page of search results, for the search grid's infinite scroll.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const query = parseListingQuery(params)
  const offset = Number(params.get("offset")) || 0

  if (!query.keywords) {
    return Response.json({ listings: [], total: 0, nextOffset: null })
  }

  return respond(() => searchListings(query, offset))
}
