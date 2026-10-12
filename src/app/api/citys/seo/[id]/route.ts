import { respond } from "@/lib/mockups/respond"
import { deleteRun, editProposal, seoRun, type ProposalEdit } from "@/lib/citys/seo"

// One SEO analysis: read it, change or drop a proposal (PATCH { listingId,
// title?, tags?, status? }), or remove it.
export async function GET(_request: Request, ctx: RouteContext<"/api/citys/seo/[id]">) {
  const { id } = await ctx.params
  return respond(() => seoRun(id))
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/citys/seo/[id]">) {
  const { id } = await ctx.params
  const edit = (await request.json().catch(() => null)) as ProposalEdit | null
  if (!edit || !Number.isInteger(edit.listingId)) return Response.json({ error: "Which listing?" }, { status: 400 })
  return respond(() => editProposal(id, edit))
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/citys/seo/[id]">) {
  const { id } = await ctx.params
  return respond(() => deleteRun(id))
}
