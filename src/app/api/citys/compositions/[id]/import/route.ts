import { importFromImage } from "@/lib/citys/composition/ai"
import { getComposition } from "@/lib/citys/composition/store"
import { respond } from "@/lib/mockups/respond"

type Context = RouteContext<"/api/citys/compositions/[id]/import">

// Builds the layout from a poster image (multipart `file`), in the background.
export async function POST(request: Request, { params }: Context) {
  const { id } = await params
  const form = await request.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) return Response.json({ error: "Add a poster image" }, { status: 400 })
  return respond(async () => {
    await importFromImage(id, Buffer.from(await file.arrayBuffer()))
    return getComposition(id)
  })
}
