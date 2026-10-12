import { createInspiration, listInspirations } from "@/lib/citys/inspirations"
import { respond } from "@/lib/mockups/respond"

// Looks for real city photos: every one (GET), a new one (POST `{ name }`).
export async function GET() {
  return respond(listInspirations)
}

export async function POST(request: Request) {
  const { name } = (await request.json().catch(() => ({}))) as { name?: unknown }
  if (typeof name !== "string" || !name.trim()) return Response.json({ error: "Name the inspiration" }, { status: 400 })
  return respond(() => createInspiration(name))
}
