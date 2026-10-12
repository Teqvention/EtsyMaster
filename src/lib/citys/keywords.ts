import { readDoc, updateDoc, writeDoc } from "@/lib/db/documents"
import { askJson } from "@/lib/mockups/gemini"

import { countryName, nameKey } from "./geo"
import { register } from "./places"
import { rankingState, type RefEntry } from "./ranking"
import type { Place, PlaceRegister } from "./types"

// City keywords: what the city shops' tags and titles say once the place is
// taken out. On a New York listing "brooklyn bridge print" is "{landmark}
// print", "nyc wall art" is "{city} wall art", "usa travel gift" is
// "{country} travel gift"; "travel poster" stays as it is. Every listing
// counts by its sales a month (favourites stand in for listings too new to
// sell), so a pattern is as strong as the listings using it sell. Patterns
// many places share make the shop's keyword system; place-free keywords
// used across many places are the pool to vary from; what only one place's
// listings use is that place's own vocabulary, looked up per place.
//
// The strategy is written by Gemini from the research and edited by hand:
// which patterns every listing carries, which rotate between listings,
// which keywords to avoid (too niche, misleading, trademarks), how titles
// are built, and the keywords of each city style. The copywriter and the
// SEO analysis both follow it.

const RESEARCH = "citys/keywords/research"
const STRATEGY = "citys/keywords/strategy"

export const TOKENS = ["{city}", "{landmark}", "{region}", "{country}", "{demonym}"] as const

/** A keyword or pattern, with how the listings using it sell. */
export type KeywordStat = {
  keyword: string
  /** Sales a month of the listings using it (favourites counted in for new ones). */
  weight: number
  listings: number
  places: number
  shops: number
  /** Share of all listings looked at that use it, 0–1. */
  share: number
}

export type KeywordResearch = {
  madeAt: string
  listings: number
  shops: number
  places: number
  /** Tags with a place in them, the place made a token: "{city} wall art". */
  patterns: KeywordStat[]
  /** Tags without a place, used across many places: "travel poster". */
  generic: KeywordStat[]
  /** How titles start (up to the first comma or dash), the place made a token. */
  openers: KeywordStat[]
  /** Title parts after the first, the place made a token: "{country} wall art". */
  segments: KeywordStat[]
  /** Keywords the shops of each secondary label use more than the rest: how each look is searched. */
  labels: { label: string; listings: number; keywords: (KeywordStat & { lift: number })[] }[]
}

export type KeywordStrategy = {
  /** Patterns every listing carries in its tags, best first. */
  core: string[]
  /** Patterns listings take turns with, so the shop covers many searches. */
  rotate: string[]
  /** Place-free keywords to vary from. */
  generic: string[]
  /** Never used: too niche, misleading, or someone's trademark. */
  avoid: string[]
  /** How titles are built ({city}, {landmark}, {region}, {country}, {style}); listings of one place take different ones. */
  titles: string[]
  /** Keywords by city style id: how each look is searched. */
  styles: Record<string, string[]>
  /** The reasoning, for whoever edits it. */
  notes: string
  writtenAt?: string
  editedAt?: string
}

const EMPTY_STRATEGY: KeywordStrategy = { core: [], rotate: [], generic: [], avoid: [], titles: [], styles: {}, notes: "" }

// --- Taking the place out ---

/** Common other names of a country in tags. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ["usa", "us", "america", "united states", "united states of america"],
  GB: ["uk", "england", "britain", "great britain", "united kingdom", "scotland", "wales"],
  NL: ["holland", "netherlands"],
  CZ: ["czechia", "czech republic"],
  AE: ["uae", "emirates"],
  KR: ["korea", "south korea"],
  TR: ["turkey", "turkiye"],
}

/** Adjectives of the countries city posters sell most for. */
export const DEMONYMS: Record<string, string> = {
  US: "american", GB: "british", FR: "french", IT: "italian", ES: "spanish", DE: "german", PT: "portuguese", GR: "greek",
  NL: "dutch", CH: "swiss", AT: "austrian", IE: "irish", JP: "japanese", MX: "mexican", CA: "canadian", AU: "australian",
  NZ: "new zealand", HR: "croatian", NO: "norwegian", SE: "swedish", DK: "danish", IS: "icelandic", BE: "belgian",
  CZ: "czech", HU: "hungarian", PL: "polish", MA: "moroccan", TH: "thai", BR: "brazilian", AR: "argentinian", TR: "turkish",
}

type Variant = { key: string; token: string }

/** Every name a place goes by in tags, longest first, with the token it becomes. */
function variantsOf(place: Place, reg: PlaceRegister, children: Map<string, string[]>, via: string[]): Variant[] {
  const list: Variant[] = []
  const add = (name: string | undefined, token: string) => {
    const key = name ? nameKey(name) : ""
    if (key.length >= 2 && !list.some((v) => v.key === key)) list.push({ key, token })
  }
  add(place.name, "{city}")
  for (const alias of place.aliases) add(alias, "{city}")
  for (const name of [...(children.get(place.id) ?? []), ...via]) add(name, "{landmark}")
  add(place.region, "{region}")
  if (place.parent && reg.places[place.parent]) add(reg.places[place.parent].name, "{region}")
  add(countryName(place.country), "{country}")
  for (const alias of COUNTRY_ALIASES[place.country] ?? []) add(alias, "{country}")
  add(DEMONYMS[place.country], "{demonym}")
  return list.sort((a, b) => b.key.length - a.key.length)
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The text in name-key form with the place's names as tokens; tokens never repeat a name twice. */
export function abstract(text: string, variants: Variant[]) {
  let key = ` ${nameKey(text)} `
  for (const v of variants) key = key.replace(new RegExp(` ${escape(v.key)}(?= )`, "g"), ` ${v.token}`)
  return key.trim().replace(/\s+/g, " ")
}

const hasToken = (text: string) => TOKENS.some((t) => text.includes(t))

/** What a listing weighs: its sales a month, favourites a month standing in at a twentieth of a sale. */
const weightOf = (l: RefEntry["listing"]) => l.spm + ((l.fav / Math.max(l.ageDays, 30)) * 30) / 20 + 0.01

type Tally = { weight: number; listings: number; places: Set<string>; shops: Set<number> }

function count(map: Map<string, Tally>, key: string, weight: number, place: string, shop: number) {
  const t = map.get(key) ?? { weight: 0, listings: 0, places: new Set(), shops: new Set() }
  t.weight += weight
  t.listings++
  t.places.add(place)
  t.shops.add(shop)
  map.set(key, t)
}

function stats(map: Map<string, Tally>, total: number, keep: (t: Tally, key: string) => boolean, limit: number): KeywordStat[] {
  return [...map]
    .filter(([key, t]) => keep(t, key))
    .map(([keyword, t]) => ({
      keyword,
      weight: Math.round(t.weight * 100) / 100,
      listings: t.listings,
      places: t.places.size,
      shops: t.shops.size,
      share: Math.round((t.listings / Math.max(total, 1)) * 10_000) / 10_000,
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
}

/** Splits a title into its parts: by commas, pipes and spaced dashes. */
export const titleParts = (title: string) =>
  title
    .split(/\s*[,|]\s*|\s+[-–—]\s+/)
    .map((p) => p.trim())
    .filter(Boolean)

// --- Research ---

/** Looks at every listing of the city shops in the ranking's scope; kept in citys/keywords/research. */
export async function research(): Promise<KeywordResearch> {
  const [{ index, ranking }, reg] = await Promise.all([rankingState(), register()])
  const children = new Map<string, string[]>()
  for (const p of Object.values(reg.places)) {
    if (!p.parent || p.stub) continue
    children.set(p.parent, [...(children.get(p.parent) ?? []), p.name])
  }
  const places = new Map(ranking.places.map((p) => [p.id, p]))

  const patterns = new Map<string, Tally>()
  const generic = new Map<string, Tally>()
  const openers = new Map<string, Tally>()
  const segments = new Map<string, Tally>()
  const byLabel = new Map<string, { listings: number; weight: number; keywords: Map<string, Tally> }>()
  const shops = new Set<number>()
  let listings = 0
  let totalWeight = 0

  for (const [placeId, entries] of index) {
    const ranked = places.get(placeId)
    const place = reg.places[placeId] ?? (ranked && ({ id: ranked.id, name: ranked.name, kind: ranked.kind, country: ranked.country, region: ranked.region, aliases: [] } as unknown as Place))
    if (!place) continue
    const via = [...new Set(entries.map((e) => e.via).filter((v): v is string => !!v))]
    const variants = variantsOf(place, reg, children, via)
    for (const entry of entries) {
      if (entry.kind !== "place") continue
      const l = entry.listing
      const w = weightOf(l) * entry.share
      listings++
      totalWeight += w
      shops.add(entry.shopId)
      const seen = new Set<string>()
      for (const tag of l.tags) {
        const key = abstract(tag, variants)
        if (!key || seen.has(key)) continue
        seen.add(key)
        count(hasToken(key) ? patterns : generic, key, w, placeId, entry.shopId)
        if (!hasToken(key)) {
          for (const label of entry.labels.length ? entry.labels : ["untagged"]) {
            const group = byLabel.get(label) ?? { listings: 0, weight: 0, keywords: new Map() }
            count(group.keywords, key, w, placeId, entry.shopId)
            byLabel.set(label, group)
          }
        }
      }
      for (const label of entry.labels.length ? entry.labels : ["untagged"]) {
        const group = byLabel.get(label) ?? { listings: 0, weight: 0, keywords: new Map() }
        group.listings++
        group.weight += w
        byLabel.set(label, group)
      }
      const parts = titleParts(l.title)
      if (parts[0]) count(openers, abstract(parts[0], variants), w, placeId, entry.shopId)
      for (const part of new Set(parts.slice(1).map((p) => abstract(p, variants)))) {
        if (part.split(" ").length <= 6) count(segments, part, w, placeId, entry.shopId)
      }
    }
  }

  // A pattern counts once several places and shops use it; generic keywords need breadth too, so a
  // place's own words ("manhattan skyline" where Manhattan isn't known) stay out.
  const broad = (minPlaces: number, minShops: number) => (t: Tally) => t.places.size >= minPlaces && t.shops.size >= minShops
  const labels = [...byLabel]
    .filter(([label, g]) => label !== "untagged" && g.listings >= 40)
    .map(([label, g]) => {
      // Used by two of its shops at least (when it has two): one shop's habits aren't the look's words.
      const shopsOf = new Set([...g.keywords.values()].flatMap((t) => [...t.shops]))
      const keywords = [...g.keywords]
        .filter(([, t]) => t.listings >= 8 && t.places.size >= 4 && t.shops.size >= Math.min(2, shopsOf.size))
        .map(([keyword, t]) => {
          // Against the shops without the label: how much more its own shops lean on the keyword.
          const rest = Math.max((generic.get(keyword)?.weight ?? t.weight) - t.weight, 0)
          const lift = Math.min(t.weight / g.weight / ((rest + 0.5) / Math.max(totalWeight - g.weight, 1)), 50)
          return { keyword, t, lift }
        })
        .filter((k) => k.lift >= 1.4)
        .sort((a, b) => b.t.weight * Math.log(b.lift + 1) - a.t.weight * Math.log(a.lift + 1))
        .slice(0, 24)
        .map(({ keyword, t, lift }) => ({
          keyword,
          weight: Math.round(t.weight * 100) / 100,
          listings: t.listings,
          places: t.places.size,
          shops: t.shops.size,
          share: Math.round((t.listings / g.listings) * 10_000) / 10_000,
          lift: Math.round(lift * 100) / 100,
        }))
      return { label, listings: g.listings, keywords }
    })
    .filter((g) => g.keywords.length)
    .sort((a, b) => b.listings - a.listings)

  const result: KeywordResearch = {
    madeAt: new Date().toISOString(),
    listings,
    shops: shops.size,
    places: index.size,
    patterns: stats(patterns, listings, broad(8, 3), 80),
    generic: stats(generic, listings, broad(12, 3), 160),
    openers: stats(openers, listings, (t, key) => broad(6, 2)(t) && hasToken(key), 40),
    segments: stats(segments, listings, broad(8, 2), 60),
    labels,
  }
  await writeDoc(RESEARCH, result)
  return result
}

export async function heldResearch(): Promise<KeywordResearch | null> {
  return readDoc<KeywordResearch | null>(RESEARCH, null)
}

// --- One place's own vocabulary ---

export type PlaceKeywords = {
  placeId: string
  name: string
  /** Its listings' tags as they are, strongest first. */
  tags: KeywordStat[]
  /** Its best selling listings' titles. */
  titles: { title: string; shop: string; spm: number; fav: number }[]
  listings: number
}

export async function placeKeywords(placeId: string, limit = 40): Promise<PlaceKeywords | null> {
  const [{ index, ranking }, reg] = await Promise.all([rankingState(), register()])
  const entries = (index.get(placeId) ?? []).filter((e) => e.kind === "place" || e.kind === "set")
  const name = reg.places[placeId]?.name ?? ranking.places.find((p) => p.id === placeId)?.name
  if (!name) return null
  const tags = new Map<string, Tally>()
  for (const e of entries) {
    const w = weightOf(e.listing) * e.share
    for (const tag of new Set(e.listing.tags.map((t) => t.trim().toLowerCase()))) count(tags, tag, w, placeId, e.shopId)
  }
  return {
    placeId,
    name,
    tags: stats(tags, entries.length, (t) => t.listings >= 2 || t.weight >= 0.5, limit),
    titles: entries
      .filter((e) => e.kind === "place")
      .slice(0, 8)
      .map((e) => ({ title: e.listing.title, shop: e.shop, spm: Math.round(e.listing.spm * 100) / 100, fav: e.listing.fav })),
    listings: entries.length,
  }
}

// --- The strategy ---

export async function strategy(): Promise<KeywordStrategy> {
  return { ...EMPTY_STRATEGY, ...(await readDoc<Partial<KeywordStrategy> | null>(STRATEGY, null)) }
}

const clean = (list: unknown, max: number, length = 60) =>
  (Array.isArray(list) ? list : [])
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.replace(/\s+/g, " ").trim().toLowerCase().slice(0, length))
    .filter((x, i, all) => x && all.indexOf(x) === i)
    .slice(0, max)

/** Title formulas as written (case kept: titles are in Title Case), tokens in lower case. */
const formulas = (list: unknown) =>
  (Array.isArray(list) ? list : [])
    .filter((x): x is string => typeof x === "string")
    .map((x) =>
      x
        .replace(/\s+[-–—]+\s+/g, ", ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160)
        .replace(/\{(\w+)\}/g, (m) => m.toLowerCase())
    )
    .filter((x, i, all) => x && all.indexOf(x) === i)
    .slice(0, 12)

export type StrategyPatch = Partial<Omit<KeywordStrategy, "writtenAt" | "editedAt">>

/** Changes the strategy by hand. */
export async function editStrategy(patch: StrategyPatch): Promise<KeywordStrategy> {
  let next = EMPTY_STRATEGY
  await updateDoc<KeywordStrategy | null>(STRATEGY, null, (current) => {
    const base = { ...EMPTY_STRATEGY, ...current }
    next = {
      ...base,
      ...(patch.core && { core: clean(patch.core, 13, 20) }),
      ...(patch.rotate && { rotate: clean(patch.rotate, 40, 20) }),
      ...(patch.generic && { generic: clean(patch.generic, 80, 20) }),
      ...(patch.avoid && { avoid: clean(patch.avoid, 80) }),
      ...(patch.titles && { titles: formulas(patch.titles) }),
      ...(patch.styles && {
        styles: Object.fromEntries(Object.entries(patch.styles).map(([id, list]) => [id, clean(list, 16, 20)]).filter(([, list]) => list.length)),
      }),
      ...(typeof patch.notes === "string" && { notes: patch.notes.slice(0, 4000) }),
      editedAt: new Date().toISOString(),
    }
    return next
  })
  return next
}

const STRATEGY_SCHEMA = {
  type: "OBJECT",
  properties: {
    notes: { type: "STRING" },
    core: { type: "ARRAY", items: { type: "STRING" } },
    rotate: { type: "ARRAY", items: { type: "STRING" } },
    generic: { type: "ARRAY", items: { type: "STRING" } },
    avoid: { type: "ARRAY", items: { type: "STRING" } },
    titles: { type: "ARRAY", items: { type: "STRING" } },
    styles: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { id: { type: "STRING" }, keywords: { type: "ARRAY", items: { type: "STRING" } } }, required: ["id", "keywords"] },
    },
  },
  required: ["notes", "core", "rotate", "generic", "avoid", "titles", "styles"],
  propertyOrdering: ["notes", "core", "rotate", "generic", "avoid", "titles", "styles"],
}

/** Words that say how a poster looks: they fit one style's listings, not every listing. */
const LOOK_TERMS =
  /\b(watercolou?r|photo(graph(y|ic)?)?|black (and|&) white|b ?& ?w|bw|vintage|retro|minimal(ist)?|sketch(ed)?|line art|oil painting|painting|painted|illustrat(ed|ion|ions)|cartoon|pastel|mid ?century|wpa|flat design|vector|pop art|art deco|monochrome|noir)\b/i

const line = (s: KeywordStat) => `${s.keyword} · ${s.weight.toFixed(1)} sales/mo · ${s.listings} listings · ${s.places} places · ${s.shops} shops`

/** Gemini writes the strategy from the research; what was set by hand is replaced (the notes say why). */
export async function writeStrategy(styles: { id: string; name: string; guide: string }[]): Promise<KeywordStrategy> {
  const found = (await heldResearch()) ?? (await research())
  const prompt = [
    "You plan the Etsy keywords of a shop selling city and travel posters (real places: cities, beaches, national parks, regions) in several styles. The shop wants to rank broadly: for many places, and for each place in many searches, with strong variation between its listings, not one formula copied a thousand times.",
    "Below is research over the city poster shops on Etsy: their tags and titles with the place taken out ({city} the place, {landmark} a district or landmark of it, {region} its state or region, {country}, {demonym} the country's adjective), each weighed by the sales a month of the listings using it.",
    "",
    "Tag patterns:",
    ...found.patterns.slice(0, 60).map(line),
    "",
    "Place-free tags used across many places:",
    ...found.generic.slice(0, 120).map(line),
    "",
    "How titles start:",
    ...found.openers.slice(0, 30).map(line),
    "",
    "Later title parts:",
    ...found.segments.slice(0, 40).map(line),
    "",
    "Keywords of shops by look (label: keyword ×lift):",
    ...found.labels.map((g) => `${g.label}: ${g.keywords.slice(0, 14).map((k) => `${k.keyword} ×${k.lift}`).join(", ")}`),
    "",
    styles.length ? "The shop's city styles (id: name: how they look):" : "",
    ...styles.map((s) => `${s.id}: ${s.name}: ${s.guide.slice(0, 300)}`),
    "",
    "Write the strategy:",
    '- "core": 4–6 tag patterns every listing carries, the broad ones buyers search most ("{city} poster", "{city} print"…). Each at most 20 characters once the place is filled in for a typical name, so keep them short.',
    '- "rotate": 15–30 patterns listings take turns with, so listings of one place cover different searches ({landmark}, {region}, {country}, gift and room phrasing).',
    '- "generic": 30–60 place-free tags to vary from: broad and proven (wall art, travel gift, housewarming…), each at most 20 characters. No look words here (watercolor, photo, black and white, vintage, retro, minimalist…): those belong to the styles.',
    '- "avoid": keywords that are wrong for every listing of this shop: too niche (few listings, one shop), misleading for a print ("original painting", "framed" when it ships unframed, "digital download" for a physical print), or someone\'s trademark. Look words are not to avoid: a style that is watercolor uses them (put them under "styles").',
    '- "titles": 6–10 title formulas in Title Case using {city}, {landmark}, {region}, {country}, {style} ("{city} Travel Poster, {landmark} Print, {country} Wall Art"), parts apart by commas, never a dash: the main search first, then 2–3 more searches, under 140 characters filled in, readable, no keyword stuffing, no repeated words. Different formulas for different listings of one place.',
    '- "styles": for each style id above, 6–12 keywords buyers use for that look (from the research where it shows; plain words, at most 20 characters each).',
    '- "notes": the reasoning in 4–8 short sentences: what ranks, what to vary, what to leave alone.',
    "Prefer what many shops and places prove over clever niche phrases. Tags lower case. Only the tokens named, in braces.",
  ]
    .filter((l) => l !== undefined)
    .join("\n")
  const answer = await askJson<{
    notes?: string
    core?: string[]
    rotate?: string[]
    generic?: string[]
    avoid?: string[]
    titles?: string[]
    styles?: { id: string; keywords: string[] }[]
  }>(prompt, [], { schema: STRATEGY_SCHEMA, temperature: 0.4 })
  const known = new Set(styles.map((s) => s.id))
  // Look words belong to the styles: kept out of what every listing uses, and out of the avoid list.
  const unlooked = (list: string[]) => list.filter((k) => !LOOK_TERMS.test(k))
  const next: KeywordStrategy = {
    core: unlooked(clean(answer.core, 8, 30)),
    rotate: unlooked(clean(answer.rotate, 40, 40)),
    generic: unlooked(clean(answer.generic, 80, 20)),
    avoid: unlooked(clean(answer.avoid, 80)),
    titles: formulas(answer.titles).map((t) =>
      t
        .replace(/\{(\w+)\}/g, (m) => m.toLowerCase())
        .replace(new RegExp(LOOK_TERMS.source, "gi"), "{style}")
        .replace(/(\{style\}\s*)+/g, "{style} ")
        .replace(/\s+/g, " ")
        .trim()
    ),
    styles: Object.fromEntries((answer.styles ?? []).filter((s) => known.has(s.id)).map((s) => [s.id, clean(s.keywords, 16, 20)])),
    notes: (answer.notes ?? "").trim().slice(0, 4000),
    writtenAt: new Date().toISOString(),
  }
  await writeDoc(STRATEGY, next)
  return next
}

// --- Filling in for one listing ---

export type PlaceNames = { city: string; landmark?: string; region?: string; country?: string; style?: string }

/** A pattern or formula with the place filled in; null when it needs a name the listing hasn't got. */
export function fill(pattern: string, names: PlaceNames): string | null {
  let missing = false
  const out = pattern.replace(/\{(city|landmark|region|country|demonym|style)\}/g, (_, token: string) => {
    const value =
      token === "city"
        ? names.city
        : token === "landmark"
          ? names.landmark
          : token === "region"
            ? names.region
            : token === "country"
              ? names.country
              : token === "demonym"
                ? names.country && DEMONYMS[Object.entries(DEMONYMS).find(([code]) => countryName(code) === names.country)?.[0] ?? ""]
                : names.style
    if (!value) missing = true
    return value ?? ""
  })
  return missing ? null : out.replace(/\s+/g, " ").trim()
}

/** Etsy tags as our shops write them: at most 20 characters, letters, digits, spaces and apostrophes. */
export const tagOk = (tag: string) => tag.length >= 2 && tag.length <= 20 && /^[\p{L}\p{N} ']+$/u.test(tag)
