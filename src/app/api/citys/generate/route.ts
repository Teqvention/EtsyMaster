import { startCityJobs, type CityJob } from "@/lib/citys/generate"
import { cleanRequest } from "@/lib/citys/templates"
import { enqueue } from "@/lib/generation/run"
import { respond } from "@/lib/mockups/respond"

// City posters to paint (JSON `{ jobs: CityJob[] }`): each a place, maybe a
// reference photo, and what to make of it. Answers the generation sets.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { jobs?: unknown } | null
  const jobs: CityJob[] = (Array.isArray(body?.jobs) ? body.jobs : [])
    .filter((j) => j && typeof j.placeId === "string" && typeof j.place === "string")
    .slice(0, 400)
    .map((j) => ({
      placeId: j.placeId,
      place: j.place,
      country: typeof j.country === "string" ? j.country : "",
      ...(j.ref && Number.isInteger(j.ref.listingId) && {
        ref: {
          listingId: j.ref.listingId,
          shopId: Number(j.ref.shopId) || 0,
          shop: String(j.ref.shop ?? ""),
          title: String(j.ref.title ?? ""),
          image: String(j.ref.image ?? ""),
          tags: Array.isArray(j.ref.tags) ? j.ref.tags.filter((t: unknown) => typeof t === "string").slice(0, 13) : [],
          labels: Array.isArray(j.ref.labels) ? j.ref.labels.filter((t: unknown) => typeof t === "string") : [],
          ...(Number.isInteger(j.ref.print) && { print: j.ref.print }),
        },
      }),
      request: cleanRequest(j.request),
    }))
  if (!jobs.length) return Response.json({ error: "Nothing to make" }, { status: 400 })
  return respond(async () => ({ sets: await startCityJobs(jobs, enqueue) }))
}
