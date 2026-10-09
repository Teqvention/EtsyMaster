import { getListing } from "@/lib/etsy/listings"
import { respond } from "@/lib/etsy/respond"

// A single listing with its review count, for the detail panel.
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/listings/[listingId]">
) {
  const id = Number((await params).listingId)
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Invalid listing id" }, { status: 400 })
  }
  return respond(() => getListing(id))
}
