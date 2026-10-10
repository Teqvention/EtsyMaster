import { respond } from "@/lib/artikel/respond"
import { assignTags } from "@/lib/artikel/tags"

const ids = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [])

// Puts tags on listings and takes them off: JSON { listingIds, add?, remove? }.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { listingIds?: unknown; add?: unknown; remove?: unknown } | null
  const listingIds = Array.isArray(body?.listingIds)
    ? body.listingIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    : []
  if (!listingIds.length) return Response.json({ error: "No listings picked" }, { status: 400 })
  return respond(() => assignTags(listingIds, { add: ids(body?.add), remove: ids(body?.remove) }))
}
