import { enqueue } from "@/lib/generation/run"
import { CREATIVITIES, type Creativity } from "@/lib/generation/types"
import { respond } from "@/lib/mockups/respond"
import { MAX_AUTO, startAuto } from "@/lib/styles/auto"

type Context = RouteContext<"/api/styles/[id]/auto">

// Autonomous scale (JSON `{ levels, count, delivery? }`): `count` new posters
// in the style, spread over the creativity `levels`, painted into the style's
// own generation set. Answers with that set at once; it runs in the background.
export async function POST(request: Request, { params }: Context) {
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { levels?: unknown; count?: unknown; delivery?: unknown }
  const levels = [...new Set(Array.isArray(body.levels) ? body.levels : [])].filter((l): l is Creativity =>
    CREATIVITIES.includes(l as Creativity)
  )
  const count = Math.round(Number(body.count))
  if (!levels.length || !Number.isFinite(count) || count < 1) {
    return Response.json({ error: "Pick at least one level and a number of images" }, { status: 400 })
  }
  return respond(async () => {
    const set = await startAuto(id, {
      levels: CREATIVITIES.filter((l) => levels.includes(l)),
      count: Math.min(count, MAX_AUTO),
      delivery: body.delivery === "batch" ? "batch" : "now",
    })
    enqueue(set.id)
    return set
  })
}
