import { listAccounts } from "@/lib/accounts/store"
import { readDoc } from "@/lib/db/documents"
import { listings as syncedListings } from "@/lib/sync/store"

import { leadsWith, resolve, rootOf } from "./folding"
import { register } from "./places"
import { shopRead } from "./read"
import { citySettings } from "./settings"
import type { PlaceRegister } from "./types"

// Our own city shops, read the way the competitors are: which places our
// listings show, and what we decided about each listing (Artikel's city
// status: confirmed, to replace, offline). A place we have a confirmed
// listing of is covered; one whose listings are all to be replaced is open
// again; the Stealer and the ranking show both.

export const STATUS = "citys/status"

export type CityStatus = "confirmed" | "replace" | "offline"
export type CityOrigin = "robin" | "old" | "system"

export type StatusEntry = {
  status: CityStatus
  origin: CityOrigin
  /** Why it got its status, in a few words. */
  reason?: string
  /** Set by hand: a new classification leaves it. */
  manual?: boolean
  at: string
}

export type StatusFile = { listings: Record<string, StatusEntry>; classifiedAt?: string }

export async function statusFile(): Promise<StatusFile> {
  return readDoc<StatusFile>(STATUS, { listings: {} })
}

export type OurListing = {
  listingId: number
  account: string
  shop: string
  title: string
  state: string
  image: string | null
  views: number
  favorites: number
  createdAt: number
  status: CityStatus | null
  origin: CityOrigin | null
}

export type Coverage = { confirmed: number; replace: number; offline: number; open: number; listings: OurListing[] }

/** Our city shops' listings by the place (root) they show. */
export async function ourCoverage(): Promise<Map<string, Coverage>> {
  const settings = await citySettings()
  const [accounts, reg, status] = await Promise.all([listAccounts(), register(), statusFile()])
  const byPlace = new Map<string, Coverage>()
  for (const account of accounts.filter((a) => settings.accounts.includes(a.id) && a.shop)) {
    const [list, read] = await Promise.all([syncedListings(account.id), shopRead(account.shop!.id)])
    for (const l of list) {
      if (l.state !== "active" && l.state !== "inactive" && l.state !== "expired") continue
      const r = read.listings[l.listingId]
      const roots = rootsOf(reg, r?.p ?? [], r?.k === "set", l.title)
      const entry = status.listings[l.listingId]
      const own: OurListing = {
        listingId: l.listingId,
        account: account.id,
        shop: account.shop!.name,
        title: l.title,
        state: l.state,
        image: l.images[0]?.url ?? null,
        views: l.views,
        favorites: l.favorites,
        createdAt: l.createdAt,
        status: entry?.status ?? (l.state === "active" ? null : "offline"),
        origin: entry?.origin ?? null,
      }
      for (const id of roots) {
        const c = byPlace.get(id) ?? { confirmed: 0, replace: 0, offline: 0, open: 0, listings: [] }
        if (own.status === "confirmed") c.confirmed++
        else if (own.status === "replace") c.replace++
        else if (own.status === "offline") c.offline++
        else c.open++
        c.listings.push(own)
        byPlace.set(id, c)
      }
    }
  }
  return byPlace
}

/** The places (roots) a listing's raw places stand for; a set gives each of its places. */
export function rootsOf(reg: PlaceRegister, raws: Parameters<typeof resolve>[1][], set: boolean, title = "") {
  const ids: string[] = []
  for (const raw of set ? raws : raws.slice(0, 1)) {
    const place = resolve(reg, raw)
    if (!place) continue
    const root = rootOf(reg, place)
    if (!ids.includes(root.id)) ids.push(root.id)
    // Sold by a sub-place's own name ("Waikiki Print, Honolulu"): it covers the sub-place's row too.
    if (root.id !== place.id && title && leadsWith(title, place, root) && !ids.includes(place.id)) ids.push(place.id)
  }
  return ids
}

/** Whether we have the place: a confirmed listing, or one not judged yet that's live. */
export const isCovered = (c: Coverage | undefined) => !!c && (c.confirmed > 0 || c.open > 0)
