import type { SizeKey } from "@/lib/catalog/sizes"
import { SIZE_BY_KEY } from "@/lib/catalog/sizes"
import { SAMPLE_FACTS } from "@/lib/citys/composition/model"
import { previewJpeg } from "@/lib/citys/composition/raster"
import { getComposition } from "@/lib/citys/composition/store"
import { placeFacts } from "@/lib/citys/facts"
import { samplePhoto } from "@/lib/citys/sample"
import { readSetFile } from "@/lib/generation/storage"

type Context = RouteContext<"/api/citys/compositions/[id]/render">

// The composition rendered on the server, as print files will be:
// `?size=` a print size's shape, `?place=` a place's facts, `?photo=<set>/<file>` a city poster, `?w=` width.
export async function GET(request: Request, { params }: Context) {
  const { id } = await params
  const url = new URL(request.url)
  try {
    const c = await getComposition(id)
    const size = url.searchParams.get("size") as SizeKey | null
    const spec = size ? SIZE_BY_KEY[size] : null
    const facts = (url.searchParams.get("place") && (await placeFacts(url.searchParams.get("place")!))) || SAMPLE_FACTS
    const photoParam = url.searchParams.get("photo")
    const photo = photoParam ? await readSetFile(photoParam.split("/")[0], photoParam.split("/")[1]).catch(() => null) : await samplePhoto()
    const jpeg = await previewJpeg({ data: c, ratio: spec ? spec.widthMm / spec.heightMm : c.ratio, size: size ?? undefined, facts, photo, width: Math.min(2000, Number(url.searchParams.get("w")) || 800) })
    return new Response(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
