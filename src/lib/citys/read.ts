import { createHash } from "node:crypto"

import { readDoc, updateDoc } from "@/lib/db/documents"
import { askJson } from "@/lib/mockups/gemini"

import { LISTING_KINDS, LOOKS, PLACE_KINDS, type ListingRead, type RawPlace, type ShopRead } from "./types"

// Gemini reads listing titles for the places their posters show: what the
// listing sells (one place, a set, a custom pick, no place at all), how the
// poster is made when the title says it, and every place by its usual
// English name, kind and country, with the city a district or landmark
// belongs to. Titles go a batch at a time; what was read is kept per shop
// (citys/read/<shopId>) against a hash of the title, so only new and changed
// listings are read again. The names are matched to the register of places
// afterwards (places.ts).

export const READ = (shopId: number) => `citys/read/${shopId}`

/** Titles per request: enough to make a request worth it, few enough to keep each answer careful. */
export const BATCH = 100

export type TitleInput = { id: number; title: string; tags: string[] }

export const titleHash = (title: string) => createHash("sha1").update(title.trim().toLowerCase()).digest("hex").slice(0, 10)

export async function shopRead(shopId: number): Promise<ShopRead> {
  return readDoc<ShopRead>(READ(shopId), { shopId, listings: {}, updatedAt: "" })
}

/** The listings whose title hasn't been read yet (or changed since). */
export function unread(read: ShopRead, listings: TitleInput[]) {
  return listings.filter((l) => read.listings[l.id]?.h !== titleHash(l.title))
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          n: { type: "INTEGER" },
          k: { type: "STRING", enum: [...LISTING_KINDS] },
          s: { type: "STRING", enum: [...LOOKS] },
          p: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                kind: { type: "STRING", enum: [...PLACE_KINDS] },
                cc: { type: "STRING" },
                in: { type: "STRING" },
              },
              required: ["name", "kind", "cc", "in"],
              propertyOrdering: ["name", "kind", "cc", "in"],
            },
          },
        },
        required: ["n", "k", "s", "p"],
        propertyOrdering: ["n", "k", "s", "p"],
      },
    },
  },
  required: ["items"],
}

function prompt(listings: TitleInput[]) {
  const lines = listings.map((l, i) => {
    const tags = l.tags.slice(0, 8).join(", ")
    return `${i + 1}. ${l.title.replace(/\s+/g, " ").trim()}${tags ? `  ‖ tags: ${tags}` : ""}`
  })
  return `You read the listing titles of Etsy shops that sell city and travel wall art. For each numbered listing, say which real places its poster shows.

For every listing return:
- n: its number.
- k: what it sells.
  "place": a poster of one real place.
  "set": several real places sold together (a set of 3, a bundle, a gallery wall): list every place.
  "custom": the buyer picks the place or the words: custom, personalized, any city, choose your location, favourite places, your hometown, "any 3 prints of your choice".
  "theme": no real place: fictional or fantasy worlds (Hyrule, Tatooine, Hobbiton, Middle-earth), film or game scenes, animals, sports, art in the manner of a painter, quotes, or a beach, surf or mountain scene that names no real place.
- s: how the poster is made, only when the title says so: "photo" (photography, photo print, real photo), "bw" (black and white photo), "illustration" (illustration, retro or vintage travel poster, cartoon, flat, vector, digital art), "watercolor", "sketch" (line art, pencil, ink drawing), "painting" (oil, acrylic, impressionist), "map", "typography" (newspaper, text or coordinates designs), else "unknown".
- p: the places, the main one first; [] for custom and theme.
  name: the place's usual English name, complete, the way most buyers search it: "New York City" (never "NYC", "New York" for the city, "Manhattan NY"), "Washington, D.C.", "San Francisco", "Amalfi Coast", "Lake Como", "Yosemite National Park", "Mount Fuji", "Cinque Terre", "Scottish Highlands", "Lake District". A district, street or landmark keeps its own name: "Brooklyn", "Wall Street", "Upper West Side", "Golden Gate Bridge", "Central Park", "Shibuya Crossing", "Bondi Beach".
  kind: city (over about 50,000 people) | town (smaller towns and villages) | district (borough, neighbourhood, quarter, street) | landmark (building, bridge, monument, square, viewpoint, stadium) | beach | island | park (national or state park, big garden) | mountain | lake | coast (a named coastline) | region (a named area: Tuscany, Cotswolds, Scottish Highlands, Big Sur, Patagonia) | state (state, province) | country.
  cc: the ISO 3166-1 alpha-2 code of its country ("US", "GB", "IT", "JP").
  in: for a district, landmark or beach, the city it lies in or next to ("New York City" for Brooklyn and Wall Street, "San Francisco" for the Golden Gate Bridge, "Sydney" for Bondi Beach); for a landmark out in nature, its park or region ("Yosemite National Park" for Half Dome); otherwise "".

Rules:
- Only places the poster shows. A state or country next to a city is context, not a second place: "Austin Texas Poster" is Austin; "Texas Poster" on its own is the state. Ignore places named only as a market or gift ("USA Wall Art", "European Gift", "UK Poster", "Italy Print" after a named town).
- A landmark named with its city gives the city first, then the landmark: "Brooklyn Bridge New York Print" → New York City, then Brooklyn Bridge (in New York City). A landmark alone gives only the landmark, with its city in "in".
- A set lists each place it names ("Set of 3: Atrani, Capri, Positano" → the three towns). A set naming no single place lists its region or country.
- Read places in other languages as the English place: "Venedig" → Venice, "München" → Munich, "Wien" → Vienna.
- When a name could be two places, take the famous one unless the title says otherwise: Paris is in France, Florence in Italy, Santiago in Chile.

Listings:
${lines.join("\n")}`
}

type Answer = { items?: { n?: number; k?: string; s?: string; p?: { name?: string; kind?: string; cc?: string; in?: string }[] }[] }

const clean = (text: unknown, max = 80) => (typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, max) : "")

/** What Gemini reads off one batch of titles, by listing id; a listing missing from the answer is left out. */
export async function readTitles(listings: TitleInput[]): Promise<Map<number, ListingRead>> {
  const answer = await askJson<Answer>(prompt(listings), [], { schema: SCHEMA, temperature: 0, quick: true })
  const found = new Map<number, ListingRead>()
  for (const item of answer.items ?? []) {
    const listing = typeof item.n === "number" ? listings[item.n - 1] : undefined
    if (!listing) continue
    const k = LISTING_KINDS.includes(item.k as ListingRead["k"]) ? (item.k as ListingRead["k"]) : "theme"
    const places: RawPlace[] = (item.p ?? [])
      .map((p) => ({
        name: clean(p.name),
        kind: (PLACE_KINDS.includes(p.kind as RawPlace["kind"]) ? p.kind : "city") as RawPlace["kind"],
        country: clean(p.cc, 3).toUpperCase(),
        within: clean(p.in),
      }))
      .filter((p) => p.name.length > 1)
      .slice(0, 8)
    // A custom listing may still name its place ("Personalized Paris Poster"): its sales count there too.
    found.set(listing.id, {
      h: titleHash(listing.title),
      k: places.length || k === "custom" ? k : "theme",
      s: LOOKS.includes(item.s as ListingRead["s"]) ? (item.s as ListingRead["s"]) : "unknown",
      p: k === "theme" ? [] : places,
    })
  }
  return found
}

/** Keeps what was read for a shop, next to what it had. */
export async function saveRead(shopId: number, reads: Map<number, ListingRead>) {
  if (!reads.size) return
  await updateDoc<ShopRead>(READ(shopId), { shopId, listings: {}, updatedAt: "" }, (current) => {
    const listings = { ...current.listings }
    for (const [id, read] of reads) listings[id] = read
    return { shopId, listings, updatedAt: new Date().toISOString() }
  })
}
