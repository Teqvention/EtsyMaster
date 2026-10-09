import { respond } from "@/lib/mockups/respond"
import { deleteDraft, updateDraft, uploadsState } from "@/lib/uploads/store"
import type { DraftPatch, DraftStatus } from "@/lib/uploads/types"

const STATUSES: DraftStatus[] = ["draft", "ready", "uploaded"]

// Edit a draft (JSON: any of title, tags, description, status, chainId,
// priceCents). Answers with the page's state.
export async function PATCH(request: Request, { params }: RouteContext<"/api/uploads/[id]">) {
  const { id } = await params
  const patch = parsePatch(await request.json().catch(() => null))
  if (!patch) return Response.json({ error: "Nothing to change" }, { status: 400 })
  return respond(async () => {
    await updateDraft(id, patch)
    return uploadsState()
  })
}

export async function DELETE(_request: Request, { params }: RouteContext<"/api/uploads/[id]">) {
  const { id } = await params
  return respond(async () => {
    await deleteDraft(id)
    return uploadsState()
  })
}

function parsePatch(body: unknown): DraftPatch | null {
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, unknown>
  const patch: DraftPatch = {}
  if (typeof b.title === "string") patch.title = b.title
  if (Array.isArray(b.tags) && b.tags.every((t) => typeof t === "string")) patch.tags = b.tags
  if (typeof b.description === "string") patch.description = b.description
  if (typeof b.status === "string" && STATUSES.includes(b.status as DraftStatus)) patch.status = b.status as DraftStatus
  if (b.chainId === null || typeof b.chainId === "string") patch.chainId = b.chainId as string | null
  if (b.priceCents === null) patch.priceCents = undefined
  else if (Number.isInteger(b.priceCents) && (b.priceCents as number) >= 0) patch.priceCents = b.priceCents as number
  return Object.keys(patch).length || "priceCents" in b ? patch : null
}
