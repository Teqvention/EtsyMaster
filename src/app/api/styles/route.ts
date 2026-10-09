import { respond } from "@/lib/mockups/respond"
import { createStyle, listStyles } from "@/lib/styles/storage"

// Every style, last changed first.
export async function GET() {
  return respond(listStyles)
}

// A new, empty style (JSON `{ name }`).
export async function POST(request: Request) {
  const { name } = (await request.json().catch(() => ({}))) as { name?: unknown }
  if (typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "Name the style" }, { status: 400 })
  }
  return respond(() => createStyle(name))
}
