import { recreate } from "@/lib/citys/generate"
import { cleanRequest } from "@/lib/citys/templates"
import { enqueue } from "@/lib/generation/run"
import { respond } from "@/lib/mockups/respond"

// More from one city poster with a whole request (JSON `{ setId, outputId,
// base, request }`): `base` "reference" makes them from the poster's own
// reference photo, "ours" from the poster itself. Answers the set they're on.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { setId?: unknown; outputId?: unknown; base?: unknown; request?: unknown } | null
  if (typeof body?.setId !== "string" || typeof body.outputId !== "string") return Response.json({ error: "Which poster?" }, { status: 400 })
  const base = body.base === "ours" ? "ours" : "reference"
  return respond(async () => ({ set: await recreate(body.setId as string, body.outputId as string, base, cleanRequest(body.request), enqueue) }))
}
