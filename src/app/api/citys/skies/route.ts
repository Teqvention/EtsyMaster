import { createSky, listCustomSkies } from "@/lib/citys/sky-store"
import { respond } from "@/lib/mockups/respond"

const MAX_BYTES = 25 * 1024 * 1024

// The shop's own skies (GET), and a new one from photos of it (POST multipart `files`, optional `name`).
export async function GET() {
  return respond(() => listCustomSkies())
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null)
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File)
  if (!files.length) return Response.json({ error: "Add a photo of the sky" }, { status: 400 })
  if (files.some((f) => f.size > MAX_BYTES)) return Response.json({ error: "Photos can be up to 25 MB" }, { status: 400 })
  const name = form?.get("name")
  return respond(async () => createSky(await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer()))), typeof name === "string" ? name : undefined))
}
