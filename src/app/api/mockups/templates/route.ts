import { isTemplate } from "@/lib/mockups/motion"
import { respond } from "@/lib/mockups/respond"
import { addTemplate, listTemplates } from "@/lib/mockups/storage"

// The user's saved animation templates.
export async function GET() {
  return respond(listTemplates)
}

export async function POST(request: Request) {
  const template = await request.json().catch(() => null)
  if (!isTemplate(template)) {
    return Response.json({ error: "Invalid template" }, { status: 400 })
  }
  return respond(() => addTemplate(template))
}
