import { skyFileKey } from "@/lib/citys/sky-store"
import { NotFoundError } from "@/lib/mockups/storage"
import { getFile } from "@/lib/storage/files"

type Context = RouteContext<"/api/citys/skies/[id]/files/[file]">

// One of a custom sky's photos.
export async function GET(_request: Request, { params }: Context) {
  const { id, file } = await params
  try {
    const data = await getFile(skyFileKey(id, file))
    return new Response(new Uint8Array(data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" } })
  } catch (error) {
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 })
    throw error
  }
}
