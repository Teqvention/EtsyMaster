import { refFileKey } from "@/lib/citys/refs"
import { serveImage } from "@/lib/styles/serve"

type Context = RouteContext<"/api/citys/refs/[listingId]/[file]">

// A reference poster taken out of a listing photo (`?w=` for a smaller copy).
export async function GET(request: Request, { params }: Context) {
  const { listingId, file } = await params
  return serveImage(request, () => refFileKey(Number(listingId), file))
}
