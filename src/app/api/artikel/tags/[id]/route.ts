import { respond } from "@/lib/artikel/respond"
import { deleteTag, readTags, updateTag } from "@/lib/artikel/tags"

// Rename or recolour a tag: JSON { name?, color? }.
export async function PATCH(request: Request, { params }: RouteContext<"/api/artikel/tags/[id]">) {
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { name?: unknown; color?: unknown } | null
  return respond(async () => {
    await updateTag(id, {
      name: typeof body?.name === "string" ? body.name : undefined,
      color: typeof body?.color === "string" ? body.color : undefined,
    })
    return readTags()
  })
}

// Deletes the tag and takes it off every listing.
export async function DELETE(_request: Request, { params }: RouteContext<"/api/artikel/tags/[id]">) {
  const { id } = await params
  return respond(async () => {
    await deleteTag(id)
    return readTags()
  })
}
