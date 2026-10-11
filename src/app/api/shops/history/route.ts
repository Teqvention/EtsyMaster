import { respond } from "@/lib/etsy/respond"
import { isShopOp } from "@/lib/shops/history-ops"
import {
  changeShopHistory,
  getShopHistory,
  importShopHistory,
  isShopHistory,
} from "@/lib/shops/history-store"

// The Shops page's list of shops, kept in the database.
export async function GET() {
  return respond(getShopHistory)
}

// Apply changes to it (JSON `{ ops: ShopOp[] }`); answers with the list.
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as { ops?: unknown } | null
  if (!Array.isArray(body?.ops) || !body.ops.every(isShopOp)) {
    return Response.json({ error: "Changes to the shop list are required" }, { status: 400 })
  }
  return respond(() => changeShopHistory(body.ops as Parameters<typeof changeShopHistory>[0]))
}

// Fold a whole copy of it in (JSON `{ [shopId]: ShopVisit }`), as an older
// browser keeps one; nothing is removed. Answers with the list.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null)
  if (!isShopHistory(body)) {
    return Response.json({ error: "A shop list is required" }, { status: 400 })
  }
  return respond(() => importShopHistory(body))
}
