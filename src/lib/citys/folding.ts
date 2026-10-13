import { nameKey } from "./geo"
import { SETTLEMENT_KINDS, SUB_KINDS, type Place, type PlaceRegister, type RawPlace } from "./types"

// How the register's places hang together, for the ranking and our own
// listings: which name a listing's place is (resolve), what it folds into
// (a district, landmark or beach of a city into the city; one out in a
// region or park stays a place of its own), and whether a listing is sold
// by a sub-place's own name. Pure rules over the register (places.ts keeps
// it and folds new names in).

/** A raw name's key in `known`: name, country and kind as read. */
export const rawKey = (p: RawPlace) => `${nameKey(p.name)}|${p.country || "*"}|${p.kind}`

export const aliasKey = (name: string, country: string) => `${nameKey(name)}|${country || "*"}`

/** The place a raw name stands for, if the register knows it. */
export function resolve(reg: PlaceRegister, p: RawPlace): Place | null {
  const id = reg.known[rawKey(p)] ?? reg.aliases[aliasKey(p.name, p.country)]
  return (id && reg.places[id]) || null
}

/** A park named for a city's own green (Central Park, Hyde Park), not a national or state park out in nature. */
export const cityPark = (kind: string, name: string) => kind === "park" && !/\b(national|state|provincial)\b/i.test(name)

/**
 * Whether a place folds into its parent in the ranking: a district,
 * landmark, beach or a city's own park, in a city, town or district. One
 * in a region, park, on an island or coast stands on its own (13 Oct:
 * County Clare ranked A for the Cliffs of Moher in it, Wiltshire for
 * Stonehenge, Fiordland National Park for Milford Sound).
 */
export function foldsInto(place: Place, parent: Place | undefined) {
  if (!parent || !SETTLEMENT_KINDS.includes(parent.kind)) return false
  return SUB_KINDS.includes(place.kind) || cityPark(place.kind, place.name)
}

/** Follows a place up to the place it folds into in the ranking (itself unless it's a district, landmark, beach or a city's park in a settlement). */
export function rootOf(reg: PlaceRegister, place: Place): Place {
  let current = place
  for (let hops = 0; hops < 4 && current.parent; hops++) {
    const parent = reg.places[current.parent]
    if (!parent || parent.id === current.id || !foldsInto(current, parent)) break
    current = parent
  }
  return current
}

/**
 * Whether a listing is sold by a sub-place's own name: its title names the
 * sub-place early (within its first 40 letters), before the city it's in
 * ("Waikiki Watercolor Print, Diamond Head, Honolulu"), not after it
 * ("Barcelona Print, Sagrada Familia").
 */
export function leadsWith(title: string, sub: Place, root: Place) {
  const text = ` ${nameKey(title).slice(0, 80)} `
  const at = (place: Place) => {
    // Its name, its other names, and a beach's name without "beach" (Waikiki).
    const keys = [nameKey(place.name), ...place.aliases, ...(place.kind === "beach" ? [nameKey(place.name).replace(/ beach$/, "")] : [])].filter((k) => k.length >= 3)
    const found = keys.map((k) => text.indexOf(` ${k} `)).filter((i) => i >= 0)
    return found.length ? Math.min(...found) : -1
  }
  const own = at(sub)
  if (own < 0 || own > 40) return false
  const city = at(root)
  return city < 0 || own < city
}
