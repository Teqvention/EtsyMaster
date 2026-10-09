import { respond } from "@/lib/mockups/respond"
import { addCategory, listCategories } from "@/lib/mockups/storage"

// Every category, A–Z, with how many scenes are in it.
export async function GET() {
  return respond(listCategories)
}

// New category (JSON `{ name }`); an existing one by that name is returned as is.
export async function POST(request: Request) {
  const { name } = (await request.json().catch(() => ({}))) as { name?: unknown }
  if (typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "Name is required" }, { status: 400 })
  }
  return respond(async () => ({ name: await addCategory(name) }))
}
