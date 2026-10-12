import { redoOutput } from "@/lib/citys/outputs"
import { respond } from "@/lib/mockups/respond"

// More like one city poster, with notes on what to change (JSON `{ setId, outputId, notes, count }`).
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { setId?: unknown; outputId?: unknown; notes?: unknown; count?: unknown } | null
  if (typeof body?.setId !== "string" || typeof body.outputId !== "string") return Response.json({ error: "Which poster?" }, { status: 400 })
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 600) : ""
  const count = Math.max(1, Math.min(4, Number(body.count) || 1))
  return respond(async () => {
    await redoOutput(body.setId as string, body.outputId as string, notes, count)
    return { ok: true }
  })
}
