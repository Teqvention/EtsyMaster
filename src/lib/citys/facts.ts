import { readDoc, readDocs, writeDoc } from "@/lib/db/documents"
import { askJson } from "@/lib/mockups/gemini"

import type { PlaceFacts } from "./composition/model"
import { countryName } from "./geo"
import { register } from "./places"

// What a composition's placeholders say about a place: its name as printed,
// country, region, a three-letter code, coordinates, a tagline, a short
// paragraph about it, when it was founded and its best-known sight. Written
// once per place by Gemini (several places a request) and kept in
// citys/facts/<placeId>; changed by hand, it stays as changed.

const DOC = (placeId: string) => `citys/facts/${placeId}`

type Stored = PlaceFacts & { placeId: string; edited?: boolean; at: string }

export async function placeFacts(placeId: string): Promise<PlaceFacts | null> {
  const held = await readDoc<Stored | null>(DOC(placeId), null)
  return held ?? null
}

/** The facts of every place asked for, written for those that have none yet. */
export async function factsFor(places: { id: string; name: string; country: string }[]): Promise<Map<string, PlaceFacts>> {
  const found = new Map<string, PlaceFacts>()
  const held = await readDocs<Stored>("citys/facts/")
  const missing: typeof places = []
  for (const p of places) {
    const f = held.get(DOC(p.id))
    if (f) found.set(p.id, f)
    else missing.push(p)
  }
  for (let at = 0; at < missing.length; at += 15) {
    const batch = missing.slice(at, at + 15)
    try {
      const written = await writeFacts(batch)
      for (const [id, f] of written) found.set(id, f)
    } catch (error) {
      console.error("Place facts:", error)
    }
  }
  return found
}

const STRING = { type: "STRING" }
const SCHEMA = {
  type: "OBJECT",
  properties: {
    places: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          i: { type: "INTEGER" },
          city: STRING,
          region: STRING,
          code: STRING,
          lat: { type: "NUMBER" },
          lng: { type: "NUMBER" },
          tagline: STRING,
          description: STRING,
          founded: STRING,
          landmark: STRING,
        },
        required: ["i", "city", "region", "code", "lat", "lng", "tagline", "description", "founded", "landmark"],
      },
    },
  },
  required: ["places"],
}

async function writeFacts(places: { id: string; name: string; country: string }[]) {
  const reg = await register()
  const lines = places.map((p, i) => {
    const known = reg.places[p.id]
    return `${i + 1}. ${p.name}, ${countryName(p.country) || p.country}${known?.region ? ` (${known.region})` : ""}${known?.kind && known.kind !== "city" ? `, a ${known.kind}` : ""}`
  })
  const answer = await askJson<{ places?: { i?: number; city?: string; region?: string; code?: string; lat?: number; lng?: number; tagline?: string; description?: string; founded?: string; landmark?: string }[] }>(
    `You write the small print of city and travel posters. For each place below, return:
- city: its name as it should be printed on the poster, in English, as buyers know it ("New York City", "Bondi Beach", "Lake Como").
- region: its state, province or region ("New York", "New South Wales", "Lombardy"), "" for a country.
- code: three capital letters standing for it, its airport code where people know it ("NYC", "SYD", "PRG"), else a natural short form.
- lat, lng: coordinates of its centre in decimal degrees.
- tagline: one short line, at most 8 words, about what it is loved for, without clichés.
- description: one paragraph of 60 to 95 words a buyer enjoys reading under the picture: what the place is like, a bit of its history, what you see and do there. Factually correct, warm and concrete, no superlatives piled up, no "nestled", no "vibrant", no exclamation marks.
- founded: the year (or "c. 880", "12th century") it was founded or first recorded; "" for nature and when it isn't known.
- landmark: its best-known sight, as named in English.

Places:
${lines.join("\n")}`,
    [],
    { schema: SCHEMA, temperature: 0.4 }
  )
  const out = new Map<string, PlaceFacts>()
  for (const item of answer.places ?? []) {
    const place = typeof item.i === "number" ? places[item.i - 1] : undefined
    if (!place) continue
    const facts: Stored = {
      placeId: place.id,
      city: (item.city ?? place.name).trim() || place.name,
      country: countryName(place.country) || place.country,
      region: (item.region ?? "").trim(),
      code: (item.code ?? "").trim().toUpperCase().slice(0, 4),
      lat: Number.isFinite(item.lat) ? Math.round(item.lat! * 10_000) / 10_000 : null,
      lng: Number.isFinite(item.lng) ? Math.round(item.lng! * 10_000) / 10_000 : null,
      tagline: (item.tagline ?? "").trim(),
      description: (item.description ?? "").trim(),
      founded: (item.founded ?? "").trim(),
      landmark: (item.landmark ?? "").trim(),
      at: new Date().toISOString(),
    }
    await writeDoc(DOC(place.id), facts)
    out.set(place.id, facts)
  }
  return out
}

export async function editFacts(placeId: string, patch: Partial<PlaceFacts>) {
  const held = await readDoc<Stored | null>(DOC(placeId), null)
  if (!held) throw new Error("No facts for that place yet")
  const next: Stored = { ...held, ...patch, placeId, edited: true, at: new Date().toISOString() }
  await writeDoc(DOC(placeId), next)
  return next
}
