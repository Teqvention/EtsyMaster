import { fileKey } from "@/lib/generation/storage"
import { serveImage } from "@/lib/styles/serve"

type Context = RouteContext<"/api/uploads/posters/[set]/[file]">

// A poster (or the reference photo it was drawn from), usually as a small
// copy (`?w=`) for the group list and the upload dialog.
export async function GET(request: Request, { params }: Context) {
  const { set, file } = await params
  return serveImage(request, () => fileKey(set, file))
}
