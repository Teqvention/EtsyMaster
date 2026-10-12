import type { Continent } from "./geo"

// City knowledge: which places the city shops sell, how well, and how much
// of that we have ourselves. Every listing of a shop under the primary tag
// "citys" is read once by Gemini for the places it shows; the names are
// folded into one register of places (New York and NYC are one, Brooklyn
// sits under it), and the ranking sums the listings' demand per place.
//
// Stored as documents under citys/:
//   citys/places              the register (Place by id, aliases)
//   citys/digest/<shopId>     a shop's listings, reduced and calibrated
//   citys/read/<shopId>       what Gemini read off each listing's title
//   citys/settings            the ranking's scope and the shop's city setup
//   citys/job                 the reading run going on, if any

// --- Places ---

export const PLACE_KINDS = [
  "city",
  "town",
  "district",
  "landmark",
  "beach",
  "island",
  "park",
  "mountain",
  "lake",
  "coast",
  "region",
  "state",
  "country",
] as const
export type PlaceKind = (typeof PLACE_KINDS)[number]

/** Kinds that sit inside a city (or a region, park…) and fold into it in the ranking. */
export const SUB_KINDS: PlaceKind[] = ["district", "landmark", "beach"]

export const SIZES = ["big", "mid", "small"] as const
/** Cities over a million, between a hundred thousand and a million, and under. */
export type CitySize = (typeof SIZES)[number]

/**
 * What a place is like, for search and the charts: "beach", "nature",
 * "mountains", "lake", "island", "skyline", "historic", "old town",
 * "canals", "desert", "snow", "tropical", "coastal", "capital"… open-ended,
 * lower case.
 */
export type PlaceTag = string

/** One of the setting groups the charts split places into. */
export const SETTINGS = ["city", "nature", "beach", "mountains", "lake", "island", "region"] as const
export type Setting = (typeof SETTINGS)[number]

export type Place = {
  id: string
  name: string
  kind: PlaceKind
  /** The city (or region, park…) a district, landmark or beach belongs to. */
  parent?: string
  /** ISO alpha-2. */
  country: string
  /** State, province or region, e.g. "California", "Tuscany". */
  region?: string
  continent: Continent | null
  /** Cities and towns only. */
  size?: CitySize
  setting: Setting
  tags: PlaceTag[]
  lat?: number
  lng?: number
  /** Other names listings use for it ("NYC", "New York"), as name keys. */
  aliases: string[]
  /** Changed by hand: a new read never overwrites it. */
  edited?: boolean
  /** Only known as another place's parent, by name: filled in once a listing names it. */
  stub?: boolean
}

export type PlaceRegister = {
  places: Record<string, Place>
  /** Name key + "|" + country (or "|*" when unknown) → place id. */
  aliases: Record<string, string>
  /** Raw names (as read) already folded into the register: name key|country|kind. */
  known: Record<string, string>
  updatedAt: string
}

// --- Listings ---

/** What a listing shows, as Gemini read its title. */
export const LISTING_KINDS = ["place", "set", "custom", "theme"] as const
/**
 * place: one real place · set: several real places sold together · custom:
 * the buyer picks the place · theme: no real place (fiction, animals, art).
 */
export type ListingKind = (typeof LISTING_KINDS)[number]

export const LOOKS = ["photo", "bw", "illustration", "watercolor", "sketch", "painting", "map", "typography", "unknown"] as const
/** How the poster is made, when the title says so. */
export type Look = (typeof LOOKS)[number]

/** A place as read off a title, before it's matched to the register. */
export type RawPlace = { name: string; kind: PlaceKind; country: string; within: string }

/** What was read off one listing: kind, look, and its places (raw, matched to the register later). */
export type ListingRead = {
  /** Hash of the title it was read from: a new title is read again. */
  h: string
  k: ListingKind
  s: Look
  p: RawPlace[]
}

export type ShopRead = {
  shopId: number
  listings: Record<string, ListingRead>
  updatedAt: string
}

/** A listing as the city pages need it: small, with its demand worked out on its shop's own rates. */
export type DigestListing = {
  id: number
  title: string
  tags: string[]
  /** Favorites and views, running totals. */
  fav: number
  views: number
  /** ISO 8601, first published. */
  created: string
  ageDays: number
  priceCents: number
  /** Up to four listing photos, short (see `photoUrl`). */
  images: string[]
  /** Calibrated: lifetime sales, sales a month over the last year, revenue a month (cents). */
  sales: number
  spm: number
  rev: number
  /** Reviews: all, last year, last 90 days. */
  reviews: [number, number, number]
  /** Position in its shop by sales a month (1 is best) and the tier it puts it in. */
  rank: number
  tier: "top1" | "top10" | "top25" | "rest"
  trend: number | null
  flags: ("rising" | "new" | "sleeping")[]
  personalizable: boolean
  digital: boolean
}

export type ShopDigest = {
  shopId: number
  name: string
  /** The analysis it was made from: a newer one makes it again. */
  analysedAt: string
  listings: DigestListing[]
  madeAt: string
}

// --- Ranking ---

export const TIERS = ["A", "B", "C", "D", "E", "F"] as const
/** A to E are worth making, best first; F has shown there's no demand. */
export type Tier = (typeof TIERS)[number]

/** The scope of the ranking: which shops count. */
export type RankingScope = {
  /** Primary tag of the shops that count. */
  primary: string
  /** Only shops carrying any of these secondary tags; all under the primary when empty. */
  secondary: string[]
  /** Shops left out by hand. */
  excluded: number[]
}

export type PlaceStats = {
  /** Listings for it, sets counting a share. */
  listings: number
  shops: number
  /** Shops where one of its listings is in the shop's top quarter. */
  topShops: number
  /** Sales a month, revenue a month (cents), favorites a month, reviews in the last year: summed over its listings. */
  spm: number
  rev: number
  favMonth: number
  reviewsYear: number
  /** Sales a month per listing, against the average listing (1 = average), evened out for few listings. */
  lift: number
  /** Listings under 90 days drawing attention fast, or selling faster lately. */
  rising: number
  /** The oldest listing's age, days: how long it has had to show demand. */
  exposureDays: number
}

export type RankedPlace = PlaceStats & {
  id: string
  name: string
  kind: PlaceKind
  country: string
  countryName: string
  region?: string
  continent: Continent | null
  size?: CitySize
  setting: Setting
  tags: PlaceTag[]
  /** 0–100, against every place with demand in the scope. */
  score: number
  tier: Tier
  /** Place in the list, 1 is best. */
  position: number
  /** Districts, landmarks and beaches folded into it (their numbers are in its own). */
  children: RankedChild[]
  /** Its best listings, for a glance. */
  top: { listingId: number; shopId: number; shop: string; title: string; image: string; spm: number; fav: number }[]
  /** How its sales split by the shops' secondary tags. */
  looks: Record<string, number>
}

export type RankedChild = Pick<RankedPlace, "id" | "name" | "kind" | "listings" | "spm" | "favMonth" | "shops">

export type RankingShop = {
  shopId: number
  name: string
  secondary: string[]
  included: boolean
  listings: number
  /** Listings read so far. */
  read: number
  /** Share of its sales from custom listings, from sets, and from listings showing no real place. */
  customShare: number
  setShare: number
  themeShare: number
  spm: number
  analysedAt: string | null
}

export type Breakdown = { key: string; label: string; places: number; spm: number; listings: number }

export type Ranking = {
  scope: RankingScope
  shops: RankingShop[]
  places: RankedPlace[]
  /** Totals over the listings in scope. */
  totals: { listings: number; placeListings: number; custom: number; sets: number; themes: number; spm: number; customSpm: number; setSpm: number; themeSpm: number }
  breakdowns: {
    size: Breakdown[]
    setting: Breakdown[]
    continent: Breakdown[]
    country: Breakdown[]
    look: Breakdown[]
    tier: Breakdown[]
  }
  /** How far the reading has got: listings read of those in scope. */
  coverage: { read: number; total: number }
  madeAt: string
  /** Our city shops' listings by place (the API adds them): confirmed, to replace, live but not judged yet. */
  ours?: Record<string, OursCell>
}

/** What we have of a place: a place with neither confirmed nor unjudged live listings is open. */
export type OursCell = { confirmed: number; replace: number; open: number }
