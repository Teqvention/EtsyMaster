import { editFacts, factsFor } from "@/lib/citys/facts"
import { respond } from "@/lib/mockups/respond"

// What the placeholders say about places (POST `{ places: [{ id, name, country }] }`, written for those without),
// or one place's facts changed by hand (PATCH `{ placeId, ...facts }`).
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { places?: unknown } | null
  const places = (Array.isArray(body?.places) ? body.places : [])
    .filter((p): p is { id: string; name: string; country: string } => !!p && typeof p.id === "string" && typeof p.name === "string")
    .slice(0, 60)
    .map((p) => ({ id: p.id, name: p.name, country: typeof p.country === "string" ? p.country : "" }))
  return respond(async () => Object.fromEntries(await factsFor(places)))
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as ({ placeId?: unknown } & Record<string, unknown>) | null
  if (typeof body?.placeId !== "string") return Response.json({ error: "Which place?" }, { status: 400 })
  const { placeId, ...patch } = body
  return respond(() => editFacts(placeId as string, patch))
}
