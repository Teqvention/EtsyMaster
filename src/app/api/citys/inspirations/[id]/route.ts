import { deleteInspiration, readLook, renameInspiration, inspiration } from "@/lib/citys/inspirations"
import { respond } from "@/lib/mockups/respond"

type Context = RouteContext<"/api/citys/inspirations/[id]">

// Rename (`{ name }`), read the look again (`{ read: true }`), or delete.
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; read?: unknown }
  return respond(async () => {
    if (body.read === true) {
      void readLook(id)
      return inspiration(id)
    }
    if (typeof body.name === "string") return renameInspiration(id, body.name)
    return inspiration(id)
  })
}

export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params
  return respond(() => deleteInspiration(id))
}
