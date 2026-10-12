import { addInspirationImages } from "@/lib/citys/inspirations"
import { respond } from "@/lib/mockups/respond"

type Context = RouteContext<"/api/citys/inspirations/[id]/images">

// Photos showing the look (multipart `files`); the look is read again from all of them.
export async function POST(request: Request, { params }: Context) {
  const { id } = await params
  const form = await request.formData().catch(() => null)
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File)
  if (!files.length) return Response.json({ error: "Add a photo" }, { status: 400 })
  return respond(async () => addInspirationImages(id, await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())))))
}
