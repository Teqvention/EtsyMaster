import { fileKey } from "@/lib/styles/storage"
import { serveImage } from "@/lib/styles/serve"

type Context = RouteContext<"/api/styles/[id]/files/[file]">

// A moodboard image (`?w=` for a smaller copy). Written once under a fresh name.
export async function GET(request: Request, { params }: Context) {
  const { id, file } = await params
  return serveImage(request, () => fileKey(id, file))
}
