import { listTemplates, saveTemplates } from "@/lib/citys/templates"
import { respond } from "@/lib/mockups/respond"

// The Stealer's saved requests: the list (GET), or the whole list replaced (PUT).
export async function GET() {
  return respond(listTemplates)
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null)
  return respond(() => saveTemplates(body))
}
