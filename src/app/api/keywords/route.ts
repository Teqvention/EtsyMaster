import { addShop, overview, removeShop } from "@/lib/keywords/library"
import type { LibraryShopRequest } from "@/lib/keywords/types"
import { respond } from "@/lib/mockups/respond"

// The keyword library: its statistics (GET), a shop added or updated with its
// analysed listings (POST `LibraryShopRequest`), a shop taken out (DELETE
// `{ shopId }`). Each answers with the new overview.

export async function GET() {
  return respond(overview)
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as LibraryShopRequest | null
  if (!isRequest(body)) {
    return Response.json({ error: "A shop and its listings are required" }, { status: 400 })
  }
  return respond(() => addShop(body))
}

export async function DELETE(request: Request) {
  const { shopId } = (await request.json().catch(() => ({}))) as { shopId?: unknown }
  if (!Number.isInteger(shopId)) return Response.json({ error: "A shop id is required" }, { status: 400 })
  return respond(() => removeShop(shopId as number))
}

function isRequest(body: LibraryShopRequest | null): body is LibraryShopRequest {
  return (
    !!body &&
    Number.isInteger(body.shop?.id) &&
    typeof body.shop?.name === "string" &&
    Array.isArray(body.listings) &&
    body.listings.length > 0 &&
    body.listings.every(
      (l) =>
        Number.isInteger(l.id) &&
        typeof l.title === "string" &&
        Array.isArray(l.tags) &&
        l.tags.every((t) => typeof t === "string") &&
        Number.isFinite(l.salesPerMonth)
    )
  )
}
