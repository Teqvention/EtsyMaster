import sharp from "sharp"

import { readDoc, readDocs, updateDoc } from "@/lib/db/documents"
import { extractPosters } from "@/lib/generation/poster"
import { GooglePausedError } from "@/lib/google/pause"
import { askJson } from "@/lib/mockups/gemini"
import { fetchReference } from "@/lib/mockups/reference"
import { NotFoundError } from "@/lib/mockups/storage"
import { getFile, putFile } from "@/lib/storage/files"

import { photoUrl } from "./photos"

// Reference photos for the City Stealer: the city photo itself, out of a
// competitor's listing. Two steps: the poster is taken out of its frame and
// room the way Generation takes steals out (generation/poster.ts), then the
// picture is taken out of the poster's design (its title, captions,
// coordinates, colour swatches and margins), so only the photo is left.
// Once per listing and kept; a set's photo gives each of its prints. Asked
// for as the Stealer shows them, two at a time on this server; one that
// fails says why and can be asked again.

/** One print of the listing's photo: the picture in it (`file`), and the whole poster it came from. */
export type RefPrint = { file: string; width: number; height: number; label: string; poster?: string }

export type RefCrop = {
  listingId: number
  shopId: number
  status: "pending" | "running" | "done" | "error"
  layout?: "single" | "set" | "flat"
  prints: RefPrint[]
  error?: string
  at: string
}

const DOC = (listingId: number) => `citys/refs/${listingId}`
export const refFileKey = (listingId: number, file: string) => {
  if (!Number.isInteger(listingId) || !/^print-\d+-[a-z0-9]+p?\.jpg$/.test(file)) throw new NotFoundError("Unknown file")
  return `citys/refs/${listingId}/${file}`
}
export const refFileUrl = (listingId: number, file: string, width?: number) =>
  `/api/citys/refs/${listingId}/${file}${width ? `?w=${width}` : ""}`

export async function refCrop(listingId: number) {
  return readDoc<RefCrop | null>(DOC(listingId), null)
}

/** The crops kept for these listings, by listing id. */
export async function refCrops(listingIds: number[]): Promise<Map<number, RefCrop>> {
  const wanted = new Set(listingIds)
  const found = new Map<number, RefCrop>()
  if (!wanted.size) return found
  // One read of the folder beats a thousand single ones.
  const all = await readDocs<RefCrop>("citys/refs/")
  for (const crop of all.values()) if (crop && wanted.has(crop.listingId)) found.set(crop.listingId, crop)
  return found
}

type Job = { listingId: number; shopId: number; image: string; title: string }

const PARALLEL = 2
type Queue = { queue: Job[]; active: Set<number>; run: (job: Job) => Promise<void> }
const global = globalThis as typeof globalThis & { __cityRefs?: Queue }
const queue = (global.__cityRefs ??= { queue: [], active: new Set(), run: async () => {} })

/**
 * Takes the posters out of these listings' photos, the ones not done yet,
 * in the background; answers how many went in line. `image` is the listing
 * photo's short form (digest) or a whole address.
 */
export async function cropRefs(jobs: Job[], { again = false } = {}) {
  const held = await refCrops(jobs.map((j) => j.listingId))
  let queued = 0
  for (const job of jobs) {
    const crop = held.get(job.listingId)
    // Crops from before the picture was taken out of the poster's design are made again.
    const stale = crop?.status === "done" && crop.prints.some((p) => !p.poster)
    const done = (crop?.status === "done" && !stale) || crop?.status === "running"
    if ((done && !again) || queue.active.has(job.listingId) || queue.queue.some((q) => q.listingId === job.listingId)) continue
    if (crop?.status === "error" && !again) continue
    queue.queue.push(job)
    queued++
  }
  pump()
  return queued
}

function pump() {
  while (queue.active.size < PARALLEL && queue.queue.length) {
    const job = queue.queue.shift()!
    queue.active.add(job.listingId)
    // The newest code's crop, also when an older copy of this module drains the line.
    void queue.run(job).finally(() => {
      queue.active.delete(job.listingId)
      pump()
    })
  }
}

async function save(listingId: number, change: Partial<RefCrop>, shopId: number) {
  await updateDoc<RefCrop>(DOC(listingId), { listingId, shopId, status: "pending", prints: [], at: "" }, (current) => ({
    ...current,
    ...change,
    at: new Date().toISOString(),
  }))
}

queue.run = (job) => crop(job)

async function crop(job: Job) {
  try {
    await save(job.listingId, { status: "running", error: undefined }, job.shopId)
    const photo = await fetchReference(photoUrl(job.image, "fullxfull"))
    const { layout, prints } = await extractPosters(photo, job.title)
    const kept: RefPrint[] = []
    for (const [i, print] of prints.entries()) {
      const stamp = Date.now().toString(36)
      const poster = `print-${i + 1}-${stamp}p.jpg`
      await putFile(refFileKey(job.listingId, poster), print.image)
      const picture = await pictureOf(print.image).catch((error) => {
        console.warn(`City reference ${job.listingId}: no picture found`, error)
        return null
      })
      if (picture) {
        const file = `print-${i + 1}-${stamp}.jpg`
        await putFile(refFileKey(job.listingId, file), picture.image)
        kept.push({ file, width: picture.width, height: picture.height, label: print.label, poster })
      } else {
        kept.push({ file: poster, width: print.width, height: print.height, label: print.label, poster })
      }
    }
    await save(job.listingId, { status: "done", layout, prints: kept }, job.shopId)
  } catch (error) {
    if (error instanceof GooglePausedError) {
      await save(job.listingId, { status: "pending", error: undefined }, job.shopId)
      return
    }
    console.error(`City reference ${job.listingId}:`, error)
    await save(job.listingId, { status: "error", error: (error as Error).message }, job.shopId).catch(() => {})
  }
}

/** A crop's image file. */
export const readRefFile = (listingId: number, file: string) => getFile(refFileKey(listingId, file))

// --- The picture in a poster ---

const PICTURE_SCHEMA = {
  type: "OBJECT",
  properties: {
    box_2d: { type: "ARRAY", items: { type: "INTEGER" } },
    design: { type: "BOOLEAN" },
  },
  required: ["box_2d", "design"],
}

/** Insets a found box by this share of its side, so a thin border or frame line never comes along. */
const INSET = 0.008

/**
 * The photo or illustration inside a poster design, without the design's
 * lettering, captions, swatches, icons and margins; the whole image when the
 * picture fills it (or none was found).
 */
export async function pictureOf(poster: Buffer): Promise<{ image: Buffer; width: number; height: number }> {
  const { width: W, height: H } = await sharp(poster).metadata()
  const whole = async () => ({ image: await sharp(poster).jpeg({ quality: 94 }).toBuffer(), width: W!, height: H! })
  const found = await askJson<{ box_2d?: number[]; design?: boolean }>(
    `This is a city or travel poster. Find the picture of the place in it: the photograph or illustration itself, without the poster's title, captions, text blocks, coordinates, colour swatches, icons, logos, borders or white margins around it.
Return "box_2d" as [ymin, xmin, ymax, xmax] normalized to 0-1000, tight around the picture's own edges, and "design": true when there is lettering or layout around the picture, false when the picture fills the whole poster edge to edge.`,
    [poster],
    { schema: PICTURE_SCHEMA, temperature: 0, quick: true }
  )
  const box = found.box_2d
  if (!found.design || !Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return whole()
  const [ymin, xmin, ymax, xmax] = box.map((v) => Math.min(1000, Math.max(0, v)))
  const w = ((xmax - xmin) / 1000) * W!
  const h = ((ymax - ymin) / 1000) * H!
  // Nearly all of it, or too little to be the picture: keep the poster as it is.
  if (w * h > 0.92 * W! * H! || w * h < 0.15 * W! * H! || w < 64 || h < 64) return whole()
  const left = Math.round((xmin / 1000) * W! + w * INSET)
  const top = Math.round((ymin / 1000) * H! + h * INSET)
  const width = Math.round(w * (1 - 2 * INSET))
  const height = Math.round(h * (1 - 2 * INSET))
  const image = await sharp(poster).extract({ left, top, width: Math.min(width, W! - left), height: Math.min(height, H! - top) }).jpeg({ quality: 94 }).toBuffer()
  return { image, width, height }
}
