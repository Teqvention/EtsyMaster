import { digests } from "@/lib/citys/digest"
import { readTitles } from "@/lib/citys/read"
import { respond } from "@/lib/mockups/respond"

// A look at how titles are read, without keeping it: `count` listings of a
// shop (JSON `{ shopId, count, offset }`), as read.
export async function POST(request: Request) {
  const { shopId, count = 40, offset = 0 } = (await request.json().catch(() => ({}))) as { shopId?: number; count?: number; offset?: number }
  if (!Number.isInteger(shopId)) return Response.json({ error: "shopId is required" }, { status: 400 })
  return respond(async () => {
    const digest = (await digests([shopId!])).get(shopId!)
    if (!digest) throw new Error("The shop has no analysis")
    const listings = digest.listings.slice(offset, offset + Math.min(count, 150)).map((l) => ({ id: l.id, title: l.title, tags: l.tags }))
    const started = Date.now()
    const reads = await readTitles(listings)
    return { ms: Date.now() - started, items: listings.map((l) => ({ title: l.title, read: reads.get(l.id) ?? null })) }
  })
}
