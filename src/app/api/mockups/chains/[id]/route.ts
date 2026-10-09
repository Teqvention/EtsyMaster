import { deleteChain, parsePatch, updateChain } from "@/lib/mockups/chains"
import { respond } from "@/lib/mockups/respond"

type Context = RouteContext<"/api/mockups/chains/[id]">

// Rename, reorder, set the video or make it the default (JSON `ChainPatch`).
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params
  const patch = parsePatch(await request.json().catch(() => null))
  if (!patch) return Response.json({ error: "Invalid chain" }, { status: 400 })
  return respond(() => updateChain(id, patch))
}

export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params
  return respond(() => deleteChain(id))
}
