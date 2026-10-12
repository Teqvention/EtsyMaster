import { setStatus } from "@/lib/citys/artikel"
import type { CityStatus } from "@/lib/citys/ours"
import { respond } from "@/lib/mockups/respond"

const STATUSES: CityStatus[] = ["confirmed", "replace", "offline"]

// Sets city listings' status by hand ({ listingIds, status }); status null
// hands them back to the classification.
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as { listingIds?: unknown; status?: unknown } | null
  const ids = Array.isArray(body?.listingIds) ? body.listingIds.map(Number).filter((id) => Number.isInteger(id) && id > 0) : []
  const status = body?.status === null ? null : STATUSES.find((s) => s === body?.status)
  if (!ids.length || status === undefined) return Response.json({ error: "Which listings, and which status?" }, { status: 400 })
  return respond(() => setStatus(ids, status))
}
