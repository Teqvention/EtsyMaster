import sharp from "sharp"

import { readDoc, readDocs, updateDoc } from "@/lib/db/documents"
import { extractPosters } from "@/lib/generation/poster"
import { GooglePausedError } from "@/lib/google/pause"
import { askJson } from "@/lib/mockups/gemini"
import { refineArtwork } from "@/lib/mockups/locate"
import { fetchReference } from "@/lib/mockups/reference"
import { unwarp, type Pixels } from "@/lib/mockups/sheet"
import { NotFoundError } from "@/lib/mockups/storage"
import type { Point, Quad } from "@/lib/mockups/types"
import { getFile, putFile } from "@/lib/storage/files"

import { photoUrl } from "./photos"

// Reference photos for the City Stealer: the city photo itself, out of a
// competitor's listing. Two steps: the poster is taken out of its frame and
// room the way Generation takes steals out (generation/poster.ts), then the
// picture is taken out of the poster's design (its title, captions,
// coordinates, colour swatches and margins), so only the photo is left.
// A last look checks each picture is one clean photo: a set's print that
// isn't (two half pictures, a frame) is left out, a single one is kept and
// marked rough, so it's never a composition to re-take.
// Once per listing and kept; a set's photo gives each of its prints. Asked
// for as the Stealer shows them, two at a time on this server; one that
// fails says why and can be asked again.

/**
 * One print of the listing's photo: the picture in it (`file`), and the
 * whole poster it came from; `rough` says what's wrong when the last look
 * found it not cleanly cut out (kept only when it's the photo's one print).
 */
export type RefPrint = { file: string; width: number; height: number; label: string; poster?: string; rough?: string }

export type RefCrop = {
  listingId: number
  shopId: number
  status: "pending" | "running" | "done" | "error"
  layout?: "single" | "set" | "flat"
  prints: RefPrint[]
  error?: string
  /** 2: the picture straightened at its own edges, wedges trimmed and checked (13 Oct). */
  version?: number
  at: string
}

/** Crops made before this are made again as they're looked at. */
const CROP_VERSION = 2

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
    // Crops from before the picture was taken out cleanly (straightened, trimmed, checked) are made again.
    const stale = crop?.status === "done" && (crop.prints.some((p) => !p.poster) || (crop.version ?? 1) < CROP_VERSION)
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
      let shown = picture ?? { image: print.image, width: print.width, height: print.height }
      let problem = await roughness(shown.image).catch(() => undefined)
      // A border or strip left along an edge: cut a little deeper all round and look once more.
      if (problem && MILD.test(problem) && !SEVERE.test(problem)) {
        shown = await deeper(shown.image)
        problem = await roughness(shown.image).catch(() => undefined)
      }
      const rough = problem && SEVERE.test(problem) ? problem : undefined
      // The picture as its own file; the whole poster stays as it is (style boards take it).
      const file = shown.image === print.image ? poster : `print-${i + 1}-${stamp}.jpg`
      if (file !== poster) await putFile(refFileKey(job.listingId, file), shown.image)
      kept.push({ file, width: shown.width, height: shown.height, label: print.label, poster, ...(rough && { rough }) })
    }
    // A set's rough prints go, while a clean one is left.
    const clean = kept.filter((p) => !p.rough)
    const final = clean.length ? clean : kept.slice(0, 1)
    if (final.length < kept.length) console.info(`City reference ${job.listingId}: ${kept.length - final.length} of ${kept.length} prints left out (${kept.filter((p) => p.rough).map((p) => p.rough).join("; ")})`)
    await save(job.listingId, { status: "done", layout: final.length > 1 ? layout : layout === "set" ? "single" : layout, prints: final, version: CROP_VERSION }, job.shopId)
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

const CLEAN_SCHEMA = {
  type: "OBJECT",
  properties: { clean: { type: "BOOLEAN" }, problem: { type: "STRING" } },
  required: ["clean", "problem"],
}

/** Problems that make a cut-out no use as a reference; and ones a deeper trim puts right. */
// A picture a little cut off is still a fine reference (13 Oct: the check called good prints "badly cut off").
const SEVERE = /another (picture|image|print)|two (pictures|images)|joined|room|furniture|wall|frame|title|caption|text/i
const MILD = /border|strip|edge|margin|line|sliver/i

/** The picture with another 3.5 % off every side. */
async function deeper(image: Buffer) {
  const { width = 0, height = 0 } = await sharp(image).metadata()
  const x = Math.round(width * 0.035)
  const y = Math.round(height * 0.035)
  const { data, info } = await sharp(image).extract({ left: x, top: y, width: width - 2 * x, height: height - 2 * y }).jpeg({ quality: 94 }).toBuffer({ resolveWithObject: true })
  return { image: data, width: info.width, height: info.height }
}

/** What's wrong with a cut-out picture, in a few words; undefined when it's one clean picture. */
async function roughness(image: Buffer): Promise<string | undefined> {
  const small = await sharp(image).resize(768, 768, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer()
  const a = await askJson<{ clean?: boolean; problem?: string }>(
    `This picture was cut out of a product photo of wall art (a city or travel poster). Is it exactly one clean picture: a single photograph or illustration, front-on, with nothing else? Not clean: a frame, mat, wall, furniture or part of a room still in it; a strip or half of another picture; a poster's title or caption band; two pictures joined; badly cut off. Small natural white areas inside the picture (a sky, snow) are fine. Answer "clean", and in "problem" what's wrong in 2 to 6 words ("" when clean).`,
    [small],
    { schema: CLEAN_SCHEMA, temperature: 0, quick: true }
  )
  return a.clean === false ? (a.problem?.trim().slice(0, 80) || "not cleanly cut out") : undefined
}

// --- The picture in a poster ---

const PICTURE_SCHEMA = {
  type: "OBJECT",
  properties: {
    box_2d: { type: "ARRAY", items: { type: "INTEGER" } },
    design: { type: "BOOLEAN" },
  },
  required: ["box_2d", "design"],
}

/** Insets a found picture by this share of its side, so a thin border or frame line never comes along. */
const INSET = 0.006
/** What's taken off every side last, after the wedges. */
const SAFETY = 0.018

/**
 * The photo or illustration inside a poster design, without the design's
 * lettering, captions, swatches, icons and margins; the whole image when the
 * picture fills it (or none was found). Gemini boxes the picture; its edges
 * are then found in the pixels and it's unwarped front-on, as a print is out
 * of its room: a poster hanging a little askew left a wedge of margin and
 * its title in the corner of an upright crop (13 Oct, studioUBILA's New York
 * posters). Wedges of margin or frame still at the edges are trimmed last.
 */
export async function pictureOf(poster: Buffer): Promise<{ image: Buffer; width: number; height: number }> {
  const px = await pixelsOf(poster)
  const { width: W, height: H } = px
  const found = await askJson<{ box_2d?: number[]; design?: boolean }>(
    `This is a city or travel poster. Find the picture of the place in it: the photograph or illustration itself, without the poster's title, captions, text blocks, coordinates, colour swatches, icons, logos, borders or white margins around it.
Return "box_2d" as [ymin, xmin, ymax, xmax] normalized to 0-1000, tight around the picture's own edges, and "design": true when there is lettering or layout around the picture, false when the picture fills the whole poster edge to edge.`,
    [poster],
    { schema: PICTURE_SCHEMA, temperature: 0, quick: true }
  )
  const box = found.box_2d
  const usable = found.design && Array.isArray(box) && box.length === 4 && box.every(Number.isFinite)
  let quad: Quad | null = null
  if (usable) {
    const [ymin, xmin, ymax, xmax] = box.map((v) => Math.min(1000, Math.max(0, v)))
    const [x0, x1, y0, y1] = [(xmin / 1000) * W, (xmax / 1000) * W, (ymin / 1000) * H, (ymax / 1000) * H]
    const area = (x1 - x0) * (y1 - y0)
    // Nearly all of it, or too little to be the picture: the poster is the picture.
    if (area <= 0.92 * W * H && area >= 0.15 * W * H && x1 - x0 >= 64 && y1 - y0 >= 64) {
      quad = refineArtwork(px, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
    }
  }
  const straight = quad ? straighten(px, inset(quad, INSET)) : rgbOf(px)
  // Then a margin of safety all round: for a reference a sliver less beats a sliver of frame.
  const trimmed = trimWedges(straight)
  const x = Math.round(trimmed.width * SAFETY)
  const y = Math.round(trimmed.height * SAFETY)
  const safe = trimSides(trimmed, x, y, x, y)
  const image = await sharp(safe.rgb, { raw: { width: safe.width, height: safe.height, channels: 3 } }).jpeg({ quality: 94 }).toBuffer()
  return { image, width: safe.width, height: safe.height }
}

async function pixelsOf(image: Buffer): Promise<Pixels> {
  const { data, info } = await sharp(image).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height }
}

type Rgb = { rgb: Buffer; width: number; height: number }

function rgbOf({ data, width, height }: Pixels): Rgb {
  const rgb = Buffer.alloc(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = data[i * 4]
    rgb[i * 3 + 1] = data[i * 4 + 1]
    rgb[i * 3 + 2] = data[i * 4 + 2]
  }
  return { rgb, width, height }
}

/** The quad's picture front-on, at its own size. */
function straighten(px: Pixels, quad: Quad): Rgb {
  const length = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const width = Math.max(1, Math.round(Math.max(length(quad[0], quad[1]), length(quad[3], quad[2]))))
  const height = Math.max(1, Math.round(Math.max(length(quad[0], quad[3]), length(quad[1], quad[2]))))
  const [r, g, b] = unwarp(px, quad, width, height)
  const rgb = Buffer.alloc(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = r[i]
    rgb[i * 3 + 1] = g[i]
    rgb[i * 3 + 2] = b[i]
  }
  return { rgb, width, height }
}

/** The quad pulled in towards its centre by `share` of its size. */
function inset(quad: Quad, share: number): Quad {
  const cx = quad.reduce((s, p) => s + p[0], 0) / 4
  const cy = quad.reduce((s, p) => s + p[1], 0) / 4
  return quad.map(([x, y]) => [x + (cx - x) * share * 2, y + (cy - y) * share * 2]) as Quad
}

/** How well a straight line fits these values in order (r², 0 to 1). */
function straightness(values: number[]) {
  const n = values.length
  const mt = (n - 1) / 2
  const mv = values.reduce((s, v) => s + v, 0) / n
  let stv = 0, stt = 0, svv = 0
  values.forEach((v, t) => {
    stv += (t - mt) * (v - mv)
    stt += (t - mt) ** 2
    svv += (v - mv) ** 2
  })
  return stt && svv ? (stv * stv) / (stt * svv) : 0
}

/**
 * Trims wedges of margin, mat or frame along the edges. Each side learns
 * its margin's colour from its outermost pixels (white, a grey mat in
 * shadow, a black frame: anything flat and nearly colourless), then is
 * measured: how deep that colour reaches in along its length. A run that
 * ramps from nothing to some depth, or slants all along (an edge left over,
 * up to 10 % deep), is cut at its deepest; an even strip all along (up to
 * 3 %) is cut too. A side whose margin colour reaches deep in nearly all
 * along is the picture itself (a pale sky) and stays. Tuned on 17 prints
 * of New York on 13 Oct (mats, frames and slanted poster edges).
 */
function trimWedges(img: Rgb): Rgb {
  const { rgb, width, height } = img
  const luma = (x: number, y: number) => {
    const i = (y * width + x) * 3
    return 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2]
  }
  const sat = (x: number, y: number) => {
    const i = (y * width + x) * 3
    return Math.max(rgb[i], rgb[i + 1], rgb[i + 2]) - Math.min(rgb[i], rgb[i + 1], rgb[i + 2])
  }
  /** How far to cut a side; `at(t, d)` is the pixel `d` in from the side at `t` along it. */
  const cut = (along: number, across: number, at: (t: number, d: number) => [number, number]) => {
    // Its margin: the flat, nearly colourless pixels of its two outermost lines.
    const edge: number[] = []
    let seen = 0
    for (let d = 0; d < 2; d++) {
      for (let t = 0; t < along; t++) {
        seen++
        const [x, y] = at(t, d)
        const v = luma(x, y)
        if (sat(x, y) < 22 && (v > 170 || v < 50)) edge.push(v)
      }
    }
    if (edge.length < seen * 0.03) return 0
    edge.sort((a, b) => a - b)
    const tone = edge[edge.length >> 1]
    const flat = (x: number, y: number) => sat(x, y) < 26 && Math.abs(luma(x, y) - tone) <= 16
    const reach = Math.floor(across * 0.12)
    const depths: number[] = []
    for (let t = 0; t < along; t += 2) {
      let d = 0
      while (d < reach && flat(...at(t, d))) d++
      depths.push(d)
    }
    if (depths.filter((d) => d > 0).length < depths.length * 0.03) return 0
    // Deep in nearly all along: the picture is flat there.
    if (depths.filter((d) => d >= reach).length > depths.length * 0.3) return 0
    const sorted = [...depths].sort((a, b) => a - b)
    const low = sorted[Math.floor(depths.length * 0.1)]
    const median = sorted[depths.length >> 1]
    const max = sorted[sorted.length - 1]
    // A strip all along: as deep at its shallow tenth as in the middle.
    if (low > 0 && median - low <= 3 && median <= across * 0.03) return median + 1
    if (max > across * 0.1) return 0
    // A wedge: clean somewhere, ramping to its deepest point; or a slanted edge all along.
    if (low === 0 || straightness(depths) >= 0.8) return max + 1
    return 0
  }
  /**
   * A thin strip or slanted sliver of any colour (a white mat against a pale
   * sky): a sharp step in brightness a few pixels in, at the same depth all
   * along the side or on a straight slant.
   */
  const step = (along: number, across: number, at: (t: number, d: number) => [number, number]) => {
    const deepest = Math.max(2, Math.floor(across * 0.05))
    const hits: [number, number][] = []
    let looked = 0
    for (let t = 1; t < along - 1; t += 2) {
      looked++
      const avg = (d: number) => {
        const [x0, y0] = at(t - 1, d)
        const [x1, y1] = at(t, d)
        const [x2, y2] = at(t + 1, d)
        return (luma(x0, y0) + luma(x1, y1) + luma(x2, y2)) / 3
      }
      let best = -1
      let size = 0
      for (let d = 0; d < deepest; d++) {
        const jump = Math.abs(avg(d) - avg(d + 1))
        if (jump > size) {
          size = jump
          best = d
        }
      }
      if (size >= 28) hits.push([t, best])
    }
    if (hits.length < looked * 0.4) return 0
    const depths = hits.map(([, d]) => d).sort((a, b) => a - b)
    const q1 = depths[Math.floor(depths.length * 0.25)]
    const q3 = depths[Math.floor(depths.length * 0.75)]
    if (q3 - q1 <= 2) return depths[depths.length >> 1] + 1
    return straightness(hits.map(([, d]) => d)) >= 0.8 ? depths[Math.floor(depths.length * 0.95)] + 1 : 0
  }
  const side = (along: number, across: number, at: (t: number, d: number) => [number, number]) => Math.max(cut(along, across, at), step(along, across, at))
  const top = side(width, height, (t, d) => [t, d])
  const bottom = side(width, height, (t, d) => [t, height - 1 - d])
  const left = side(height, width, (t, d) => [d, t])
  const right = side(height, width, (t, d) => [width - 1 - d, t])
  return trimSides(img, left, top, right, bottom)
}

/** The image less these many pixels on each side (or as it is, should that take too much). */
function trimSides(img: Rgb, left: number, top: number, right: number, bottom: number): Rgb {
  const { rgb, width, height } = img
  if (!top && !bottom && !left && !right) return img
  const w = width - left - right
  const h = height - top - bottom
  if (w < width * 0.7 || h < height * 0.7) return img
  const out = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) rgb.copy(out, y * w * 3, ((y + top) * width + left) * 3, ((y + top) * width + left + w) * 3)
  return { rgb: out, width: w, height: h }
}
