import { respond } from "@/lib/mockups/respond"
import { rewriteDraft, uploadsState } from "@/lib/uploads/store"

// Write the draft's listing copy again (JSON `{ hint? }`, what to do
// differently, e.g. "more gift-focused"). Answers with the page's state.
export async function POST(request: Request, { params }: RouteContext<"/api/uploads/[id]/rewrite">) {
  const { id } = await params
  const { hint } = (await request.json().catch(() => ({}))) as { hint?: unknown }
  if (hint !== undefined && typeof hint !== "string") {
    return Response.json({ error: "The hint has to be text" }, { status: 400 })
  }
  return respond(async () => {
    await rewriteDraft(id, hint?.slice(0, 300))
    return uploadsState()
  })
}
