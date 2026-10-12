import { removeInspirationImage } from "@/lib/citys/inspirations"
import { respond } from "@/lib/mockups/respond"

type Context = RouteContext<"/api/citys/inspirations/[id]/images/[file]">

export async function DELETE(_request: Request, { params }: Context) {
  const { id, file } = await params
  return respond(() => removeInspirationImage(id, file))
}
