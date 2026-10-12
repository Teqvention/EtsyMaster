import { createComposition, listCompositions } from "@/lib/citys/composition/store"
import { respond } from "@/lib/mockups/respond"

// Every composition (GET), or a new one from the starter layout (POST `{ name }`).
export async function GET() {
  return respond(listCompositions)
}

export async function POST(request: Request) {
  const { name } = (await request.json().catch(() => ({}))) as { name?: unknown }
  return respond(() => createComposition(typeof name === "string" ? name : "Composition"))
}
