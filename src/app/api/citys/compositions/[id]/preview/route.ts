import { compositionPreview } from "@/lib/citys/composition/store"
import { samplePhoto } from "@/lib/citys/sample"

type Context = RouteContext<"/api/citys/compositions/[id]/preview">

// A preview of the composition with a sample place, kept once made.
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params
  try {
    const jpeg = await compositionPreview(id, await samplePhoto())
    return new Response(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" } })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 404 })
  }
}
