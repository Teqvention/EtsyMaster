import { extractPosters } from "@/lib/generation/poster"
import { listSets } from "@/lib/generation/storage"
import type { ExtractedPoster, GenerationSet } from "@/lib/generation/types"
import { fetchReference } from "@/lib/mockups/reference"
import { NotFoundError } from "@/lib/mockups/storage"

import { addImages, getStyle, readGenerationFile, updateStyle } from "./storage"
import { scheduleReading } from "./understand"
import { MAX_IMAGES, type Style } from "./types"

// Saved listings onto a moodboard. Their photos show the poster framed in a
// room, which Gemini would read as part of the look, so the poster is taken
// out first: the ones a poster set already took out when there is one,
// otherwise found here the same way. It runs in the background on this
// server, the style counting the listings still `incoming`; the guide is
// read once none are.

/** A saved listing to take the posters of. */
export type SavedPoster = { listingId: number; title: string; image: string }

/** The board image's key for poster `n` of a saved listing's photo. */
const fromListing = (listingId: number, n: number) => `listing/${listingId}/${n}`
const LISTING = /^listing\/(\d+)\//

/** Starts adding the listings not on the board yet, and answers with the style counting them. */
export async function addSavedListings(id: string, listings: SavedPoster[]): Promise<Style> {
  const style = await getStyle(id)
  const on = new Set(style.images.flatMap((i) => i.from?.match(LISTING)?.[1] ?? []).map(Number))
  const fresh = listings.filter((l) => !on.has(l.listingId))
  if (fresh.length === 0) return style
  const next = await updateStyle(id, (s) => {
    if (s.images.length + (s.incoming ?? 0) + fresh.length > MAX_IMAGES) {
      throw new Error(`A style holds up to ${MAX_IMAGES} images`)
    }
    return { ...s, incoming: (s.incoming ?? 0) + fresh.length, importError: undefined }
  })
  void bring(id, fresh)
  return next
}

/** Takes their posters out and adds them in the order picked; a photo that fails is left out and said so. */
async function bring(id: string, listings: SavedPoster[]) {
  const sets = await listSets().catch(() => [])
  const results = await Promise.allSettled(listings.map((listing) => postersOf(listing, sets)))
  const failed: unknown[] = []
  const items = results.flatMap((result, i) => {
    if (result.status === "rejected") {
      console.error(`Style ${id}, saved listing ${listings[i].listingId}:`, result.reason)
      failed.push(result.reason)
      return []
    }
    return result.value.map((data, n) => ({ data, from: fromListing(listings[i].listingId, n) }))
  })

  let note: string | undefined
  if (failed.length) {
    note = `${failed.length} of ${listings.length} photos couldn't be read: ${message(failed[0])}`
  }
  try {
    // A set's photo can hold more posters than there's room for: the first ones go in.
    if (items.length) await addImages(id, items, { trim: true })
  } catch (error) {
    if (!(error instanceof NotFoundError)) console.error(`Style ${id}, adding saved posters:`, error)
    note = `Couldn't add the posters: ${message(error)}`
  }

  try {
    const style = await updateStyle(id, (s) => ({
      ...s,
      incoming: Math.max(0, (s.incoming ?? 0) - listings.length) || undefined,
      importError: note ?? s.importError,
    }))
    if (!style.incoming) await scheduleReading(id)
  } catch (error) {
    if (!(error instanceof NotFoundError)) console.error(`Style ${id}, adding saved posters:`, error)
  }
}

const done = (p: ExtractedPoster) => p.status === "done" && !!p.file

/** The posters in a saved listing's photo, flat and front-on; `sets` newest first. */
async function postersOf(listing: SavedPoster, sets: GenerationSet[]): Promise<Buffer[]> {
  const set = sets.find(
    (s) => s.kind === "poster" && s.source.listingId === listing.listingId && s.posters.some(done)
  )
  if (set) {
    try {
      return await Promise.all(set.posters.filter(done).map((p) => readGenerationFile(set.id, p.file!)))
    } catch {
      // Its files are gone: take them out again.
    }
  }
  const { prints } = await extractPosters(await fetchReference(listing.image), listing.title)
  return prints.map((p) => p.image)
}

const message = (error: unknown) => (error instanceof Error ? error.message : "Failed")
