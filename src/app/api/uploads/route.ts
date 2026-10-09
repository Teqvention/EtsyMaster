import { respond } from "@/lib/mockups/respond"
import { createDrafts, uploadsState } from "@/lib/uploads/store"

// The Uploads page: every draft (with how strong its keywords are), the
// approved posters still without one, the mockup chains and the library size.
export async function GET() {
  return respond(uploadsState)
}

// Drafts for every approved poster without one (JSON `{ all: true }`), or for
// one finished poster (`{ generationId, outputId }`). Their listing copy is
// written in the background. Answers with the page's state.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    all?: unknown
    generationId?: unknown
    outputId?: unknown
  }
  const one = typeof body.generationId === "string" && typeof body.outputId === "string"
  if (body.all !== true && !one) {
    return Response.json({ error: "Ask for `all`, or a generationId and outputId" }, { status: 400 })
  }
  return respond(async () => {
    await createDrafts(
      one ? { generationId: body.generationId as string, outputId: body.outputId as string } : { all: true }
    )
    return uploadsState()
  })
}
