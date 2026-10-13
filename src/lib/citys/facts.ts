import { readDoc, readDocs, writeDoc } from "@/lib/db/documents"
import { askJson } from "@/lib/mockups/gemini"

import type { PlaceFacts } from "./composition/model"
import { countryName } from "./geo"
import { register } from "./places"

// What a composition's placeholders say about a place: its name as printed,
// country, region, a three-letter code, coordinates, a tagline, a short
// paragraph about it, a longer story for layouts with columns of copy, when
// it was founded and its best-known sight. Written once per place by Gemini
// (several places a request) and kept in citys/facts/<placeId>; changed by
// hand, it stays as changed. Facts written before stories get theirs added.

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
  // Facts from before stories: theirs written now, the rest left as it is.
  const storyless = places.filter((p) => found.get(p.id) && !found.get(p.id)!.story)
  for (let at = 0; at < storyless.length; at += 5) {
    try {
      const stories = await writeStories(storyless.slice(at, at + 5).map((p) => found.get(p.id) as Stored))
      for (const [id, story] of stories) found.set(id, { ...found.get(id)!, story })
    } catch (error) {
      console.error("Place stories:", error)
    }
  }
  return found
}

const STORIES_SCHEMA = {
  type: "OBJECT",
  properties: { stories: { type: "ARRAY", items: { type: "OBJECT", properties: { i: { type: "INTEGER" }, story: { type: "STRING" } }, required: ["i", "story"] } } },
  required: ["stories"],
}

/** The long text of each of these places, added to its facts. */
async function writeStories(facts: Stored[]) {
  const answer = await askJson<{ stories?: { i?: number; story?: string }[] }>(
    `You write the copy of city and travel posters that carry a long text in columns under the picture. For each place below, write "story": 220 to 300 words in plain flowing prose (no headings, no lists), what the place is like, its history in a few strokes, what you see and do there, its seasons and its character. Begin with the place's name as the first sentence's subject ("Chicago rises from…"): posters set it in bold as a lead-in. Factually correct, warm and concrete, no superlatives piled up, no "nestled", no "vibrant", no exclamation marks.

${STORY_LINES(facts)}`,
    [],
    { schema: STORIES_SCHEMA, temperature: 0.5 }
  )
  const out = new Map<string, string>()
  for (const item of answer.stories ?? []) {
    const f = typeof item.i === "number" ? facts[item.i - 1] : undefined
    const story = (item.story ?? "").trim()
    if (!f || story.split(/\s+/).length < 120) continue
    await writeDoc(DOC(f.placeId), { ...f, story })
    out.set(f.placeId, story)
  }
  return out
}

const STORY_LINES = (facts: Stored[]) => facts.map((f, i) => `${i + 1}. ${f.city}, ${f.country}${f.region ? ` (${f.region})` : ""}: ${f.description}`).join("\n")

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
          story: STRING,
          founded: STRING,
          landmark: STRING,
        },
        required: ["i", "city", "region", "code", "lat", "lng", "tagline", "description", "story", "founded", "landmark"],
      },
    },
  },
  required: ["places"],
}

async function writeFacts(places: { id: string; name: string; country: string }[]) {
  const reg = await register()
  const lines = places.map((p, i) => {
    const known = reg.places[p.id]
    // A sub-place made as a poster of its own: the city it's in goes under its name.
    const within = known?.parent ? reg.places[known.parent] : undefined
    return `${i + 1}. ${p.name}, ${countryName(p.country) || p.country}${known?.region ? ` (${known.region})` : ""}${known?.kind && known.kind !== "city" ? `, a ${known.kind}` : ""}${within && (within.kind === "city" || within.kind === "town" || within.kind === "district") ? ` in ${within.name}` : ""}`
  })
  const answer = await askJson<{ places?: { i?: number; city?: string; region?: string; code?: string; lat?: number; lng?: number; tagline?: string; description?: string; story?: string; founded?: string; landmark?: string }[] }>(
    `You write the small print of city and travel posters. For each place below, return:
- city: its name as it should be printed on the poster, in English, as buyers know it ("New York City", "Bondi Beach", "Lake Como").
- region: its state, province or region ("New York", "New South Wales", "Lombardy"), "" for a country; for a district, landmark or beach of a city, that city ("Honolulu" for Waikiki Beach, "New York City" for Central Park), as its name goes on the poster with the city beneath.
- code: three capital letters standing for it, its airport code where people know it ("NYC", "SYD", "PRG"), else a natural short form.
- lat, lng: coordinates of its centre in decimal degrees.
- tagline: one short line, at most 8 words, about what it is loved for, without clichés.
- description: one paragraph of 60 to 95 words a buyer enjoys reading under the picture: what the place is like, a bit of its history, what you see and do there. Factually correct, warm and concrete, no superlatives piled up, no "nestled", no "vibrant", no exclamation marks.
- story: a longer text of 220 to 300 words in the same voice for posters with columns of copy: what the place is like, its history in a few strokes, what you see and do there, its seasons and its character; plain flowing prose, no headings. Begin with the place's name as the first sentence's subject ("Chicago rises from…"): posters set it in bold as a lead-in.
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
      story: (item.story ?? "").trim(),
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
