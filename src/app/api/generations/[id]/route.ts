import { parseOptions } from "@/lib/generation/options"
import { addBatch, dequeue, retry, setDelivery } from "@/lib/generation/run"
import { deleteSet, updateSet } from "@/lib/generation/storage"
import { respond } from "@/lib/mockups/respond"

type Context = RouteContext<"/api/generations/[id]">

// JSON `{ options }` makes more images from the set's posters (a redo of one
// output when `options.from` is set); without, everything that failed runs
// again (`delivery` "now" or "batch" says how its images are painted this time).
export async function POST(request: Request, { params }: Context) {
  const { id } = await params
  const { options, delivery } = (await request.json().catch(() => ({}))) as { options?: unknown; delivery?: unknown }
  if (options === undefined) {
    return respond(() => retry(id, delivery === "now" || delivery === "batch" ? delivery : undefined))
  }
  const parsed = parseOptions(options)
  if (!parsed) return Response.json({ error: "Ask for at least one image" }, { status: 400 })
  return respond(() => addBatch(id, parsed))
}

// JSON `{ done }` sets the set aside as done, or takes it back; `{ delivery }`
// ("now" or "batch") changes how images not yet being painted will be. Answers with the set.
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params
  const { done, delivery } = (await request.json().catch(() => ({}))) as { done?: unknown; delivery?: unknown }
  if (delivery === "now" || delivery === "batch") return respond(() => setDelivery(id, delivery))
  if (typeof done !== "boolean") return Response.json({ error: "Say whether it's done" }, { status: 400 })
  return respond(() => updateSet(id, (s) => ({ ...s, doneAt: done ? new Date().toISOString() : undefined })))
}

// Remove the set and its images; a set still waiting never runs.
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params
  dequeue(id)
  return respond(() => deleteSet(id))
}
