import { addChain, listChains, parsePatch } from "@/lib/mockups/chains"
import { respond } from "@/lib/mockups/respond"

// Mockup chains: the picture sequence of a listing. Changes answer with the
// whole list, since a new default changes the others too.
export async function GET() {
  return respond(listChains)
}

// New chain (JSON `{ name, scenes?, video?, isDefault? }`).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const patch = parsePatch(body)
  if (!patch || typeof patch.name !== "string") {
    return Response.json({ error: "A name is required" }, { status: 400 })
  }
  return respond(() => addChain({ ...patch, name: patch.name! }))
}
