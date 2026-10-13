import { deleteSky } from "@/lib/citys/sky-store"
import { respond } from "@/lib/mockups/respond"

type Context = RouteContext<"/api/citys/skies/[id]">

// Deletes one of the shop's own skies (its key, without "c-").
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params
  return respond(async () => {
    await deleteSky(id)
    return { ok: true }
  })
}
