import { respond } from "@/lib/mockups/respond"
import { deleteTemplate, updateTemplate } from "@/lib/mockups/storage"
import type { Template } from "@/lib/mockups/types"

type Context = RouteContext<"/api/mockups/templates/[id]">

export async function PUT(request: Request, { params }: Context) {
  const { id } = await params
  const patch = (await request.json().catch(() => null)) as Partial<Template> | null
  if (!patch || typeof patch !== "object") {
    return Response.json({ error: "Invalid template" }, { status: 400 })
  }
  return respond(() => updateTemplate(id, patch))
}

export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params
  return respond(() => deleteTemplate(id))
}
