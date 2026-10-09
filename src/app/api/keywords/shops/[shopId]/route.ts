import { libraryMembership } from "@/lib/keywords/library"

// Whether the shop is in the keyword library: `{ updatedAt, listings }` or 404.
export async function GET(_request: Request, { params }: RouteContext<"/api/keywords/shops/[shopId]">) {
  const id = Number((await params).shopId)
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Invalid shop id" }, { status: 400 })
  const membership = await libraryMembership(id)
  return membership ? Response.json(membership) : Response.json({ error: "Not in the library" }, { status: 404 })
}
