import { keywordListings } from "@/lib/keywords/library"
import { respond } from "@/lib/mockups/respond"

// Listings in the library using a keyword (`?keyword=&kind=tag|phrase`), best selling first.
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams
  const keyword = search.get("keyword")?.trim()
  const kind = search.get("kind") === "phrase" ? "phrase" : "tag"
  if (!keyword) return Response.json({ error: "A keyword is required" }, { status: 400 })
  return respond(() => keywordListings(keyword, kind))
}
