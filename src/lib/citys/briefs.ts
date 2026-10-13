import sharp from "sharp"

import { readDoc, writeDoc } from "@/lib/db/documents"

import { writePlaceBrief } from "./prompts"
import { rankingState, type RefEntry } from "./ranking"
import { cropRefs, readRefFile, refCrops } from "./refs"
import type { PlaceBrief } from "./studio-types"

// What makes a place itself (landmarks, poster motifs, the compositions its
// best sellers use, geography, viewpoints), written once per place by
// Gemini from its best-selling posters and kept as citys/briefs/<placeId>,
// so every brief about the place knows London means Big Ben and a red bus,
// and what Bondi Beach really looks like. Its best real photos also go to
// the painter of a new composition, for the true geography of the motif.

const DOC = (placeId: string) => `citys/briefs/${placeId}`
const VERSION = 2
const writing = new Map<string, Promise<PlaceBrief | null>>()

/** The place's brief, written now (from its best sellers' pictures) when there is none or only an older one. */
export async function placeBrief(placeId: string, place: string, country = "", kind = ""): Promise<PlaceBrief | null> {
  const held = await readDoc<PlaceBrief | null>(DOC(placeId), null)
  if (held && (held.version ?? 1) >= VERSION) return held
  let pending = writing.get(placeId)
  if (!pending) {
    pending = (async () => {
      const pictures = await placePictures(placeId, { count: 6 }).catch(() => [])
      const brief = await writePlaceBrief(place, country, kind, pictures.map((p) => p.image))
      if (!brief.landmarks.length) return held
      await writeDoc(DOC(placeId), brief)
      return brief
    })()
      .catch((error) => {
        console.warn(`Place brief ${place}:`, (error as Error).message)
        return held
      })
      .finally(() => writing.delete(placeId))
    writing.set(placeId, pending)
  }
  return pending
}

/** A line on the place for the image model: its leading landmarks and what must be right. */
export const placeLine = (b: PlaceBrief | null) => (b ? [b.landmarks.slice(0, 6).join("; "), b.geography].filter(Boolean).join(". ") : undefined)

/** A place of the ranking by its name ("Sydney", "Telluride, Colorado"), for lab rounds that name their cities. */
export async function placeByName(name: string) {
  const state = await rankingState()
  const key = name.toLowerCase().split(",")[0].trim()
  const found = state.ranking.places.filter((p) => p.name.toLowerCase() === key).sort((a, b) => a.position - b.position)[0]
  return found ? { id: found.id, name: found.name, country: found.countryName, kind: found.kind, setting: found.setting } : null
}

/** Settings whose posters are mostly sea, beach and nature: what sells there is calm and pure. */
const CALM_SETTINGS = ["beach", "island", "nature", "lake", "mountains"]

/**
 * Whether the place is one of sea, beaches and nature (Amalfi Coast, Maui,
 * Lake Tahoe), where every picture is composed calm; a city by the sea
 * (Honolulu, Sydney) isn't, though its beach pictures are calm too.
 */
export async function isCalmPlace(placeId: string) {
  const state = await rankingState().catch(() => null)
  const place = state?.ranking.places.find((p) => p.id === placeId)
  return !!place && (CALM_SETTINGS.includes(place.setting) || place.kind === "coast")
}

// --- Its pictures ---

/** Shop style tags that mean a real photo (as the Stealer reads them). */
const PHOTO_TAGS = ["real", "blackwhite", "black and white", "photo", "photography", "bw"]

const isPhoto = (e: RefEntry) => e.look === "photo" || e.look === "bw" || (e.look === "unknown" && e.labels.some((l) => PHOTO_TAGS.includes(l.toLowerCase())))

export type PlacePicture = { listingId: number; file: string; photo: boolean; image: Buffer; shop: string }

/**
 * The pictures of the place's best-selling posters, best first, real photos
 * first (only those with `photosOnly`), taken out of their posters. Ones the
 * Stealer hasn't taken out yet are asked for now and waited for a while.
 * `spread` takes each shop's best one first, so the pictures are what the
 * place's top shops chose to show; `exclude` leaves listings out.
 */
export async function placePictures(
  placeId: string,
  { count = 6, photosOnly = false, wait = 45_000, spread = false, exclude = [] as number[] } = {}
): Promise<PlacePicture[]> {
  const state = await rankingState()
  const seen = new Set<number>(exclude)
  let entries = (state.index.get(placeId) ?? []).filter((e) => e.kind === "place" && e.listing.images[0] && !seen.has(e.listing.id) && !!seen.add(e.listing.id))
  if (spread) {
    const shops = new Set<number>()
    const first = entries.filter((e) => !shops.has(e.shopId) && !!shops.add(e.shopId))
    entries = [...first, ...entries.filter((e) => !first.includes(e))]
  }
  const photos = entries.filter(isPhoto)
  const wanted = (photosOnly ? photos.slice(0, count + 2) : [...photos.slice(0, count - 2), ...entries.filter((e) => !isPhoto(e)).slice(0, 2), ...photos.slice(count - 2, count + 2)]).slice(0, count + 2)
  if (!wanted.length) return []

  let crops = await refCrops(wanted.map((e) => e.listing.id))
  const missing = wanted.filter((e) => crops.get(e.listing.id)?.status !== "done")
  if (missing.length && wanted.length - missing.length < count) {
    await cropRefs(missing.map((e) => ({ listingId: e.listing.id, shopId: e.shopId, image: e.listing.images[0], title: e.listing.title })))
    for (const until = Date.now() + wait; Date.now() < until; ) {
      await new Promise((r) => setTimeout(r, 3000))
      crops = await refCrops(wanted.map((e) => e.listing.id))
      const left = wanted.filter((e) => {
        const status = crops.get(e.listing.id)?.status
        return status !== "done" && status !== "error"
      })
      if (!left.length || wanted.length - left.length >= count) break
    }
  }

  const out: PlacePicture[] = []
  for (const e of wanted) {
    if (out.length >= count) break
    const print = crops.get(e.listing.id)?.status === "done" ? crops.get(e.listing.id)!.prints[0] : undefined
    if (!print) continue
    const image = await readRefFile(e.listing.id, print.file)
      .then((data) => sharp(data).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer())
      .catch(() => null)
    if (image) out.push({ listingId: e.listing.id, file: print.file, photo: isPhoto(e), image, shop: e.shop })
  }
  return out
}
