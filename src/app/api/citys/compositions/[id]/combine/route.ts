import { combine } from "@/lib/citys/composition/ai"
import { getComposition } from "@/lib/citys/composition/store"
import { respond } from "@/lib/mockups/respond"

type Context = RouteContext<"/api/citys/compositions/[id]/combine">

// Variants combining the layout with another poster image (multipart `file`, `count`, `creativity`).
export async function POST(request: Request, { params }: Context) {
  const { id } = await params
  const form = await request.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) return Response.json({ error: "Add a poster image" }, { status: 400 })
  return respond(async () => {
    await combine(id, { image: Buffer.from(await file.arrayBuffer()), count: Number(form?.get("count")) || 1, creativity: Number(form?.get("creativity")) || 3 })
    return getComposition(id)
  })
}
