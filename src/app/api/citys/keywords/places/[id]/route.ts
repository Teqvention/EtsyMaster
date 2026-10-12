import { placeKeywords } from "@/lib/citys/keywords"
import { respond } from "@/lib/mockups/respond"
import { NotFoundError } from "@/lib/mockups/storage"

// One place's own keywords: its listings' tags as they are, and the titles of its best sellers.
export async function GET(_request: Request, ctx: RouteContext<"/api/citys/keywords/places/[id]">) {
  const { id } = await ctx.params
  return respond(async () => {
    const found = await placeKeywords(id)
    if (!found) throw new NotFoundError("Unknown place")
    return found
  })
}
