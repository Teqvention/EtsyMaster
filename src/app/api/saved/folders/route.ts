import { respond } from "@/lib/mockups/respond"
import { addFolder, listFolders } from "@/lib/saved/storage"

// Every folder, A–Z, with how many listings are in it.
export async function GET() {
  return respond(listFolders)
}

// New folder (JSON `{ name }`); an existing one by that name is returned as is.
export async function POST(request: Request) {
  const { name } = (await request.json().catch(() => ({}))) as { name?: unknown }
  if (typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "Name is required" }, { status: 400 })
  }
  return respond(async () => ({ name: await addFolder(name) }))
}
