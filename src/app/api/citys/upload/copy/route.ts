import { respond } from "@/lib/mockups/respond"
import { previewCityCopy } from "@/lib/citys/upload-stages"

// The copy a city poster would go up with ({ setId, outputId }): written by the city copywriter now, kept for the upload.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { setId?: unknown; outputId?: unknown } | null
  if (typeof body?.setId !== "string" || typeof body.outputId !== "string") return Response.json({ error: "Which poster?" }, { status: 400 })
  return respond(() => previewCityCopy(body.setId as string, body.outputId as string))
}
