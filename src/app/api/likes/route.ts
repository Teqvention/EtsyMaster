import { respond } from "@/lib/etsy/respond"
import { isLikeOp, isLikes } from "@/lib/likes/ops"
import { changeLikes, getLikes, importLikes } from "@/lib/likes/store"

// Liked listings, kept in the database.
export async function GET() {
  return respond(getLikes)
}

// Apply changes (JSON `{ ops: LikeOp[] }`); answers with every like.
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as { ops?: unknown } | null
  if (!Array.isArray(body?.ops) || !body.ops.every(isLikeOp)) {
    return Response.json({ error: "Changes to the likes are required" }, { status: 400 })
  }
  return respond(() => changeLikes(body.ops as Parameters<typeof changeLikes>[0]))
}

// Fold a copy in (JSON `{ [listingId]: LikedListing }`), as an older browser
// keeps one; nothing is removed. Answers with every like.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null)
  if (!isLikes(body)) return Response.json({ error: "Likes are required" }, { status: 400 })
  return respond(() => importLikes(body))
}
