import { createSceneFromReference } from "@/lib/mockups/reference"
import { respond } from "@/lib/mockups/respond"

// Nano Banana takes 30–60 s per image.
export const maxDuration = 180

// New scene from someone else's finished mockup (form fields `name`, `image`):
// redrawn with a blank sheet, corners found, light & shine generated.
export async function POST(request: Request) {
  const form = await request.formData()
  const image = form.get("image")
  const name = String(form.get("name") ?? "").trim()
  if (!(image instanceof File) || !name) {
    return Response.json({ error: "Name and image are required" }, { status: 400 })
  }
  return respond(async () =>
    createSceneFromReference(name, Buffer.from(await image.arrayBuffer()))
  )
}
