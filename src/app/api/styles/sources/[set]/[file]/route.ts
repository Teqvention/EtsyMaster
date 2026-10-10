import { fileKey } from "@/lib/generation/storage"
import { serveImage } from "@/lib/styles/serve"

type Context = RouteContext<"/api/styles/sources/[set]/[file]">

// A generated poster for the moodboard picker, usually as a small copy (`?w=`).
export async function GET(request: Request, { params }: Context) {
  const { set, file } = await params
  return serveImage(request, () => fileKey(set, file))
}
