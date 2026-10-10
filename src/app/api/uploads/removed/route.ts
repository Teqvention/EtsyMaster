import { respond } from "@/lib/mockups/respond"
import { removePosters, restorePosters, uploadsState } from "@/lib/uploads/store"

// The posters deleted from the uploads. POST JSON { keys } deletes posters
// (no longer approved, drafts gone, onto this list); DELETE JSON { keys }
// takes them off it again, approved and with their drafts. Keys are
// "<set id>/<output id>". Answers the page's state.

export async function POST(request: Request) {
  const keys = await readKeys(request)
  if (!keys) return Response.json({ error: "Which posters?" }, { status: 400 })
  return respond(async () => {
    await removePosters(keys)
    return uploadsState()
  })
}

export async function DELETE(request: Request) {
  const keys = await readKeys(request)
  if (!keys) return Response.json({ error: "Which posters?" }, { status: 400 })
  return respond(async () => {
    await restorePosters(keys)
    return uploadsState()
  })
}

async function readKeys(request: Request) {
  const { keys } = (await request.json().catch(() => ({}))) as { keys?: unknown }
  return Array.isArray(keys) && keys.length > 0 && keys.every((k) => typeof k === "string" && k.includes("/"))
    ? (keys as string[])
    : null
}
