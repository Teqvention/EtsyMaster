import { fontCatalog, fontLists, saveFontLists, type FontLists } from "@/lib/citys/composition/fonts"
import { respond } from "@/lib/mockups/respond"

// Google Fonts' families with their weights, and the shop's liked fonts and lists (GET); the likes and lists replaced (PUT).
export async function GET() {
  return respond(async () => ({ families: await fontCatalog(), lists: await fontLists() }))
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as FontLists | null
  if (!body) return Response.json({ error: "Nothing to save" }, { status: 400 })
  return respond(() => saveFontLists(body))
}
