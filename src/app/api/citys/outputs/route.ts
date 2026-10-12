import { cityOutputs, reviewOutputs } from "@/lib/citys/outputs"
import { respond } from "@/lib/mockups/respond"

// Every city poster made (GET); approve, reject or un-review some (PATCH
// `{ items: [{ setId, outputId }], review: "approved" | "rejected" | null }`).
export async function GET() {
  return respond(cityOutputs)
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as { items?: unknown; review?: unknown } | null
  const items = (Array.isArray(body?.items) ? body.items : []).filter(
    (i): i is { setId: string; outputId: string } => !!i && typeof i.setId === "string" && typeof i.outputId === "string"
  )
  const review = body?.review === "approved" || body?.review === "rejected" ? body.review : body?.review === null ? null : undefined
  if (!items.length || review === undefined) return Response.json({ error: "Say which posters and how" }, { status: 400 })
  return respond(async () => {
    await reviewOutputs(items, review)
    return { ok: true }
  })
}
