import { createHash } from "node:crypto"

import sharp, { type OverlayOptions } from "sharp"

import { BLEED_MM, MAX_DPI, OFFERED_KEYS, PRINT_DPI, SIZES, type Orientation, type SizeKey } from "@/lib/catalog/sizes"

import { writeFileUnder } from "./files"
import type { PrintFile } from "./types"

// Print files: one per size, exactly the shape of its Gelato placeholder (the
// size plus BLEED_MM all round, catalog/sizes), so Gelato's `cover` has
// nothing to cut. The rim generators leave around a picture (a lighter or
// darker frame a few pixels deep) comes off first. The poster is then fitted
// to the size without losing its motif: where an edge it has to grow at is
// background (a sky, a paper border), that background grows, its own texture
// mirrored outward and softening with distance; otherwise background along
// the edges it can lose is cropped, as far as it leaves the motif air; only a
// poster busy on every side loses a sliver, and the rest grows as a blurred
// continuation of its edge colours. The bleed mirrors the fitted poster's
// edge, so what's left inside the cut is the poster as fitted.
// As sharp as the poster allows between PRINT_DPI and MAX_DPI; Lanczos up,
// sRGB, JPEG 95 at full colour resolution.

/** Shapes this close count as the same: half a percent is never seen. */
const EXACT = 0.005
/** At most this much of a busy poster's length is cropped. */
const SLIGHT = 0.03
/** Of an edge's background, at most this share is cropped, so the motif keeps air around it. */
const CROP_SHARE = 0.6
/** A pixel this far (RGB distance) from the edge's colour isn't background. */
const FAR = 56
/** Background thinner than this (share of the side) doesn't count. */
const MIN_DEPTH = 0.01
/** Lines in a row that decide where the background ends. */
const RUN = 4
/** A rim is at most this share of the side deep. */
const RIM = 0.01
/** A line whose average colour is this far (RGB distance) from the lines inside it is rim. */
const RIM_FAR = 6

type Raw = { data: Buffer; width: number; height: number }
type Side = "top" | "bottom" | "left" | "right"

/** One file per size, written into `dir` under pipeline/ in storage; `url` is still null. */
export async function makePrintFiles(
  poster: Buffer,
  orientation: Orientation,
  dir: string,
  sizes: SizeKey[] = [...OFFERED_KEYS]
): Promise<PrintFile[]> {
  const { data, info } = await sharp(poster)
    .rotate()
    .toColourspace("srgb")
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const raw = withoutRim({ data, width: info.width, height: info.height })
  const depths = {
    top: calmDepth(raw, "top"),
    bottom: calmDepth(raw, "bottom"),
    left: calmDepth(raw, "left"),
    right: calmDepth(raw, "right"),
  }

  const files: PrintFile[] = []
  // Each file goes up while the next is made.
  const writes: Promise<unknown>[] = []
  for (const size of SIZES.filter((s) => sizes.includes(s.key))) {
    const [widthMm, heightMm] = orientation === "hor" ? [size.heightMm, size.widthMm] : [size.widthMm, size.heightMm]
    // The poster's own pixels across the size, held between Gelato's minimum and what's worth printing.
    const own = Math.min(raw.width / (widthMm / 25.4), raw.height / (heightMm / 25.4))
    const dpi = Math.round(Math.min(MAX_DPI, Math.max(PRINT_DPI, own)))
    const px = (mm: number) => Math.round((mm / 25.4) * dpi)
    const bleed = px(BLEED_MM)
    const { picture, fit } = await fitTo(raw, depths, px(widthMm), px(heightMm))
    const jpeg = await sharp(picture.data, { raw: { width: picture.width, height: picture.height, channels: 3 } })
      .extend({ top: bleed, bottom: bleed, left: bleed, right: bleed, extendWith: "mirror" })
      .withMetadata({ density: dpi })
      .withIccProfile("srgb")
      .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
      .toBuffer()
    const file = `${dir}/${size.key}.jpg`
    writes.push(writeFileUnder(file, jpeg))
    files.push({
      bandId: size.key,
      sizes: [size.key],
      file,
      url: null,
      sha: createHash("sha256").update(jpeg).digest("hex").slice(0, 16),
      width: picture.width + 2 * bleed,
      height: picture.height + 2 * bleed,
      fit,
    })
  }
  await Promise.all(writes)
  return files
}

/** Pixel offset of line `line` (0 at the edge) and position `k` along it. */
function locate({ width, height }: Raw, side: Side) {
  const across = side === "top" || side === "bottom"
  const deep = across ? height : width
  return (line: number, k: number) => {
    const inner = side === "top" || side === "left" ? line : deep - 1 - line
    return across ? (inner * width + k) * 3 : (k * width + inner) * 3
  }
}

/**
 * How many lines along `side` are a rim the generator left around the
 * picture: a lighter or darker frame a few pixels deep, the outermost lines
 * whose average colour isn't that of the lines just inside. 0 for a clean edge.
 */
function rim(raw: Raw, side: Side): number {
  const across = side === "top" || side === "bottom"
  const length = across ? raw.width : raw.height
  const deep = across ? raw.height : raw.width
  const at = locate(raw, side)
  const step = Math.max(1, Math.floor(length / 700))
  const mean = (line: number) => {
    const sum = [0, 0, 0]
    let n = 0
    for (let k = 0; k < length; k += step) {
      const i = at(line, k)
      for (let c = 0; c < 3; c++) sum[c] += raw.data[i + c]
      n++
    }
    return sum.map((v) => v / n)
  }

  const cap = Math.floor(deep * RIM)
  const inside = [0, 0, 0]
  for (let line = cap; line < cap + RUN; line++) mean(line).forEach((v, c) => (inside[c] += v / RUN))
  for (let line = cap - 1; line >= 0; line--) {
    const [r, g, b] = mean(line)
    if (Math.hypot(r - inside[0], g - inside[1], b - inside[2]) > RIM_FAR) return line + 1
  }
  return 0
}

/** The poster with its `rim` cut off every side. */
function withoutRim(raw: Raw): Raw {
  const [top, bottom, left, right] = (["top", "bottom", "left", "right"] as const).map((side) => rim(raw, side))
  if (top + bottom + left + right === 0) return raw
  const width = raw.width - left - right
  const height = raw.height - top - bottom
  const data = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    const from = ((y + top) * raw.width + left) * 3
    raw.data.copy(data, y * width * 3, from, from + width * 3)
  }
  return { data, width, height }
}

/**
 * How deep the background along `side` goes, as a share of the poster's
 * extent that way: lines from the edge in whose pixels are nearly all the
 * edge's own colour. 0 for an edge the motif runs into.
 */
function calmDepth(raw: Raw, side: Side): number {
  const across = side === "top" || side === "bottom"
  const length = across ? raw.width : raw.height
  const deep = across ? raw.height : raw.width
  const at = locate(raw, side)
  const step = Math.max(1, Math.floor(length / 700))

  // The background colour: per channel median of a few lines just inside the edge.
  const counts = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
  let n = 0
  for (let line = 1; line < 5; line++) {
    for (let k = 0; k < length; k += step) {
      const i = at(line, k)
      for (let c = 0; c < 3; c++) counts[c][raw.data[i + c]]++
      n++
    }
  }
  const background = counts.map((h) => {
    let sum = 0
    for (let v = 0; v < 256; v++) if ((sum += h[v]) * 2 >= n) return v
    return 255
  })

  // Share of each line's pixels that aren't background; the motif starts
  // where a few lines in a row have more than a speck of it (paint texture
  // and grain stay below).
  const max = Math.floor(deep * 0.3)
  const busy = new Float64Array(max + RUN)
  for (let line = 0; line < max + RUN && line < deep; line++) {
    let off = 0
    let seen = 0
    for (let k = 0; k < length; k += step) {
      const i = at(line, k)
      const d =
        (raw.data[i] - background[0]) ** 2 +
        (raw.data[i + 1] - background[1]) ** 2 +
        (raw.data[i + 2] - background[2]) ** 2
      if (d > FAR * FAR) off++
      seen++
    }
    busy[line] = off / seen
  }
  for (let line = 0; line < max; line++) {
    let sum = 0
    for (let r = 0; r < RUN; r++) sum += busy[line + r]
    if (sum / RUN > 0.04) return line / deep >= MIN_DEPTH ? line / deep : 0
  }
  return max / deep
}

/** The poster fitted to width × height: what's cut, what's grown, and the picture. */
async function fitTo(raw: Raw, depths: Record<Side, number>, width: number, height: number) {
  const target = height / width
  const taller = raw.height / raw.width > target
  // Taller than the size: crop its height or grow its width; wider: the other way round.
  const [cutA, cutB]: Side[] = taller ? ["top", "bottom"] : ["left", "right"]
  const [growA, growB]: Side[] = taller ? ["left", "right"] : ["top", "bottom"]
  const length = taller ? raw.height : raw.width
  const excess = length - (taller ? raw.width * target : raw.height / target)

  let fromA = 0
  let fromB = 0
  let grow: Side[] = []
  if (excess <= length * EXACT) {
    fromA = Math.round(excess / 2)
    fromB = Math.round(excess) - fromA
  } else if (depths[growA] || depths[growB]) {
    // 1. Background on the other axis grows: the design keeps every pixel and its margins.
    grow = [growA, growB].filter((s) => depths[s] > 0)
  } else {
    // 2. Background on the cutting axis is cropped: that never touches the motif.
    const roomA = Math.floor(depths[cutA] * length * CROP_SHARE)
    const roomB = Math.floor(depths[cutB] * length * CROP_SHARE)
    const calm = Math.min(excess, roomA + roomB)
    fromA = roomA + roomB ? Math.round((calm * roomA) / (roomA + roomB)) : 0
    fromB = Math.round(calm) - fromA
    let left = excess - calm
    // 3. A poster busy on every side loses a sliver; the rest grows soft.
    if (left > length * EXACT) {
      const sliver = Math.min(left, length * SLIGHT)
      fromA += Math.round(sliver / 2)
      fromB += Math.round(sliver) - Math.round(sliver / 2)
      left -= sliver
      if (left > length * EXACT) grow = [growA, growB]
    }
  }

  const crop = taller
    ? { left: 0, top: fromA, width: raw.width, height: raw.height - fromA - fromB }
    : { left: fromA, top: 0, width: raw.width - fromA - fromB, height: raw.height }
  // The poster's size in the file; whatever is left over along the other axis grows.
  const pw = grow.length && taller ? Math.round((crop.width * height) / crop.height) : width
  const ph = grow.length && !taller ? Math.round((crop.height * width) / crop.width) : height
  const spare = taller ? width - pw : height - ph
  const total = grow.reduce((s, side) => s + depths[side], 0)
  const addA = !grow.includes(growA) ? 0 : grow.length === 1 ? spare : Math.round((spare * depths[growA]) / total) || Math.floor(spare / 2)
  const addB = spare - addA
  const fit: PrintFile["fit"] = spare > 0 ? "extend" : fromA + fromB > length * EXACT ? "crop" : "exact"

  const resized = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 3 } })
    .extract(crop)
    .resize(pw, ph, { kernel: "lanczos3", fit: "fill" })
    .raw()
    .toBuffer()
  const picture: Raw = { data: resized, width: pw, height: ph }
  const layers: OverlayOptions[] = [
    { input: resized, raw: { width: pw, height: ph, channels: 3 }, left: taller ? addA : 0, top: taller ? 0 : addA },
  ]
  for (const [side, size] of [
    [growA, addA],
    [growB, addB],
  ] as const) {
    if (size <= 0) continue
    const deep = taller ? pw : ph
    const block = await grownEdge(picture, side, size, Math.round(depths[side] * deep))
    layers.push({
      input: block.data,
      raw: { width: block.width, height: block.height, channels: 3 },
      left: side === "right" ? addA + pw : 0,
      top: side === "bottom" ? addA + ph : 0,
    })
  }

  const { data, info } = await sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite(layers)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.channels !== 3) throw new Error(`Fitted poster came out with ${info.channels} channels`)
  return { picture: { data, width, height } satisfies Raw, fit }
}

/**
 * `size` pixels grown off one side of the fitted poster. Line d (0 next to
 * the poster) mirrors the line d in from the edge, bouncing within the
 * background (`depth` px) so the motif is never reflected, and blends into a
 * blurred copy further out, all blur before it would bounce, so no texture
 * repeats visibly. A side without background (`depth` 0) is all blur: its
 * colours run on, soft.
 */
async function grownEdge(picture: Raw, side: Side, size: number, depth: number): Promise<Raw> {
  const across = side === "top" || side === "bottom"
  const length = across ? picture.width : picture.height
  const deep = across ? picture.height : picture.width
  const span = Math.max(4, Math.min(depth > 0 ? depth : size, deep))
  const at = locate(picture, side)
  const mirror = (d: number) => {
    const p = d % (2 * span)
    return p < span ? p : 2 * span - 1 - p
  }

  const [width, height] = across ? [length, size] : [size, length]
  // Band line for distance d: next to the poster is the band's inner edge.
  const out = (d: number, k: number) => {
    const line = side === "top" || side === "left" ? size - 1 - d : d
    return across ? (line * width + k) * 3 : (k * width + line) * 3
  }
  // Sheared as it goes out, so strokes near the edge don't come back as their mirror image.
  const along = (k: number) => {
    const p = ((k % (2 * length)) + 2 * length) % (2 * length)
    return p < length ? p : 2 * length - 1 - p
  }
  const band = Buffer.alloc(width * height * 3)
  for (let d = 0; d < size; d++) {
    const line = mirror(d)
    const shift = Math.round(d * 0.6)
    for (let k = 0; k < length; k++) {
      const from = at(line, along(k + shift))
      picture.data.copy(band, out(d, k), from, from + 3)
    }
  }

  // Blur at a quarter size and back: as soft, far cheaper.
  const sigma = Math.min(40, Math.max(3, length * (depth > 0 ? 0.004 : 0.01)))
  const small = { width: Math.max(1, Math.round(width / 4)), height: Math.max(1, Math.round(height / 4)) }
  const blurred = await sharp(band, { raw: { width, height, channels: 3 } })
    .resize(small.width, small.height, { kernel: "cubic", fit: "fill" })
    .blur(Math.max(0.3, sigma / 4))
    .resize(width, height, { kernel: "cubic", fit: "fill" })
    .raw()
    .toBuffer()

  // Sharp near the poster where it's background, softening from half its depth
  // on and all soft at its depth, where the mirror would come back round.
  const start = depth > 0 ? span / 2 : 0
  const end = Math.max(start + 1, depth > 0 ? span : 1)
  for (let d = 0; d < size; d++) {
    const t = Math.min(1, Math.max(0, (d - start) / (end - start)))
    const w = depth > 0 ? t * t * (3 - 2 * t) : 1
    if (w === 0) continue
    for (let k = 0; k < length; k++) {
      const i = out(d, k)
      for (let c = 0; c < 3; c++) band[i + c] = Math.round(band[i + c] * (1 - w) + blurred[i + c] * w)
    }
  }
  return { data: band, width, height }
}
