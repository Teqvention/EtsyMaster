import { cropRefs } from "@/lib/citys/refs"
import { respond } from "@/lib/mockups/respond"

// Takes the posters out of listing photos again (JSON `{ refs: [{ listingId, shopId, image, title }] }`).
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { refs?: unknown } | null
  const refs = (Array.isArray(body?.refs) ? body.refs : []).filter(
    (r): r is { listingId: number; shopId: number; image: string; title: string } =>
      !!r && Number.isInteger(r.listingId) && Number.isInteger(r.shopId) && typeof r.image === "string" && typeof r.title === "string"
  )
  return respond(async () => ({ queued: await cropRefs(refs, { again: true }) }))
}
