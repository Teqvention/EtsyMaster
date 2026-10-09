import { respond } from "@/lib/mockups/respond"
import { createScene, listScenes } from "@/lib/mockups/storage"

// All scenes, in listing order.
export async function GET() {
  return respond(listScenes)
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
