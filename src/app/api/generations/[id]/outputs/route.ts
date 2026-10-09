import { removeFile, updateSet } from "@/lib/generation/storage"
import type { Review } from "@/lib/generation/types"
import { respond } from "@/lib/mockups/respond"

type Context = RouteContext<"/api/generations/[id]/outputs">

// Review outputs (JSON `{ ids, review }`, review "approved", "rejected" or
// null to undecide). Answers with the set.
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params
  const { ids, review } = (await request.json().catch(() => ({}))) as { ids?: unknown; review?: unknown }
  if (!isIds(ids) || !(review === null || review === "approved" || review === "rejected")) {
    return Response.json({ error: "Output ids and a review are required" }, { status: 400 })
  }
  const reviewedAt = new Date().toISOString()
  return respond(() =>
    updateSet(id, (set) => ({
      ...set,
      outputs: set.outputs.map((o) =>
        ids.includes(o.id) ? { ...o, review: review as Review | null, reviewedAt } : o
      ),
    }))
  )
}

// Throw outputs away (JSON `{ ids }`), images and all. Answers with the set.
export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params
  const { ids } = (await request.json().catch(() => ({}))) as { ids?: unknown }
  if (!isIds(ids)) return Response.json({ error: "Output ids are required" }, { status: 400 })
  return respond(async () => {
    let files: (string | null)[] = []
    const set = await updateSet(id, (s) => {
      files = s.outputs.filter((o) => ids.includes(o.id) && o.status !== "running").map((o) => o.file)
      return { ...s, outputs: s.outputs.filter((o) => !ids.includes(o.id) || o.status === "running") }
    })
    await Promise.all(files.map((f) => removeFile(id, f)))
    return set
  })
}

const isIds = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")
