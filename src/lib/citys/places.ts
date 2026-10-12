import { readDoc, updateDoc } from "@/lib/db/documents"
import { askJson } from "@/lib/mockups/gemini"

import { continentOf, nameKey, placeId } from "./geo"
import {
  PLACE_KINDS,
  SETTINGS,
  SIZES,
  SUB_KINDS,
  type Place,
  type PlaceKind,
  type PlaceRegister,
  type RawPlace,
  type Setting,
  type ShopRead,
} from "./types"

// The register of places (citys/places): every place the listings show,
// once. Titles were read for names as buyers search them; names new to the
// register go to Gemini a country at a time, with the places already known
// there that look alike, and come back matched to one of them or as a new
// place with what it's like (size, setting, tags, where it is). Famous names
// go first, so "Washington, D.C." is in before "Washington DC" asks to join.
// A place edited by hand keeps its edits.

export const PLACES = "citys/places"

const EMPTY: PlaceRegister = { places: {}, aliases: {}, known: {}, updatedAt: "" }

export async function register(): Promise<PlaceRegister> {
  const held = await readDoc<PlaceRegister | null>(PLACES, null)
  return held?.places ? held : EMPTY
}

/** A raw name's key in `known`: name, country and kind as read. */
export const rawKey = (p: RawPlace) => `${nameKey(p.name)}|${p.country || "*"}|${p.kind}`

const aliasKey = (name: string, country: string) => `${nameKey(name)}|${country || "*"}`

/** The place a raw name stands for, if the register knows it. */
export function resolve(reg: PlaceRegister, p: RawPlace): Place | null {
  const id = reg.known[rawKey(p)] ?? reg.aliases[aliasKey(p.name, p.country)]
  return (id && reg.places[id]) || null
}

/** A park named for a city's own green (Central Park, Hyde Park), not a national or state park out in nature. */
export const cityPark = (kind: string, name: string) => kind === "park" && !/\b(national|state|provincial)\b/i.test(name)

/** Whether a place folds into its parent in the ranking: districts, landmarks, beaches, and a city's own parks. */
export function foldsInto(place: Place, parent: Place | undefined) {
  if (SUB_KINDS.includes(place.kind)) return true
  return cityPark(place.kind, place.name) && !!parent && (parent.kind === "city" || parent.kind === "town" || parent.kind === "district")
}

/** Follows a place up to the place it folds into in the ranking (itself unless it's a district, landmark, beach or a city's park). */
export function rootOf(reg: PlaceRegister, place: Place): Place {
  let current = place
  for (let hops = 0; hops < 4 && current.parent; hops++) {
    const parent = reg.places[current.parent]
    if (!parent || parent.id === current.id || !foldsInto(current, parent)) break
    current = parent
  }
  return current
}

// --- Folding new names in ---

type Pending = { key: string; raw: RawPlace; count: number }

/**
 * Folds every raw name the reads hold that the register doesn't know yet
 * into it. Returns how many were new.
 */
export async function foldIn(reads: ShopRead[], progress?: (done: number, total: number) => void, stopped?: () => Promise<boolean>) {
  const reg = await register()
  const pending = new Map<string, Pending>()
  for (const read of reads) {
    for (const listing of Object.values(read.listings)) {
      for (const raw of listing.p) {
        const key = rawKey(raw)
        if (reg.known[key]) continue
        const entry = pending.get(key) ?? { key, raw, count: 0 }
        entry.count++
        pending.set(key, entry)
      }
    }
  }

  // Names the register already has under that spelling need no question.
  const direct = new Map<string, string>()
  for (const entry of pending.values()) {
    const id = reg.aliases[aliasKey(entry.raw.name, entry.raw.country)]
    if (id && reg.places[id]) direct.set(entry.key, id)
  }
  if (direct.size) await save((r) => ({ ...r, known: { ...r.known, ...Object.fromEntries(direct) } }))

  const asks = [...pending.values()].filter((e) => !direct.has(e.key))
  const byCountry = new Map<string, Pending[]>()
  for (const entry of asks.sort((a, b) => b.count - a.count)) {
    const country = entry.raw.country || "*"
    byCountry.set(country, [...(byCountry.get(country) ?? []), entry])
  }

  let done = 0
  const total = asks.length
  progress?.(done, total)
  // A country's batches one after another, so each sees the places the last
  // one made; three countries at a time.
  const countries = [...byCountry.entries()].sort((a, b) => b[1].length - a[1].length)
  await pool(countries, 4, async ([country, entries]) => {
    for (let at = 0; at < entries.length; at += FOLD_BATCH) {
      if (await stopped?.()) return
      const batch = entries.slice(at, at + FOLD_BATCH)
      try {
        await foldBatch(country, batch)
      } catch (error) {
        console.error(`City places, ${country}:`, error)
      }
      done += batch.length
      progress?.(done, total)
    }
  })
  if (!(await stopped?.())) await fillStubs()
  return total
}

// --- Places known only by name ---

const STUB_BATCH = 60

const STUB_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          kind: { type: "STRING", enum: [...PLACE_KINDS] },
          region: { type: "STRING" },
          size: { type: "STRING", enum: [...SIZES, "none"] },
          setting: { type: "STRING", enum: [...SETTINGS] },
          tags: { type: "ARRAY", items: { type: "STRING" } },
          lat: { type: "NUMBER" },
          lng: { type: "NUMBER" },
        },
        required: ["id", "kind", "region", "size", "setting", "tags", "lat", "lng"],
        propertyOrdering: ["id", "kind", "region", "size", "setting", "tags", "lat", "lng"],
      },
    },
  },
  required: ["items"],
}

/**
 * Places made up as a parent from a name alone ("New York City" when
 * Brooklyn came first) get what they're like: names matched to them since
 * went straight to the stub, so nobody asked. A country's stubs a batch at
 * a time, four countries at once.
 */
export async function fillStubs() {
  const reg = await register()
  const stubs = Object.values(reg.places).filter((p) => p.stub && !p.edited)
  const byCountry = new Map<string, Place[]>()
  for (const p of stubs) byCountry.set(p.country || "*", [...(byCountry.get(p.country || "*") ?? []), p])
  await pool([...byCountry], 4, async ([country, places]) => {
    for (let at = 0; at < places.length; at += STUB_BATCH) {
      const batch = places.slice(at, at + STUB_BATCH)
      const prompt = `You keep the register of places for a shop selling city and travel posters. Describe each of these places${country === "*" ? "" : ` in the country ${country}`} (id: name):
${batch.map((p) => `${p.id}: ${p.name}`).join("\n")}

For each return:
- id: as given.
- kind: city (over about 50,000 people) | town | district | landmark | beach | island | park | mountain | lake | coast | region | state | country.
- region: the state, province or region it is in ("California", "Tuscany", "Bavaria"), "" for countries.
- size: for a city or town, by its own population: "big" over 1 million, "mid" 100,000 to 1 million, "small" under 100,000; "none" for every other kind.
- setting: what a poster of it mostly shows: "city" (streets, skyline, buildings), "beach", "mountains", "lake", "island", "nature" (parks, forests, deserts, canyons, waterfalls, coastlines, countryside), "region" (a state, country or large area as a whole).
- tags: 3 to 8 lower case words or short phrases of what it is like and known for, for search ("beach", "skyline", "historic", "canals", "national park", "ski", "capital"…), plus a well known area it belongs to ("amalfi coast", "cotswolds").
- lat, lng: its coordinates in decimal degrees.`
      try {
        const answer = await askJson<FoldAnswer & { items?: { id?: string }[] }>(prompt, [], { schema: STUB_SCHEMA, temperature: 0, quick: true })
        await save((current) => {
          const places = { ...current.places }
          for (const item of answer.items ?? []) {
            const existing = item.id ? places[item.id] : undefined
            if (!existing?.stub || existing.edited) continue
            const kind = (PLACE_KINDS.includes(item.kind as PlaceKind) ? item.kind : existing.kind) as PlaceKind
            places[existing.id] = {
              ...existing,
              kind,
              ...(clean(item.region) && { region: clean(item.region) }),
              ...((kind === "city" || kind === "town") && SIZES.includes(item.size as Place["size"] & string) && { size: item.size as Place["size"] }),
              setting: (SETTINGS.includes(item.setting as Setting) ? item.setting : settingOf(kind)) as Setting,
              tags: [...new Set((item.tags ?? []).map((t) => clean(t, 30).toLowerCase()).filter(Boolean))].slice(0, 10),
              ...(Number.isFinite(item.lat) && Number.isFinite(item.lng) && { lat: round(item.lat!), lng: round(item.lng!) }),
              stub: undefined,
            }
          }
          return { ...current, places }
        })
      } catch (error) {
        console.error(`City places, details for ${country}:`, error)
      }
    }
  })
  return stubs.length
}

const FOLD_BATCH = 120
/** Known places of the country shown with a batch at most. */
const MAX_KNOWN = 250

const FOLD_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          i: { type: "INTEGER" },
          same: { type: "STRING" },
          name: { type: "STRING" },
          kind: { type: "STRING", enum: [...PLACE_KINDS] },
          parent: { type: "STRING" },
          region: { type: "STRING" },
          size: { type: "STRING", enum: [...SIZES, "none"] },
          setting: { type: "STRING", enum: [...SETTINGS] },
          tags: { type: "ARRAY", items: { type: "STRING" } },
          lat: { type: "NUMBER" },
          lng: { type: "NUMBER" },
        },
        required: ["i", "same", "name", "kind", "parent", "region", "size", "setting", "tags", "lat", "lng"],
        propertyOrdering: ["i", "same", "name", "kind", "parent", "region", "size", "setting", "tags", "lat", "lng"],
      },
    },
  },
  required: ["items"],
}

type FoldAnswer = {
  items?: {
    i?: number
    same?: string
    name?: string
    kind?: string
    parent?: string
    region?: string
    size?: string
    setting?: string
    tags?: string[]
    lat?: number
    lng?: number
  }[]
}

/** Known places of `country` that look like any of `names`: sharing a word, or the start of one. */
function lookalikes(reg: PlaceRegister, country: string, names: string[]) {
  const words = new Set(names.flatMap((n) => nameKey(n).split(" ").filter((w) => w.length > 2)))
  const starts = new Set(names.map((n) => nameKey(n).slice(0, 4)))
  const scored: { place: Place; score: number }[] = []
  for (const place of Object.values(reg.places)) {
    if (place.country !== country) continue
    const key = nameKey(place.name)
    const shared = key.split(" ").filter((w) => words.has(w)).length
    const score = shared * 2 + (starts.has(key.slice(0, 4)) ? 1 : 0)
    if (score > 0) scored.push({ place, score })
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_KNOWN)
    .map((s) => s.place)
}

function foldPrompt(country: string, batch: Pending[], known: Place[]) {
  const lines = batch.map((e, i) => {
    const within = e.raw.within ? ` · in ${e.raw.within}` : ""
    return `${i + 1}. ${e.raw.name} · ${e.raw.kind}${within} · on ${e.count} listing${e.count === 1 ? "" : "s"}`
  })
  const knownLines = known.map((p) => `${p.id}: ${p.name} (${p.kind}${p.parent ? `, in ${p.parent}` : ""})`)
  return `You keep the register of places for a shop selling city and travel posters. Below are place names read off Etsy listing titles, all in the country ${country === "*" ? "(unknown)" : country}. For each, say which place it is.

${knownLines.length ? `PLACES ALREADY IN THE REGISTER (id: name):\n${knownLines.join("\n")}\n\n` : ""}NAMES TO PLACE:
${lines.join("\n")}

For each name return:
- i: its number.
- same: the id of the register place it is (another spelling, a nickname, the same city), else "". Only when it is truly the same place: Brooklyn is not New York City (it is a district in it), the state of New York is not the city.
- name: the place's usual English name, complete, as most buyers search it ("New York City", "Washington, D.C.", "Saint Petersburg", "Mount Rainier National Park"). Names in this batch that are the same place get the same name.
- kind: city (over about 50,000 people) | town | district | landmark | beach | island | park | mountain | lake | coast | region | state | country.
- parent: for a district, landmark, beach, or a park or garden inside a city, the usual English name of the city (or park, region) it belongs to, e.g. "New York City" for Brooklyn and Central Park, "Sydney" for Bondi Beach, "Yosemite National Park" for Half Dome; else "".
- region: the state, province or region it is in ("California", "Tuscany", "Bavaria"), "" for countries.
- size: for a city or town, by its own population: "big" over 1 million, "mid" 100,000 to 1 million, "small" under 100,000; "none" for every other kind.
- setting: what a poster of it mostly shows: "city" (streets, skyline, buildings), "beach" (beaches and beach towns), "mountains", "lake", "island", "nature" (parks, forests, deserts, canyons, waterfalls, coastlines, countryside), "region" (a state, country or large area as a whole).
- tags: 3 to 8 lower case words or short phrases of what it is like and known for, for search: e.g. "beach", "coastal", "skyline", "historic", "old town", "canals", "harbor", "mountains", "ski", "lake", "island", "desert", "tropical", "snow", "national park", "waterfall", "vineyards", "castle", "capital", "college town", plus a well known area it belongs to ("amalfi coast", "cotswolds", "french riviera").
- lat, lng: its coordinates in decimal degrees.`
}

async function foldBatch(country: string, batch: Pending[]) {
  const reg = await register()
  const known = lookalikes(reg, country, batch.map((e) => e.raw.name))
  // Matching names is look-up work: little thinking keeps ten thousand of them to minutes.
  const answer = await askJson<FoldAnswer>(foldPrompt(country, batch, known), [], {
    schema: FOLD_SCHEMA,
    temperature: 0,
    quick: true,
  })
  await save((current) => {
    const next: PlaceRegister = {
      ...current,
      places: { ...current.places },
      aliases: { ...current.aliases },
      known: { ...current.known },
    }
    for (const item of answer.items ?? []) {
      const entry = typeof item.i === "number" ? batch[item.i - 1] : undefined
      if (!entry) continue
      const cc = entry.raw.country || country
      const same = item.same && next.places[item.same] ? item.same : null
      const name = clean(item.name) || entry.raw.name
      const id = same ?? placeId(name, cc)
      const existing = next.places[id]
      if (!existing) {
        const kind = (PLACE_KINDS.includes(item.kind as PlaceKind) ? item.kind : entry.raw.kind) as PlaceKind
        const parentName = clean(item.parent) || (SUB_KINDS.includes(kind) || cityPark(kind, name) ? entry.raw.within : "")
        const parent = parentName ? ensureParent(next, parentName, cc) : undefined
        next.places[id] = {
          id,
          name,
          kind,
          ...(parent && parent !== id && { parent }),
          country: cc === "*" ? "" : cc,
          ...(clean(item.region) && { region: clean(item.region) }),
          continent: continentOf(cc),
          ...((kind === "city" || kind === "town") && SIZES.includes(item.size as Place["size"] & string) && { size: item.size as Place["size"] }),
          setting: (SETTINGS.includes(item.setting as Setting) ? item.setting : settingOf(kind)) as Setting,
          tags: [...new Set((item.tags ?? []).map((t) => clean(t, 30).toLowerCase()).filter(Boolean))].slice(0, 10),
          ...(Number.isFinite(item.lat) && Number.isFinite(item.lng) && { lat: round(item.lat!), lng: round(item.lng!) }),
          aliases: [],
        }
      } else if (existing.stub && !existing.edited) {
        // A parent made up earlier from a name alone gets what it's like now.
        const kind = (PLACE_KINDS.includes(item.kind as PlaceKind) ? item.kind : existing.kind) as PlaceKind
        next.places[id] = {
          ...existing,
          kind,
          ...(clean(item.region) && { region: clean(item.region) }),
          ...((kind === "city" || kind === "town") && SIZES.includes(item.size as Place["size"] & string) && { size: item.size as Place["size"] }),
          setting: (SETTINGS.includes(item.setting as Setting) ? item.setting : settingOf(kind)) as Setting,
          tags: [...new Set((item.tags ?? []).map((t) => clean(t, 30).toLowerCase()).filter(Boolean))].slice(0, 10),
          ...(Number.isFinite(item.lat) && Number.isFinite(item.lng) && { lat: round(item.lat!), lng: round(item.lng!) }),
          stub: undefined,
        }
      }
      const place = next.places[id]
      const alias = nameKey(entry.raw.name)
      if (alias !== nameKey(place.name) && !place.aliases.includes(alias)) {
        next.places[id] = { ...place, aliases: [...place.aliases, alias] }
      }
      next.aliases[aliasKey(entry.raw.name, cc)] = id
      next.aliases[aliasKey(place.name, cc)] = id
      next.known[entry.key] = id
    }
    return next
  })
}

/** The id of the place called `name` in `country`, made up as a stub city when there's none yet. */
function ensureParent(reg: PlaceRegister, name: string, country: string) {
  const known = reg.aliases[aliasKey(name, country)]
  if (known && reg.places[known]) return known
  const id = placeId(name, country)
  if (!reg.places[id]) {
    reg.places[id] = {
      id,
      name,
      kind: "city",
      country: country === "*" ? "" : country,
      continent: continentOf(country),
      setting: "city",
      tags: [],
      aliases: [],
      stub: true,
    }
  }
  reg.aliases[aliasKey(name, country)] = id
  return id
}

export function settingOf(kind: PlaceKind): Setting {
  if (kind === "beach") return "beach"
  if (kind === "island") return "island"
  if (kind === "mountain") return "mountains"
  if (kind === "lake") return "lake"
  if (kind === "park" || kind === "coast") return "nature"
  if (kind === "region" || kind === "state" || kind === "country") return "region"
  return "city"
}

function save(change: (reg: PlaceRegister) => PlaceRegister) {
  return updateDoc<PlaceRegister | null>(PLACES, null, (current) => {
    const reg = current?.places ? current : EMPTY
    return { ...change(reg), updatedAt: new Date().toISOString() }
  })
}

// --- Edits by hand ---

export type PlaceEdit = Partial<Pick<Place, "name" | "kind" | "parent" | "region" | "size" | "setting" | "tags">>

/** Changes a place by hand; a new read never overwrites it. */
export async function editPlace(id: string, edit: PlaceEdit) {
  let changed: Place | null = null
  await save((reg) => {
    const place = reg.places[id]
    if (!place) throw new Error("Unknown place")
    const next: Place = { ...place, edited: true }
    if (edit.name !== undefined && clean(edit.name)) next.name = clean(edit.name)
    if (edit.kind !== undefined && PLACE_KINDS.includes(edit.kind)) next.kind = edit.kind
    if (edit.parent !== undefined) {
      if (edit.parent && reg.places[edit.parent] && edit.parent !== id) next.parent = edit.parent
      else delete next.parent
    }
    if (edit.region !== undefined) next.region = clean(edit.region) || undefined
    if (edit.size !== undefined) next.size = SIZES.includes(edit.size as never) ? edit.size : undefined
    if (edit.setting !== undefined && SETTINGS.includes(edit.setting)) next.setting = edit.setting
    if (edit.tags !== undefined) next.tags = [...new Set(edit.tags.map((t) => clean(t, 30).toLowerCase()).filter(Boolean))]
    changed = next
    return { ...reg, places: { ...reg.places, [id]: next } }
  })
  return changed
}

/** Folds place `from` into `into`: its names, sub-places and listings go there. */
export async function mergePlaces(from: string, into: string) {
  if (from === into) throw new Error("A place can't be merged into itself")
  await save((reg) => {
    const source = reg.places[from]
    const target = reg.places[into]
    if (!source || !target) throw new Error("Unknown place")
    const places = { ...reg.places }
    delete places[from]
    places[into] = {
      ...target,
      aliases: [...new Set([...target.aliases, nameKey(source.name), ...source.aliases])],
      tags: [...new Set([...target.tags, ...source.tags])],
      edited: true,
    }
    for (const [id, place] of Object.entries(places)) if (place.parent === from) places[id] = { ...place, parent: into }
    const remap = (map: Record<string, string>) =>
      Object.fromEntries(Object.entries(map).map(([key, id]) => [key, id === from ? into : id]))
    return { ...reg, places, aliases: remap(reg.aliases), known: remap(reg.known) }
  })
}

// --- Helpers ---

const clean = (text: unknown, max = 80) => (typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, max) : "")
const round = (n: number) => Math.round(n * 10_000) / 10_000

/** Runs `work` on every item, `limit` at a time. */
export async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++])
    })
  )
}
