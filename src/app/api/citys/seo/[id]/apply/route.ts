import { respond } from "@/lib/mockups/respond"
import { applySeo } from "@/lib/citys/seo"

// Applies an analysis's proposals on Etsy: the listings named ({ listingIds }), or every one that changes.
export async function POST(request: Request, ctx: RouteContext<"/api/citys/seo/[id]/apply">) {
  const { id } = await ctx.params
  const body = (await request.json().catch(() => ({}))) as { listingIds?: unknown }
  const ids = Array.isArray(body.listingIds) ? body.listingIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : undefined
  return respond(() => applySeo(id, ids))
}
