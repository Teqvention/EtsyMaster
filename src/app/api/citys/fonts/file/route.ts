import { fontFile } from "@/lib/citys/composition/fonts"

// A font's TrueType file (`?family=&weight=&italic=`), fetched from Google once and kept.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const family = url.searchParams.get("family") ?? ""
  const weight = Number(url.searchParams.get("weight")) || 400
  const italic = url.searchParams.get("italic") === "1"
  if (!family.trim()) return Response.json({ error: "Which font?" }, { status: 400 })
  try {
    const data = await fontFile(family, weight, italic)
    return new Response(new Uint8Array(data), { headers: { "Content-Type": "font/ttf", "Cache-Control": "public, max-age=31536000, immutable" } })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 404 })
  }
}
