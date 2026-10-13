import { rebuildFromImage } from "@/lib/citys/composition/rebuild"
import { getComposition } from "@/lib/citys/composition/store"
import { respond } from "@/lib/mockups/respond"

type Context = RouteContext<"/api/citys/compositions/[id]/import">

// Rebuilds the layout from a poster image (multipart `file`: a design file or a
// photo of the poster), in the background, comparing it with the image pass after pass.
export async function POST(request: Request, { params }: Context) {
  const { id } = await params
  const form = await request.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) return Response.json({ error: "Add a poster image" }, { status: 400 })
  return respond(async () => {
    await rebuildFromImage(id, Buffer.from(await file.arrayBuffer()))
    return getComposition(id)
  })
}
