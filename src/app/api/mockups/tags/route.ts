import { respond } from "@/lib/mockups/respond"
import { tagScenes } from "@/lib/mockups/storage"
import { isTagChange } from "@/lib/tags"

// Tags on scenes (JSON `{ ids, change }`): a primary tag on or off, a
// secondary one under it on or off, or every tag off. Answers each scene's
// tags as they are now.
export async function POST(request: Request) {
  const { ids, change } = (await request.json().catch(() => ({}))) as { ids?: unknown; change?: unknown }
  if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === "string") || !isTagChange(change)) {
    return Response.json({ error: "Scene ids and a tag change are required" }, { status: 400 })
  }
  return respond(() => tagScenes(ids, change))
}
