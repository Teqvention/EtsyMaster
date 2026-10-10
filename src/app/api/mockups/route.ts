import { listSets } from "@/lib/generation/storage"
import { respond } from "@/lib/mockups/respond"
import { createScene, listScenes } from "@/lib/mockups/storage"

// All scenes, in listing order. Scenes stolen before they kept their shop
// take it from the generation set that made them.
export async function GET() {
  return respond(async () => {
    const [scenes, sets] = await Promise.all([listScenes(), listSets()])
    const shopOf = new Map(sets.flatMap((s) => (s.sceneId && s.source.shop ? [[s.sceneId, s.source.shop]] : [])))
    return scenes.map((s) => (s.shop || !shopOf.has(s.id) ? s : { ...s, shop: shopOf.get(s.id) }))
  })
}

// New scene from an uploaded room photo (form fields `name`, `image`,
// optionally `category`).
export async function POST(request: Request) {
  const form = await request.formData()
  const image = form.get("image")
  const name = String(form.get("name") ?? "").trim()
  if (!(image instanceof File) || !name) {
    return Response.json({ error: "Name and image are required" }, { status: 400 })
  }
  const category = String(form.get("category") ?? "").trim() || undefined
  return respond(async () =>
    createScene(name, Buffer.from(await image.arrayBuffer()), { category })
  )
}
