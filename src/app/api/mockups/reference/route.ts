import { createSceneFromReference, fetchReference } from "@/lib/mockups/reference"
import { respond } from "@/lib/mockups/respond"

// Nano Banana takes 30–60 s per image.
export const maxDuration = 180

// New scene from someone else's finished mockup (form fields `name`, and
// `image` or the `url` of an Etsy listing photo; optionally `category` and
// `source`): redrawn with a blank sheet, corners found, light & shine generated.
export async function POST(request: Request) {
  const form = await request.formData()
  const image = form.get("image")
  const url = form.get("url")
  const name = String(form.get("name") ?? "").trim()
  if (!(image instanceof File || typeof url === "string") || !name) {
    return Response.json({ error: "Name and image are required" }, { status: 400 })
  }
  const category = String(form.get("category") ?? "").trim() || undefined
  const source = String(form.get("source") ?? "").trim() || undefined
  return respond(async () =>
    createSceneFromReference(
      name,
      image instanceof File ? Buffer.from(await image.arrayBuffer()) : await fetchReference(String(url)),
      { category, source }
    )
  )
}
