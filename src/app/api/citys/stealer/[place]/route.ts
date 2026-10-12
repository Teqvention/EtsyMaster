import { stealerCity } from "@/lib/citys/stealer"
import { respond } from "@/lib/mockups/respond"

type Context = RouteContext<"/api/citys/stealer/[place]">

// One place's reference listings, best first; their posters are taken out
// of the photos in the background as they're looked at.
export async function GET(_request: Request, { params }: Context) {
  const { place } = await params
  return respond(() => stealerCity(decodeURIComponent(place)))
}
