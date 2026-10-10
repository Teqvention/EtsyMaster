import { respond } from "@/lib/etsy/respond"
import { getShopHistory, isShopHistory, putShopHistory } from "@/lib/shops/history-store"

// The Shops page's list of shops, kept on the server.
export async function GET() {
  return respond(getShopHistory)
}

// Replace it (JSON `{ [shopId]: ShopVisit }`).
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null)
  if (!isShopHistory(body)) {
    return Response.json({ error: "A shop list is required" }, { status: 400 })
  }
  return respond(() => putShopHistory(body))
}
