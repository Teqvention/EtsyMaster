import { countryName, continentOf, placeId } from "./geo"
import { digests, taggedShops, type CityShop } from "./digest"
import { photoUrl } from "./photos"
import { cityPark, register, resolve, rootOf, settingOf } from "./places"
import { shopRead } from "./read"
import { citySettings } from "./settings"
import {
  SUB_KINDS,
  type Breakdown,
  type DigestListing,
  type ListingRead,
  type Place,
  type PlaceRegister,
  type RankedChild,
  type RankedPlace,
  type Ranking,
  type RankingScope,
  type RankingShop,
  type ShopDigest,
  type ShopRead,
  type Tier,
} from "./types"

// The ranking: every place the city shops sell, by how much real demand it
// has. Each listing's demand is worked out on its own shop's rates (sales a
// month over the last year, from favorites, views and reviews; digest.ts);
// a place sums its listings' (a set's split over its places, a district's
// or landmark's counted with its city and listed under it).
//
// What makes a place rank high, in order of weight:
// - sales a month across shops: the money;
// - favorites a month since its listings went up: attention, which leads
//   sales and shows on young listings before reviews can;
// - reviews in the last year: buyers, the hardest proof;
// - shops where it's in their top quarter: demand in many shops, not one
//   shop's hit, and fair to small shops (a big catalogue lists everything);
// - sales per listing against the average listing, evened out for few
//   listings: a place that sells from few listings has room, one spread
//   over many is crowded;
// - listings rising lately or new and drawing attention fast.
// Each is put on a log scale against what the strongest places reach (so
// New York and a town of three listings stay far apart, where ranks would
// squeeze the top together), weighed, and the blend scaled to 0–100. Tiers
// cut the places in score order by share: A the best 5 %, then B 10 %, C 15 %,
// D 25 %, E the rest of the places with demand; F those whose listings have
// been up for months without a sign of it.

/** Sales per listing are evened out towards the average as if this many average listings came along. */
const LIFT_PRIOR = 3
/** Days a listing needs to have been up for silence to count as no demand. */
const PROVEN_DAYS = 120
/** Cumulative shares of the places with demand where each tier ends. */
const TIER_CUTS: [Tier, number][] = [
  ["A", 0.05],
  ["B", 0.15],
  ["C", 0.3],
  ["D", 0.55],
  ["E", 1],
]
const WEIGHTS = { sales: 0.32, favorites: 0.26, reviews: 0.14, breadth: 0.14, lift: 0.09, rising: 0.05 }

const TOP_LISTINGS = 4
const MAX_CHILDREN = 40

type Inputs = { scope: RankingScope; shops: CityShop[]; digests: Map<number, ShopDigest>; reads: Map<number, ShopRead>; reg: PlaceRegister }

/** A listing behind a place, for the City Stealer and the keyword research. */
export type RefEntry = {
  listing: DigestListing
  shopId: number
  shop: string
  labels: string[]
  kind: ListingRead["k"]
  look: ListingRead["s"]
  /** The district or landmark of the place it shows, when it shows one. */
  via?: string
  /** The part of the listing that is this place's: 1, or a share of a set. */
  share: number
}

type State = { ranking: Ranking; index: Map<string, RefEntry[]> }

// The last ranking, and what it was made from: the same documents (held in
// memory, so the same objects until one changes) give the same ranking.

const global = globalThis as typeof globalThis & { __cityRanking?: { key: unknown[]; state: State } }

export async function ranking(override?: Partial<RankingScope>): Promise<Ranking> {
  return (await rankingState(override)).ranking
}

/** The ranking with every place's listings, best first. */
export async function rankingState(override?: Partial<RankingScope>): Promise<State> {
  const settings = await citySettings()
  const scope = { ...settings.scope, ...override }
  const shops = await taggedShops(scope.primary)
  const ids = shops.map((s) => s.shop.id)
  const [made, reads, reg] = await Promise.all([
    digests(ids),
    Promise.all(ids.map(shopRead)).then((list) => new Map(list.map((r, i) => [ids[i], r]))),
    register(),
  ])
  const key = [JSON.stringify(scope), reg, ...ids.map((id) => made.get(id)), ...ids.map((id) => reads.get(id))]
  const held = global.__cityRanking
  if (held && held.key.length === key.length && held.key.every((k, i) => k === key[i])) return held.state
  const state = compute({ scope, shops, digests: made, reads, reg })
  global.__cityRanking = { key, state }
  return state
}

type Tally = {
  place: Place
  listings: number
  spm: number
  rev: number
  favMonth: number
  reviewsYear: number
  shops: Set<number>
  topShops: Set<number>
  rising: number
  exposureDays: number
  top: RefEntry[]
  looks: Map<string, number>
  children: Map<string, Tally>
}

function tally(place: Place): Tally {
  return {
    place,
    listings: 0,
    spm: 0,
    rev: 0,
    favMonth: 0,
    reviewsYear: 0,
    shops: new Set(),
    topShops: new Set(),
    rising: 0,
    exposureDays: 0,
    top: [],
    looks: new Map(),
    children: new Map(),
  }
}

/** A place for a raw name the register doesn't know yet: the ranking works before every name is matched. */
function provisional(reg: PlaceRegister, raw: ListingRead["p"][number]): Place {
  const known = resolve(reg, raw)
  if (known) return known
  return {
    id: placeId(raw.name, raw.country),
    name: raw.name,
    kind: raw.kind,
    country: raw.country,
    continent: continentOf(raw.country),
    setting: settingOf(raw.kind),
    tags: [],
    aliases: [],
    ...(folds(raw) && { parent: placeId(raw.within, raw.country) }),
  }
}

/** A raw name that folds into the place it was read "in": a district, landmark, beach or a city's park. */
const folds = (raw: ListingRead["p"][number]) => !!raw.within && (SUB_KINDS.includes(raw.kind) || cityPark(raw.kind, raw.name))

function rootFor(reg: PlaceRegister, place: Place, raw: ListingRead["p"][number]): Place {
  if (reg.places[place.id]) return rootOf(reg, place)
  // Not in the register yet: a district's or landmark's city by the name it was read with.
  if (folds(raw)) {
    const parent = provisional(reg, { name: raw.within, kind: "city", country: raw.country, within: "" })
    return reg.places[parent.id] ? rootOf(reg, parent) : parent
  }
  return place
}

function compute({ scope, shops, digests: made, reads, reg }: Inputs): State {
  const inScope = (s: CityShop) =>
    !scope.excluded.includes(s.shop.id) &&
    (!scope.secondary.length || s.secondary.some((t) => scope.secondary.some((w) => w.toLowerCase() === t.toLowerCase())))

  const places = new Map<string, Tally>()
  const totals = { listings: 0, placeListings: 0, custom: 0, sets: 0, themes: 0, spm: 0, customSpm: 0, setSpm: 0, themeSpm: 0 }
  const coverage = { read: 0, total: 0 }
  const shopRows: RankingShop[] = []

  for (const cityShop of shops) {
    const digest = made.get(cityShop.shop.id)
    const read = reads.get(cityShop.shop.id)
    const included = inScope(cityShop)
    const row: RankingShop = {
      shopId: cityShop.shop.id,
      name: cityShop.shop.name,
      secondary: cityShop.secondary,
      included,
      listings: digest?.listings.length ?? 0,
      read: 0,
      customShare: 0,
      setShare: 0,
      themeShare: 0,
      spm: 0,
      analysedAt: digest?.analysedAt ?? null,
    }
    let custom = 0
    let sets = 0
    let themes = 0
    for (const listing of digest?.listings ?? []) {
      const r = read?.listings[listing.id]
      if (r) row.read++
      row.spm += listing.spm
      if (r?.k === "custom") custom += listing.spm
      if (r?.k === "set") sets += listing.spm
      if (r?.k === "theme") themes += listing.spm
      if (!included) continue
      coverage.total++
      totals.listings++
      totals.spm += listing.spm
      if (!r) continue
      coverage.read++
      if (r.k === "custom") {
        totals.custom++
        totals.customSpm += listing.spm
      } else if (r.k === "theme") {
        totals.themes++
        totals.themeSpm += listing.spm
      } else if (r.k === "set") {
        totals.sets++
        totals.setSpm += listing.spm
      }
      if (!r.p.length) continue
      totals.placeListings++
      credit(places, reg, cityShop, listing, r)
    }
    row.customShare = row.spm ? custom / row.spm : 0
    row.setShare = row.spm ? sets / row.spm : 0
    row.themeShare = row.spm ? themes / row.spm : 0
    shopRows.push(row)
  }

  const tallies = [...places.values()]
  const ranked = score(tallies)
  const index = new Map(tallies.map((t) => [t.place.id, t.top.toSorted((a, b) => b.listing.spm * b.share - a.listing.spm * a.share)]))
  return {
    ranking: {
      scope,
      shops: shopRows.sort((a, b) => b.spm - a.spm),
      places: ranked,
      totals,
      breakdowns: breakdowns(ranked),
      coverage,
      madeAt: new Date().toISOString(),
    },
    index,
  }
}

/** Adds one listing's demand to the places it shows. */
function credit(places: Map<string, Tally>, reg: PlaceRegister, shop: CityShop, listing: DigestListing, read: ListingRead) {
  const resolved = read.p.map((raw) => {
    const place = provisional(reg, raw)
    return { raw, place, root: rootFor(reg, place, raw) }
  })
  // One place: the main one counts (a "Positano, Amalfi Coast" print sells
  // Positano). A set: each of its places a share.
  const roots = read.k === "set" ? [...new Map(resolved.map((r) => [r.root.id, r.root])).values()] : [resolved[0].root]
  const share = 1 / roots.length
  const favMonth = (listing.fav / Math.max(listing.ageDays, 30)) * 30
  const rising = listing.flags.includes("rising") || listing.flags.includes("new")
  const top = listing.tier !== "rest"
  const looks = shop.secondary.length ? shop.secondary : ["untagged"]

  const add = (t: Tally) => {
    t.listings += share
    t.spm += listing.spm * share
    t.rev += listing.rev * share
    t.favMonth += favMonth * share
    t.reviewsYear += listing.reviews[1] * share
    t.shops.add(shop.shop.id)
    if (top) t.topShops.add(shop.shop.id)
    if (rising) t.rising += share
    t.exposureDays = Math.max(t.exposureDays, listing.ageDays)
  }

  for (const root of roots) {
    const t = places.get(root.id) ?? tally(root)
    places.set(root.id, t)
    add(t)
    for (const look of looks) t.looks.set(look, (t.looks.get(look) ?? 0) + (listing.spm * share) / looks.length)
    const via = resolved.find((r) => r.root.id === root.id && r.place.id !== root.id)?.place.name
    t.top.push({ listing, shopId: shop.shop.id, shop: shop.shop.name, labels: shop.secondary, kind: read.k, look: read.s, ...(via && { via }), share })
    // Its districts and landmarks this listing shows, under it.
    for (const r of resolved) {
      if (r.root.id !== root.id || r.place.id === root.id) continue
      const child = t.children.get(r.place.id) ?? tally(r.place)
      t.children.set(r.place.id, child)
      add(child)
    }
  }
}

function score(tallies: Tally[]): RankedPlace[] {
  const listingTotal = tallies.reduce((n, t) => n + t.listings, 0)
  const salesTotal = tallies.reduce((n, t) => n + t.spm, 0)
  const average = listingTotal ? salesTotal / listingTotal : 0

  const rows = tallies.map((t) => {
    const lift = average > 0 ? (t.spm + LIFT_PRIOR * average) / ((t.listings + LIFT_PRIOR) * average) : 1
    const evidence = t.spm >= 0.01 || t.favMonth >= 0.1 || t.reviewsYear > 0
    return { t, lift, evidence }
  })
  const withDemand = rows.filter((r) => r.evidence)

  // Each signal on a log scale, 1 for the strongest place.
  const scaled = (values: number[]) => {
    const logs = values.map((v) => Math.log1p(Math.max(v, 0)))
    const top = Math.max(...logs, 0) || 1
    return logs.map((v) => v / top)
  }
  const sales = scaled(withDemand.map((r) => r.t.spm * 10))
  const favorites = scaled(withDemand.map((r) => r.t.favMonth))
  const reviews = scaled(withDemand.map((r) => r.t.reviewsYear * 2))
  const breadth = scaled(withDemand.map((r) => r.t.topShops.size * 2 + r.t.shops.size / 4))
  // Sales per listing from a third of the average to three times it, 0 to 1.
  const lift = withDemand.map((r) => Math.min(Math.max((Math.log(r.lift) + Math.log(3)) / (2 * Math.log(3)), 0), 1))
  const rising = scaled(withDemand.map((r) => r.t.rising))
  const blend = withDemand.map(
    (_, i) =>
      WEIGHTS.sales * sales[i] +
      WEIGHTS.favorites * favorites[i] +
      WEIGHTS.reviews * reviews[i] +
      WEIGHTS.breadth * breadth[i] +
      WEIGHTS.lift * lift[i] +
      WEIGHTS.rising * rising[i]
  )
  const best = Math.max(...blend, 0) || 1

  const scored = withDemand.map((r, i) => ({ ...r, score: Math.max(1, Math.round((blend[i] / best) * 100)), blend: blend[i] }))
  scored.sort((a, b) => b.blend - a.blend || b.t.spm - a.t.spm)
  const tiered = scored.map((r, i) => {
    const at = (i + 1) / scored.length
    return { ...r, tier: TIER_CUTS.find(([, cut]) => at <= cut)?.[0] ?? "E" }
  })
  const silent = rows
    .filter((r) => !r.evidence)
    .map((r) => ({ ...r, score: 0, blend: 0, tier: (r.t.exposureDays >= PROVEN_DAYS ? "F" : "E") as Tier }))
    .sort((a, b) => b.t.listings - a.t.listings)

  return [...tiered, ...silent].map((r, i) => toRanked(r.t, r.lift, r.score, r.tier as Tier, i + 1))
}

function toRanked(t: Tally, lift: number, score: number, tier: Tier, position: number): RankedPlace {
  const place = t.place
  const best = new Map<number, Tally["top"][number]>()
  for (const entry of t.top.sort((a, b) => b.listing.spm * b.share - a.listing.spm * a.share)) {
    if (!best.has(entry.listing.id)) best.set(entry.listing.id, entry)
    if (best.size >= TOP_LISTINGS) break
  }
  const children: RankedChild[] = [...t.children.values()]
    .sort((a, b) => b.spm - a.spm || b.listings - a.listings)
    .slice(0, MAX_CHILDREN)
    .map((c) => ({
      id: c.place.id,
      name: c.place.name,
      kind: c.place.kind,
      listings: round(c.listings),
      spm: round(c.spm, 3),
      favMonth: round(c.favMonth),
      shops: c.shops.size,
    }))
  return {
    id: place.id,
    name: place.name,
    kind: place.kind,
    country: place.country,
    countryName: countryName(place.country),
    ...(place.region && { region: place.region }),
    continent: place.continent,
    ...(place.size && { size: place.size }),
    setting: place.setting,
    tags: place.tags,
    score,
    tier,
    position,
    listings: round(t.listings),
    shops: t.shops.size,
    topShops: t.topShops.size,
    spm: round(t.spm, 3),
    rev: Math.round(t.rev),
    favMonth: round(t.favMonth),
    reviewsYear: round(t.reviewsYear),
    lift: round(lift),
    rising: round(t.rising),
    exposureDays: t.exposureDays,
    children,
    top: [...best.values()].map(({ listing, shopId, shop }) => ({
      listingId: listing.id,
      shopId,
      shop,
      title: listing.title,
      image: listing.images[0] ? photoUrl(listing.images[0], "340x270") : "",
      spm: round(listing.spm, 3),
      fav: listing.fav,
    })),
    looks: Object.fromEntries([...t.looks].map(([k, v]) => [k, round(v, 3)])),
  }
}

// --- Breakdowns ---

const SIZE_LABEL: Record<string, string> = { big: "Big cities", mid: "Mid-size cities", small: "Small towns", none: "Not a city" }
const SETTING_LABEL: Record<string, string> = {
  city: "City",
  nature: "Nature",
  beach: "Beach",
  mountains: "Mountains",
  lake: "Lake",
  island: "Island",
  region: "Region",
}

function group(places: RankedPlace[], keyOf: (p: RankedPlace) => string, labelOf: (key: string) => string): Breakdown[] {
  const map = new Map<string, Breakdown>()
  for (const p of places) {
    const key = keyOf(p)
    const b = map.get(key) ?? { key, label: labelOf(key), places: 0, spm: 0, listings: 0 }
    b.places++
    b.spm += p.spm
    b.listings += p.listings
    map.set(key, b)
  }
  return [...map.values()].map((b) => ({ ...b, spm: round(b.spm, 2), listings: round(b.listings) })).sort((a, b) => b.spm - a.spm)
}

function breakdowns(places: RankedPlace[]): Ranking["breakdowns"] {
  const cityKind = (p: RankedPlace) => (p.kind === "city" || p.kind === "town" ? (p.size ?? (p.kind === "town" ? "small" : "mid")) : "none")
  const lookMap = new Map<string, Breakdown>()
  for (const p of places) {
    for (const [look, spm] of Object.entries(p.looks)) {
      const b = lookMap.get(look) ?? { key: look, label: look.charAt(0).toUpperCase() + look.slice(1), places: 0, spm: 0, listings: 0 }
      b.places++
      b.spm += spm
      lookMap.set(look, b)
    }
  }
  const countries = group(places, (p) => p.country || "?", (k) => countryName(k) || "Unknown")
  return {
    size: group(places, cityKind, (k) => SIZE_LABEL[k] ?? k),
    setting: group(places, (p) => p.setting, (k) => SETTING_LABEL[k] ?? k),
    continent: group(places, (p) => p.continent ?? "Unknown", (k) => k),
    country: countries.slice(0, 15),
    look: [...lookMap.values()].map((b) => ({ ...b, spm: round(b.spm, 2) })).sort((a, b) => b.spm - a.spm),
    tier: group(places, (p) => p.tier, (k) => `Tier ${k}`).sort((a, b) => a.key.localeCompare(b.key)),
  }
}

function round(n: number, digits = 2) {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

