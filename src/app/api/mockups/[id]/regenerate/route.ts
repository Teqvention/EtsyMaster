import { refreshMockup } from "@/lib/generation/run"
import { listSets } from "@/lib/generation/storage"
import type { Delivery } from "@/lib/generation/types"
import { blankAgainPrompt, paint } from "@/lib/mockups/gemini"
import { fetchReference, replaceBlank, roomFile } from "@/lib/mockups/reference"
import { respond } from "@/lib/mockups/respond"
import { getScene, readSceneFile } from "@/lib/mockups/storage"

// Nano Banana takes 30–60 s per image.
export const maxDuration = 180

type Context = RouteContext<"/api/mockups/[id]/regenerate">

// JSON `{ feedback, delivery }`: the scene's blank made again, the way
// `feedback` asks. A scene stolen from a listing photo is made by its
// generation set again, now or in a batch job (answers `{ set }`); any other
// is redrawn now, from its photo when it came from Etsy, else from itself
// (answers `{ scene }` once it's done). Either way it keeps its place.
export async function POST(request: Request, { params }: Context) {
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { feedback?: unknown; delivery?: unknown }
  const feedback = typeof body.feedback === "string" ? body.feedback.trim().slice(0, 2000) : ""
  const delivery: Delivery = body.delivery === "batch" ? "batch" : "now"

  return respond(async () => {
    const scene = await getScene(id)
    const set = (await listSets()).find((s) => s.kind === "mockup" && s.sceneId === id)
    if (set) return { set: await refreshMockup(set.id, feedback, delivery) }

    const blank = await readSceneFile(id, roomFile(scene))
    const photo = scene.source?.startsWith("https://") ? await fetchReference(scene.source).catch(() => null) : null
    const image = await paint(blankAgainPrompt(feedback, !!photo), photo ? [photo, blank] : [blank])
    const next = await replaceBlank(id, image)
    return { scene: { id: next.id, located: next.located } }
  })
}
