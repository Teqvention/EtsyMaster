import { createCityStyle } from "@/lib/citys/styles"
import { respond } from "@/lib/mockups/respond"

// A new, empty city style (JSON `{ name, tags? }`); its images are added like any style's.
export async function POST(request: Request) {
  const { name, tags } = (await request.json().catch(() => ({}))) as { name?: unknown; tags?: unknown }
  if (typeof name !== "string" || !name.trim()) return Response.json({ error: "Name the style" }, { status: 400 })
  const list = Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : []
  return respond(() => createCityStyle(name, list))
}
