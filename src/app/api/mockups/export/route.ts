import { toListingJpeg } from "@/lib/mockups/storage"
import { EXPORT_EDGE } from "@/lib/mockups/types"

// The editor renders at full scene resolution in the browser and posts the
// raw RGBA (?w=&h=); this turns it into the listing JPEG (Lanczos down to
// 2000 px, quality 92).
export async function POST(request: Request) {
  const url = new URL(request.url)
  const width = Number(url.searchParams.get("w"))
  const height = Number(url.searchParams.get("h"))
  const data = Buffer.from(await request.arrayBuffer())
  if (!width || !height || data.length !== width * height * 4) {
    return Response.json({ error: "Expected w × h × 4 bytes of RGBA" }, { status: 400 })
  }
  try {
    const jpeg = await toListingJpeg(data, { width, height }, EXPORT_EDGE)
    return new Response(new Uint8Array(jpeg), {
      headers: { "Content-Type": "image/jpeg" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed"
    return Response.json({ error: message }, { status: 500 })
  }
}
