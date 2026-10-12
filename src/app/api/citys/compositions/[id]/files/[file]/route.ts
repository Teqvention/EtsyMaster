import { compositionFileKey } from "@/lib/citys/composition/store"
import { serveImage } from "@/lib/styles/serve"

type Context = RouteContext<"/api/citys/compositions/[id]/files/[file]">

export async function GET(request: Request, { params }: Context) {
  const { id, file } = await params
  return serveImage(request, () => compositionFileKey(id, file))
}
