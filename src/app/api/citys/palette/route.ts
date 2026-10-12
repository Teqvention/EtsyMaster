import { photoPalette } from "@/lib/citys/composition/raster"
import { samplePhoto } from "@/lib/citys/sample"
import { readSetFile } from "@/lib/generation/storage"
import { respond } from "@/lib/mockups/respond"

// The colours a layout can take from a city poster (`?photo=<set>/<file>`; the sample photo without).
export async function GET(request: Request) {
  const photo = new URL(request.url).searchParams.get("photo")
  return respond(async () => {
    const image = photo ? await readSetFile(photo.split("/")[0], photo.split("/")[1]) : await samplePhoto()
    if (!image) throw new Error("No photo")
    return photoPalette(image)
  })
}
