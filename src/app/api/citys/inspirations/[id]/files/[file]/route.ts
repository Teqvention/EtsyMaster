import { inspirationFileKey } from "@/lib/citys/inspirations"
import { serveImage } from "@/lib/styles/serve"

type Context = RouteContext<"/api/citys/inspirations/[id]/files/[file]">

export async function GET(request: Request, { params }: Context) {
  const { id, file } = await params
  return serveImage(request, () => inspirationFileKey(id, file))
}
