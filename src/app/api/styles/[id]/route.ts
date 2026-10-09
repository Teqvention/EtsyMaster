import { respond } from "@/lib/mockups/respond"
import { cleanName, deleteStyle, getStyle, reorderImages, toGuide, updateStyle } from "@/lib/styles/storage"

type Context = RouteContext<"/api/styles/[id]">

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params
  return respond(() => getStyle(id))
}

// Rename (`name`), reorder the board (`order`: file names), or replace the
// guide by hand (`guide`; null clears it, so the next read starts afresh).
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params
  const body = (await request.json().catch(() => null)) as {
    name?: unknown
    order?: unknown
    guide?: unknown
  } | null
  if (!body) return Response.json({ error: "Nothing to change" }, { status: 400 })

  const name = typeof body.name === "string" ? cleanName(body.name) : undefined
  if (body.name !== undefined && !name) return Response.json({ error: "Name the style" }, { status: 400 })
  const order = Array.isArray(body.order) && body.order.every((f) => typeof f === "string") ? (body.order as string[]) : null
  const guide = body.guide === null ? null : body.guide !== undefined ? toGuide(body.guide) : undefined
  if (body.guide && !guide) return Response.json({ error: "The guide needs a summary or a prompt" }, { status: 400 })

  return respond(async () => {
    if (order) await reorderImages(id, order)
    if (name === undefined && guide === undefined) return getStyle(id)
    return updateStyle(id, (s) => ({
      ...s,
      ...(name !== undefined && { name }),
      ...(guide !== undefined && {
        guide,
        guideEdited: guide !== null,
        guideStatus: s.guideStatus === "error" ? "idle" : s.guideStatus,
        guideError: undefined,
      }),
    }))
  })
}

export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params
  return respond(() => deleteStyle(id))
}
