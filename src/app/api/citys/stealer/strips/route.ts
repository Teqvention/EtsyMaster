import { stealerStrips } from "@/lib/citys/stealer"
import { respond } from "@/lib/mockups/respond"

// The best references of many places at once (JSON `{ places, per, photos }`).
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { places?: unknown; per?: unknown; photos?: unknown } | null
  const places = Array.isArray(body?.places) ? body.places.filter((p): p is string => typeof p === "string") : []
  const per = Math.max(1, Math.min(16, Number(body?.per) || 8))
  return respond(() => stealerStrips(places, per, body?.photos === true))
}
