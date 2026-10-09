import { parseOptions } from "@/lib/generation/options"
import { addBatch, dequeue, retry } from "@/lib/generation/run"
import { deleteSet } from "@/lib/generation/storage"
import { respond } from "@/lib/mockups/respond"

type Context = RouteContext<"/api/generations/[id]">

// JSON `{ options }` makes more images from the set's posters (a redo of one
// output when `options.from` is set); without, everything that failed runs again.
export async function POST(request: Request, { params }: Context) {
  const { id } = await params
  const { options } = (await request.json().catch(() => ({}))) as { options?: unknown }
  if (options === undefined) return respond(() => retry(id))
  const parsed = parseOptions(options)
  if (!parsed) return Response.json({ error: "Ask for at least one image" }, { status: 400 })
  return respond(() => addBatch(id, parsed))
}

// Remove the set and its images; a set still waiting never runs.
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params
  dequeue(id)
  return respond(() => deleteSet(id))
}
