import { photoUrl } from "./photos"
import { ourCoverage, type Coverage } from "./ours"
import { rankingState, type RefEntry } from "./ranking"
import { cropRefs, refCrops, refFileUrl, type RefCrop } from "./refs"
import { citySettings } from "./settings"
import type { RankedPlace } from "./types"

// The City Stealer's view of the ranking: every place in priority order
// with how many reference photos it has and how much of it we have
// ourselves, and for one place (or a strip of many) the competitors'
// listings behind it, best selling first, with their posters taken out of
// the photos. Looking at a place asks for the crops of its best listings.

/** Shop style tags that mean a real photo. */
const PHOTO_TAGS = ["real", "blackwhite", "black and white", "photo", "photography", "bw"]

export type StealerRef = {
  listingId: number
  shopId: number
  shop: string
  labels: string[]
  title: string
  /** The listing photo, 570 px wide, and full size. */
  image: string
  full: string
  /** The short form, to ask for crops and posters. */
  short: string
  tags: string[]
  spm: number
  fav: number
  ageDays: number
  reviewsYear: number
  kind: RefEntry["kind"]
  look: RefEntry["look"]
  /** A real photo (by what the title says, else by the shop's tags). */
  photo: boolean
  via?: string
  crop: {
    status: RefCrop["status"] | "none"
    /** `rough`: what the last look found wrong with a single print's cut-out. */
    prints: { file: string; url: string; thumb: string; width: number; height: number; label: string; rough?: string }[]
    error?: string
    /** Made before the photo was taken out of the poster's design: taken out again. */
    stale?: boolean
  }
}

export type CoverageSummary = Pick<Coverage, "confirmed" | "replace" | "offline" | "open">

export type StealerCityRow = Pick<
  RankedPlace,
  "id" | "name" | "tier" | "score" | "position" | "country" | "countryName" | "region" | "kind" | "size" | "setting" | "tags" | "spm" | "favMonth" | "shops"
> & { refs: number; photos: number; coverage: CoverageSummary | null }

export type StealerState = {
  cities: StealerCityRow[]
  shops: { shopId: number; name: string; secondary: string[]; picked: boolean; listings: number }[]
}

export type StealerCity = { place: RankedPlace; refs: StealerRef[]; coverage: Coverage | null }

const isPhoto = (entry: RefEntry) =>
  entry.look === "photo" || entry.look === "bw" || (entry.look === "unknown" && entry.labels.some((l) => PHOTO_TAGS.includes(l.toLowerCase())))

async function scope() {
  const [settings, state] = await Promise.all([citySettings(), rankingState()])
  const picked = settings.stealer.length ? new Set(settings.stealer) : null
  const allowed = (shopId: number) => !picked || picked.has(shopId)
  return { settings, state, picked, allowed }
}

export async function stealerState(): Promise<StealerState> {
  const [{ state, picked, allowed }, coverage] = await Promise.all([scope(), ourCoverage()])
  const cities: StealerCityRow[] = []
  for (const p of state.ranking.places) {
    const entries = (state.index.get(p.id) ?? []).filter((e) => allowed(e.shopId) && e.kind !== "custom")
    const c = coverage.get(p.id)
    cities.push({
      id: p.id,
      name: p.name,
      tier: p.tier,
      score: p.score,
      position: p.position,
      country: p.country,
      countryName: p.countryName,
      ...(p.region && { region: p.region }),
      kind: p.kind,
      ...(p.size && { size: p.size }),
      setting: p.setting,
      tags: p.tags,
      spm: p.spm,
      favMonth: p.favMonth,
      shops: p.shops,
      refs: entries.length,
      photos: entries.filter(isPhoto).length,
      coverage: c ? { confirmed: c.confirmed, replace: c.replace, offline: c.offline, open: c.open } : null,
    })
  }
  return {
    cities,
    shops: state.ranking.shops
      .filter((s) => s.included)
      .map((s) => ({ shopId: s.shopId, name: s.name, secondary: s.secondary, picked: !picked || picked.has(s.shopId), listings: s.listings })),
  }
}

/** One place: its ranking row, every reference listing (best first) and our listings of it. */
export async function stealerCity(placeId: string, { crop = 36 } = {}): Promise<StealerCity> {
  const [{ state, allowed }, coverage] = await Promise.all([scope(), ourCoverage()])
  const place = state.ranking.places.find((p) => p.id === placeId)
  if (!place) throw new Error("Unknown place")
  const entries = (state.index.get(placeId) ?? []).filter((e) => allowed(e.shopId) && e.kind !== "custom")
  const refs = await toRefs(entries)
  await askCrops(refs.slice(0, crop))
  return { place, refs, coverage: coverage.get(placeId) ?? null }
}

/** The best `per` references of each place, for the all-cities view. */
export async function stealerStrips(placeIds: string[], per = 8, photosOnly = false) {
  const { state, allowed } = await scope()
  const out: Record<string, StealerRef[]> = {}
  const all: StealerRef[] = []
  for (const id of placeIds.slice(0, 60)) {
    const entries = (state.index.get(id) ?? []).filter((e) => allowed(e.shopId) && e.kind !== "custom" && (!photosOnly || isPhoto(e)))
    out[id] = await toRefs(entries.slice(0, per))
    all.push(...out[id])
  }
  await askCrops(all)
  return out
}

async function toRefs(entries: RefEntry[]): Promise<StealerRef[]> {
  const seen = new Set<number>()
  const unique = entries.filter((e) => !seen.has(e.listing.id) && seen.add(e.listing.id))
  const crops = await refCrops(unique.map((e) => e.listing.id))
  return unique.map((e) => {
    const short = e.listing.images[0] ?? ""
    const crop = crops.get(e.listing.id)
    return {
      listingId: e.listing.id,
      shopId: e.shopId,
      shop: e.shop,
      labels: e.labels,
      title: e.listing.title,
      image: short ? photoUrl(short, "570xN") : "",
      full: short ? photoUrl(short, "fullxfull") : "",
      short,
      tags: e.listing.tags,
      spm: e.listing.spm,
      fav: e.listing.fav,
      ageDays: e.listing.ageDays,
      reviewsYear: e.listing.reviews[1],
      kind: e.kind,
      look: e.look,
      photo: isPhoto(e),
      ...(e.via && { via: e.via }),
      crop: {
        status: crop?.status ?? "none",
        prints: (crop?.prints ?? []).map((p) => ({
          file: p.file,
          url: refFileUrl(e.listing.id, p.file),
          thumb: refFileUrl(e.listing.id, p.file, 480),
          width: p.width,
          height: p.height,
          label: p.label,
          ...(p.rough && { rough: p.rough }),
        })),
        ...(crop?.error && { error: crop.error }),
        ...(crop?.status === "done" && crop.prints.some((p) => !p.poster) && { stale: true }),
      },
    }
  })
}

function askCrops(refs: StealerRef[]) {
  const todo = refs.filter((r) => (r.crop.status === "none" || r.crop.stale) && r.short)
  if (!todo.length) return Promise.resolve(0)
  return cropRefs(todo.map((r) => ({ listingId: r.listingId, shopId: r.shopId, image: r.short, title: r.title })))
}
