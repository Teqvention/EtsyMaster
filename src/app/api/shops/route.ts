import { respond } from "@/lib/etsy/respond"
import { findShop } from "@/lib/etsy/shops"

// A shop by name, id, or Etsy URL (`?q=`), for the shop analysis.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim()
  if (!q) return Response.json({ error: "Missing shop" }, { status: 400 })
  return respond(() => findShop(q))
}
