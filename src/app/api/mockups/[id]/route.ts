import { listSets, updateSet } from "@/lib/generation/storage"
import { respond } from "@/lib/mockups/respond"
import { deleteScene, getScene, saveScene } from "@/lib/mockups/storage"
import type { Scene } from "@/lib/mockups/types"

type Context = RouteContext<"/api/mockups/[id]">

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params
  return respond(() => getScene(id))
}

export async function PUT(request: Request, { params }: Context) {
  const { id } = await params
  const scene = (await request.json()) as Scene
  if (scene.id !== id || scene.version !== 1 || !Array.isArray(scene.layers)) {
    return Response.json({ error: "Invalid scene" }, { status: 400 })
  }
  return respond(() => saveScene(scene))
}

// The set it was stolen by stays, so its photo isn't offered again; it just
// no longer opens the editor.
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params
  return respond(async () => {
    await deleteScene(id)
    for (const set of await listSets()) {
      if (set.sceneId === id) await updateSet(set.id, (s) => ({ ...s, sceneId: undefined }))
    }
  })
}
