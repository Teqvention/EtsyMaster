import { respond } from "@/lib/mockups/respond"
import { addFolder, deleteFolder, listFolders, moveFolder } from "@/lib/saved/storage"

// Every folder, A–Z by path ("robin/Cats"), with how many listings are in it itself.
export async function GET() {
  return respond(listFolders)
}

// New folder (JSON `{ name }`, a path to make one inside another), with the
// folders it's in; an existing one by that name is returned as is.
export async function POST(request: Request) {
  const { name } = (await request.json().catch(() => ({}))) as { name?: unknown }
  if (typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "Name is required" }, { status: 400 })
  }
  return respond(async () => ({ name: await addFolder(name) }))
}

// Move or rename a folder with everything in it (JSON `{ from, to }`, both
// paths). Answers its new path and the whole saved list.
export async function PATCH(request: Request) {
  const { from, to } = (await request.json().catch(() => ({}))) as { from?: unknown; to?: unknown }
  if (typeof from !== "string" || !from.trim() || typeof to !== "string" || !to.trim()) {
    return Response.json({ error: "From and to are required" }, { status: 400 })
  }
  return respond(() => moveFolder(from, to))
}

// Take away an empty folder (JSON `{ name }`) and the empty ones in it.
export async function DELETE(request: Request) {
  const { name } = (await request.json().catch(() => ({}))) as { name?: unknown }
  if (typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "Name is required" }, { status: 400 })
  }
  return respond(() => deleteFolder(name))
}
