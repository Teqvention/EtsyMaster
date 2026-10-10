import { changeAction, deleteAction } from "@/lib/artikel/actions"
import { respond } from "@/lib/artikel/respond"

const STATUSES = ["paused", "running", "cancelled"] as const

// Pause, go on or cancel an action, or try its failed listings again:
// JSON { status?, retry? }. Answers with every action.
export async function PATCH(request: Request, { params }: RouteContext<"/api/artikel/actions/[id]">) {
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { status?: unknown; retry?: unknown } | null
  const status = STATUSES.find((s) => s === body?.status)
  if (!status && body?.retry !== true) return Response.json({ error: "Nothing to change" }, { status: 400 })
  return respond(() => changeAction(id, { status, retry: body?.retry === true }))
}

// Takes a finished, cancelled or paused action off the list.
export async function DELETE(_request: Request, { params }: RouteContext<"/api/artikel/actions/[id]">) {
  const { id } = await params
  return respond(() => deleteAction(id))
}
