import { respond } from "@/lib/mockups/respond"
import { seoRuns, startSeo } from "@/lib/citys/seo"

// SEO analyses of our city listings: the recent ones (GET), and a new one
// for the picked listings (POST { listingIds }).
export async function GET() {
  return respond(seoRuns)
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { listingIds?: unknown } | null
  const ids = Array.isArray(body?.listingIds) ? body.listingIds.map(Number).filter((id) => Number.isInteger(id) && id > 0) : []
  if (!ids.length) return Response.json({ error: "Pick the listings to analyse" }, { status: 400 })
  if (ids.length > 300) return Response.json({ error: "At most 300 listings at once" }, { status: 400 })
  return respond(() => startSeo(ids))
}
