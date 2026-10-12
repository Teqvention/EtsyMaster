import { previewCityPoster } from "@/lib/citys/upload-stages"

// A city poster as it would go up: ?set=&output=&composition= (none: the photo alone)&w=
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams
  const set = query.get("set")
  const output = query.get("output")
  if (!set || !output) return Response.json({ error: "Which poster?" }, { status: 400 })
  const width = Math.min(1600, Math.max(160, Number(query.get("w")) || 720))
  try {
    const image = await previewCityPoster(set, output, query.get("composition") || null, width)
    return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300" } })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 404 })
  }
}
