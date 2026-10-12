import { editPlace, mergePlaces, type PlaceEdit } from "@/lib/citys/places"
import { respond } from "@/lib/mockups/respond"

type Context = RouteContext<"/api/citys/places/[id]">

// Changes a place by hand (JSON PlaceEdit), or folds it into another one
// (JSON `{ mergeInto: id }`).
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params
  const body = (await request.json().catch(() => null)) as (PlaceEdit & { mergeInto?: string }) | null
  if (!body) return Response.json({ error: "Nothing to change" }, { status: 400 })
  return respond(async () => {
    if (typeof body.mergeInto === "string") return mergePlaces(id, body.mergeInto)
    return editPlace(id, body)
  })
}
