import { respond } from "@/lib/mockups/respond"
import { listStyles } from "@/lib/styles/storage"
import { suggestName } from "@/lib/styles/understand"

// A suggested name for a style made of generated posters
// (JSON `{ items: [{ generation, file }] }`), unlike the existing ones.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { items?: unknown }
  const items = (Array.isArray(body.items) ? body.items : []).filter(
    (p): p is { generation: string; file: string } =>
      typeof p?.generation === "string" && typeof p?.file === "string"
  )
  if (items.length === 0) return Response.json({ error: "No images" }, { status: 400 })
  return respond(async () => {
    const taken = (await listStyles()).map((s) => s.name)
    return suggestName(items, taken)
  })
}
