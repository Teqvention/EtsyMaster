import { respond } from "@/lib/etsy/respond"
import { getStoredAnalysis, isStoredAnalysis, storeAnalysis } from "@/lib/shops/analysis-store"

// The shop's last analysis, kept on the server (404 when never analysed).
export async function GET(_request: Request, { params }: RouteContext<"/api/shops/[shopId]/analysis">) {
  const id = Number((await params).shopId)
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Invalid shop id" }, { status: 400 })
  }
  return respond(() => getStoredAnalysis(id))
}

// Replace it with a run that just settled (JSON `StoredAnalysis`).
export async function PUT(request: Request, { params }: RouteContext<"/api/shops/[shopId]/analysis">) {
  const id = Number((await params).shopId)
  const body = await request.json().catch(() => null)
  if (!isStoredAnalysis(body) || body.shop.id !== id) {
    return Response.json({ error: "An analysis of this shop is required" }, { status: 400 })
  }
  return respond(() => storeAnalysis(body))
}
