import { respond } from "@/lib/mockups/respond"
import { retireReplaced } from "@/lib/citys/upload"

// Deactivates old listings whose slots live city posters took ({ listingIds }).
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { listingIds?: unknown } | null
  const ids = Array.isArray(body?.listingIds) ? body.listingIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []
  if (!ids.length) return Response.json({ error: "Which listings?" }, { status: 400 })
  return respond(() => retireReplaced(ids))
}
