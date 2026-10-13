import sharp from "sharp"

import { refineArtwork } from "@/lib/mockups/locate"

import { CANVAS } from "./model"

// A poster measured in its pixels, for a rebuild to match exactly: drawn
// 1000 wide (the canvas, so a pixel is a unit), the paper's colour, the
// photo's frame to the pixel, and every mark on the paper around it: lines
// of text (each run of words with the box its ink fills, its colour),
// paragraphs set in columns, rules, colour swatches and small symbols. What
// each mark says and is set in is for Gemini to read; where it sits and how
// big it is comes from here, and the rebuild is measured the same way to be
// compared.

export type Box = { x0: number; y0: number; x1: number; y1: number }

/**
 * A line of body text: the box its ink fills, and its x-height band (where
 * its lower-case letters are, to a tenth of a pixel; `y1` is its baseline).
 * Lines of copy set close touch (one's descenders reach the next one's
 * ascenders), so their ink boxes lose those, while the band stays exact.
 */
export type Line = Box & { core?: { y0: number; y1: number } }

export type Mark = {
  id: number
  kind: "text" | "paragraph" | "rule" | "swatch" | "symbol"
  /** Where its ink is, in units of the 1000-wide canvas. */
  box: Box
  /** Its ink's colour. */
  color: string
  /** A paragraph's lines (their boxes and x-height bands), top to bottom, column by column. */
  lines?: Line[]
  /** A paragraph's columns (their boxes). */
  columns?: Box[]
  /** A line's or symbol's connected pieces of ink (letters, an outline around them), with their pixel counts. */
  parts?: (Box & { count: number })[]
}

export type Measured = {
  width: number
  height: number
  paper: string
  /** The photo's frame, if there's one. */
  photo: Box | null
  marks: Mark[]
}

type Img = { rgb: Uint8Array; width: number; height: number }

/** The poster at the canvas's width (1000 px), as raw RGB. */
export async function canvasPixels(image: Buffer): Promise<Img> {
  const { data, info } = await sharp(image).resize(CANVAS, null, { kernel: "lanczos3" }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { rgb: new Uint8Array(data), width: info.width, height: info.height }
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase()

/**
 * Measures a poster image (any size; it's drawn 1000 wide first). `photo`
 * is where Gemini sees the photo (canvas units), when it was asked: its
 * edges are then found in the pixels near it, unless the pixels' own
 * frame agrees with it (a pale sky, or paper shaded in a photo of the
 * poster, can mislead the pixels alone).
 */
export async function measurePoster(image: Buffer, photo?: Box | null): Promise<Measured> {
  return measurePixels(await canvasPixels(image), photo)
}

const iou = (a: Box, b: Box) => {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
  const inter = ix * iy
  const area = (r: Box) => (r.x1 - r.x0) * (r.y1 - r.y0)
  return inter / (area(a) + area(b) - inter)
}

/** A rough frame's edges found in the pixels (the strongest straight edge near each side). */
function refineFrame({ rgb, width: W, height: H }: Img, rough: Box): Box {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = rgb[i * 3]
    data[i * 4 + 1] = rgb[i * 3 + 1]
    data[i * 4 + 2] = rgb[i * 3 + 2]
    data[i * 4 + 3] = 255
  }
  const q = refineArtwork({ data, width: W, height: H }, [
    [rough.x0, rough.y0],
    [rough.x1, rough.y0],
    [rough.x1, rough.y1],
    [rough.x0, rough.y1],
  ])
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)))
  return { x0: clamp((q[0][0] + q[3][0]) / 2, W), y0: clamp((q[0][1] + q[1][1]) / 2, H), x1: clamp((q[1][0] + q[2][0]) / 2, W), y1: clamp((q[2][1] + q[3][1]) / 2, H) }
}

export function measurePixels(img: Img, hint?: Box | null): Measured {
  const { rgb, width: W, height: H } = img
  const paper = paperOf(img)
  const diff = (i: number) => Math.max(Math.abs(rgb[i * 3] - paper[0]), Math.abs(rgb[i * 3 + 1] - paper[1]), Math.abs(rgb[i * 3 + 2] - paper[2]))
  // Anything off the paper at all (a pale sky still counts), and ink proper.
  const off = new Uint8Array(W * H)
  const ink = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const d = diff(i)
    // Low on purpose: a pale sky only just off white paper is still the photo.
    if (d > 6) off[i] = 1
    if (d > 48) ink[i] = 1
  }
  const own = photoOf(off, W, H)
  const photo = hint ? (own && iou(own, hint) > 0.92 ? own : refineFrame(img, hint)) : own
  // The photo, and the blended pixels along its edges.
  if (photo) for (let y = Math.max(0, photo.y0 - 2); y < Math.min(H, photo.y1 + 2); y++) for (let x = Math.max(0, photo.x0 - 2); x < Math.min(W, photo.x1 + 2); x++) ink[y * W + x] = 0
  const blobs = components(ink, W, H).filter((b) => b.count >= 3)
  const marks = group(blobs, img, ink).map((m, id) => ({ ...m, id: id + 1 }))
  return { width: W, height: H, paper: hex(paper[0], paper[1], paper[2]), photo, marks }
}

/** The paper's colour: the commonest colour of the outer ring. */
function paperOf({ rgb, width: W, height: H }: Img): [number, number, number] {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>()
  const ring = Math.max(4, Math.round(Math.min(W, H) * 0.02))
  const take = (x: number, y: number) => {
    const i = (y * W + x) * 3
    const key = ((rgb[i] >> 3) << 10) | ((rgb[i + 1] >> 3) << 5) | (rgb[i + 2] >> 3)
    const c = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    c.n++
    c.r += rgb[i]
    c.g += rgb[i + 1]
    c.b += rgb[i + 2]
    counts.set(key, c)
  }
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (x < ring || y < ring || x >= W - ring || y >= H - ring) take(x, y)
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0]
  return best ? [best.r / best.n, best.g / best.n, best.b / best.n] : [255, 255, 255]
}

/**
 * The photo's frame: the band of rows that are mostly off the paper, then
 * of columns within it; a rectangle at least a fifth of the poster. Its
 * edges are the first and last such rows and columns, so a pale sky at the
 * top still belongs to it.
 */
function photoOf(off: Uint8Array, W: number, H: number): Box | null {
  const rowShare = (y: number, x0: number, x1: number) => {
    let n = 0
    for (let x = x0; x < x1; x++) n += off[y * W + x]
    return n / Math.max(1, x1 - x0)
  }
  const colShare = (x: number, y0: number, y1: number) => {
    let n = 0
    for (let y = y0; y < y1; y++) n += off[y * W + x]
    return n / Math.max(1, y1 - y0)
  }
  // The longest run of rows mostly off the paper.
  const run = (n: number, share: (k: number) => number, limit: number) => {
    let best = { start: 0, end: 0 }
    let start = -1
    for (let k = 0; k <= n; k++) {
      const on = k < n && share(k) >= limit
      if (on && start < 0) start = k
      if (!on && start >= 0) {
        if (k - start > best.end - best.start) best = { start, end: k }
        start = -1
      }
    }
    return best
  }
  const rows = run(H, (y) => rowShare(y, 0, W), 0.45)
  if (rows.end - rows.start < H * 0.15) return null
  const cols = run(W, (x) => colShare(x, rows.start, rows.end), 0.8)
  if (cols.end - cols.start < W * 0.2) return null
  // Rows again within the photo's columns: a margin's text beside it no longer counts.
  const exact = run(H, (y) => rowShare(y, cols.start, cols.end), 0.45)
  const box = { x0: cols.start, y0: exact.end - exact.start > H * 0.15 ? exact.start : rows.start, x1: cols.end, y1: exact.end - exact.start > H * 0.15 ? exact.end : rows.end }
  bridge(box, rowShare, colShare, W, H)
  if ((box.x1 - box.x0) * (box.y1 - box.y0) < W * H * 0.2) return null
  return box
}

/**
 * A pale band across a photo (haze over a skyline, a white sky above it)
 * splits it in two: rows above or below the photo, past rows that aren't
 * clean paper (the haze, a spire in it), standing between the photo's own
 * left and right edges, are the rest of it. 13 Oct: a black and white New
 * York lost its sky, and the Empire State's spire was read as a letter.
 */
function bridge(box: Box, rowShare: (y: number, x0: number, x1: number) => number, colShare: (x: number, y0: number, y1: number) => number, W: number, H: number) {
  const within = (y: number) => rowShare(y, box.x0, box.x1)
  // The band's edges are the photo's: inside them off the paper, just outside them paper.
  const sameEdges = (y0: number, y1: number) =>
    colShare(Math.min(W - 1, box.x0 + 2), y0, y1) > 0.8 &&
    colShare(Math.max(0, box.x1 - 3), y0, y1) > 0.8 &&
    (box.x0 < 3 || colShare(box.x0 - 3, y0, y1) < 0.2) &&
    (box.x1 > W - 4 || colShare(box.x1 + 2, y0, y1) < 0.2)
  for (const dir of [-1, 1]) {
    let y = dir < 0 ? box.y0 - 1 : box.y1
    let gap = 0
    while (y >= 0 && y < H && within(y) < 0.45 && within(y) >= 0.01 && gap < H * 0.2) {
      y += dir
      gap++
    }
    if (!gap || y < 0 || y >= H || within(y) < 0.45) continue
    let end = y
    while (end >= 0 && end < H && within(end) >= 0.45) end += dir
    const [b0, b1] = dir < 0 ? [end + 1, y + 1] : [y, end]
    if (b1 - b0 < H * 0.03 || !sameEdges(b0, b1)) continue
    if (dir < 0) box.y0 = b0
    else box.y1 = b1
  }
}

type Blob = Box & { count: number; r: number; g: number; b: number }

/** Connected runs of ink (8-neighbours): letters, rules, swatches, parts of symbols. */
function components(ink: Uint8Array, W: number, H: number): Blob[] {
  const seen = new Uint8Array(W * H)
  const blobs: Blob[] = []
  const stack: number[] = []
  for (let start = 0; start < W * H; start++) {
    if (!ink[start] || seen[start]) continue
    const blob: Blob = { x0: W, y0: H, x1: 0, y1: 0, count: 0, r: 0, g: 0, b: 0 }
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      const x = i % W
      const y = (i - x) / W
      blob.count++
      if (x < blob.x0) blob.x0 = x
      if (y < blob.y0) blob.y0 = y
      if (x + 1 > blob.x1) blob.x1 = x + 1
      if (y + 1 > blob.y1) blob.y1 = y + 1
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= H) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= W) continue
          const j = ny * W + nx
          if (ink[j] && !seen[j]) {
            seen[j] = 1
            stack.push(j)
          }
        }
      }
    }
    blobs.push(blob)
  }
  return blobs
}

/**
 * A solid block as swatches: one, or a strip of colours side by side (a
 * flag of a poster's palette) split where the colour changes along it;
 * null when it isn't even inside (a word of small type run together).
 */
function swatchesIn(img: Img, b: Box): Omit<Mark, "id">[] | null {
  const across = b.x1 - b.x0 >= b.y1 - b.y0
  const length = across ? b.x1 - b.x0 : b.y1 - b.y0
  // Each slice's colour, from the block's middle third (clear of its blended edges).
  const third = Math.max(1, Math.floor((across ? b.y1 - b.y0 : b.x1 - b.x0) / 3))
  const slices: number[][] = []
  for (let k = 0; k < length; k++) {
    let r = 0, g = 0, bl = 0, n = 0
    for (let t = third; t < (across ? b.y1 - b.y0 : b.x1 - b.x0) - third; t++) {
      const x = across ? b.x0 + k : b.x0 + t
      const y = across ? b.y0 + t : b.y0 + k
      const i = (y * img.width + x) * 3
      r += img.rgb[i]
      g += img.rgb[i + 1]
      bl += img.rgb[i + 2]
      n++
    }
    slices.push([r / n, g / n, bl / n])
  }
  const far = (a: number[], c: number[]) => Math.max(Math.abs(a[0] - c[0]), Math.abs(a[1] - c[1]), Math.abs(a[2] - c[2])) > 40
  const parts: [number, number][] = []
  let start = 0
  for (let k = 1; k < length; k++) {
    // A new colour where this slice and the next both differ from the part so far (a blended slice between them aside).
    if (far(slices[k], slices[start + ((k - start) >> 1)]) && (k + 1 >= length || far(slices[k + 1], slices[start + ((k - start) >> 1)]))) {
      parts.push([start, k])
      start = k
    }
  }
  parts.push([start, length])
  const solid = parts.filter(([a, c]) => c - a >= 4)
  // Even inside: every part's middle within a few shades of its own colour.
  const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
  for (const [a, c] of solid) {
    const inner = slices.slice(a + 1, c - 1).map(lum)
    if (inner.length < 2) continue
    const mean = inner.reduce((sum, v) => sum + v, 0) / inner.length
    if (Math.sqrt(inner.reduce((sum, v) => sum + (v - mean) ** 2, 0) / inner.length) > 10) return null
  }
  // Blocks from end to end: a letter's uprights with its diagonal between them (an N) aren't.
  if (solid.reduce((sum, [a, c]) => sum + c - a, 0) < length * 0.85) return null
  if (solid.length < 2) return [{ kind: "swatch", box: b, color: colorOf(slices, 0, length) }]
  return solid.map(([a, c]) => ({
    kind: "swatch" as const,
    box: across ? { x0: b.x0 + a, y0: b.y0, x1: b.x0 + c, y1: b.y1 } : { x0: b.x0, y0: b.y0 + a, x1: b.x1, y1: b.y0 + c },
    color: colorOf(slices, a + 1, c - 1),
  }))
}

/** The mean colour of slices a to c (their middle, clear of the blends at their ends). */
function colorOf(slices: number[][], a: number, c: number) {
  const part = slices.slice(Math.min(a, c - 1), Math.max(a + 1, c))
  const mean = (k: number) => part.reduce((s, p) => s + p[k], 0) / part.length
  return hex(mean(0), mean(1), mean(2))
}

/** The colour of a box's darkest (most inked) pixels: the ink, not the paper between letters. */
function inkColor({ rgb, width: W }: Img, box: Box, paper: string) {
  const pr = parseInt(paper.slice(1, 3), 16)
  const pg = parseInt(paper.slice(3, 5), 16)
  const pb = parseInt(paper.slice(5, 7), 16)
  const pixels: [number, number, number, number][] = []
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = (y * W + x) * 3
      const d = Math.max(Math.abs(rgb[i] - pr), Math.abs(rgb[i + 1] - pg), Math.abs(rgb[i + 2] - pb))
      pixels.push([d, rgb[i], rgb[i + 1], rgb[i + 2]])
    }
  }
  // The darkest few: small type's edges are greyed by smoothing, its true colour is in its cores.
  pixels.sort((a, b) => b[0] - a[0])
  const top = pixels.slice(0, Math.max(1, Math.floor(pixels.length * 0.05)))
  const avg = (k: number) => top.reduce((s, p) => s + p[k], 0) / top.length
  return hex(avg(1), avg(2), avg(3))
}

/**
 * The lines of a column of body text, from its ink row by row: lines are
 * the runs of rows well inked, apart where the ink thins out between them
 * (a few touching letters don't bridge that), each as wide as its ink.
 */
function linesIn(ink: Uint8Array, W: number, col: Box, img: Img, paper: number[]): Line[] {
  const profile: number[] = []
  for (let y = col.y0; y < col.y1; y++) {
    let n = 0
    for (let x = col.x0; x < col.x1; x++) n += ink[y * W + x]
    profile.push(n)
  }
  const sorted = [...profile].sort((a, b) => a - b)
  const peak = sorted[Math.floor(sorted.length * 0.9)] ?? 0
  const floor = Math.max(1, peak * 0.1)
  const runs: [number, number][] = []
  let start = -1
  for (let i = 0; i <= profile.length; i++) {
    const on = i < profile.length && profile[i] > floor
    if (on && start < 0) start = i
    if (!on && start >= 0) {
      if (i - start >= 3) runs.push([start, i])
      start = -1
    }
  }
  // Two lines whose descenders and ascenders touch run on as one, twice as tall: split where their ink is thinnest.
  const heights = runs.map(([a, b]) => b - a).sort((a, b) => a - b)
  const typical = heights[heights.length >> 1] ?? 0
  const split: [number, number][] = []
  for (const [a, b] of runs) {
    const n = typical ? Math.round((b - a) / typical) : 1
    if (n < 2 || b - a < typical * 1.6) {
      split.push([a, b])
      continue
    }
    let from = a
    for (let k = 1; k < n; k++) {
      const expected = a + ((b - a) * k) / n
      const reach = (b - a) / n / 3
      let cut = Math.round(expected)
      for (let y = Math.max(from + 2, Math.round(expected - reach)); y <= Math.min(b - 2, Math.round(expected + reach)); y++) if (profile[y] < profile[cut]) cut = y
      split.push([from, cut])
      from = cut + 1
    }
    split.push([from, b])
  }
  const lines: Line[] = []
  for (const [a, b] of split) {
    const y0 = col.y0 + a
    const y1 = col.y0 + b
    let x0 = col.x1
    let x1 = col.x0
    for (let y = y0; y < y1; y++) {
      for (let x = col.x0; x < col.x1; x++) {
        if (!ink[y * W + x]) continue
        if (x < x0) x0 = x
        if (x + 1 > x1) x1 = x + 1
      }
    }
    if (x1 > x0) lines.push({ x0, y0, x1, y1, ...coreOf(img, paper, { x0, y0, x1, y1 }) })
  }
  return lines
}

/**
 * A line's x-height band from its grey ink, row by row: the rows of its
 * lower-case letters carry most of it, ascenders and descenders far less;
 * the band's edges are where a row's ink falls to half of theirs, between
 * rows by how far.
 */
function coreOf({ rgb, width: W, height: H }: Img, paper: number[], line: Box): { core?: { y0: number; y1: number } } {
  const paperLum = 0.299 * paper[0] + 0.587 * paper[1] + 0.114 * paper[2]
  const from = Math.max(0, line.y0 - 3)
  const to = Math.min(H, line.y1 + 3)
  const profile: number[] = []
  for (let y = from; y < to; y++) {
    let sum = 0
    for (let x = line.x0; x < line.x1; x++) {
      const i = (y * W + x) * 3
      sum += Math.max(0, paperLum - (0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2]))
    }
    profile.push(sum)
  }
  const top = [...profile].sort((a, b) => b - a).slice(0, 3)
  if (top.length < 3) return {}
  const level = (top[0] + top[1] + top[2]) / 3
  const half = level / 2
  const peak = profile.indexOf(top[0])
  let a = peak
  while (a > 0 && profile[a - 1] >= half) a--
  let b = peak
  while (b < profile.length - 1 && profile[b + 1] >= half) b++
  if (a === 0 || b === profile.length - 1) return {}
  // Row k covers k to k + 1: its centre is k + 0.5; the edge lies between the centres by how far half is.
  const up = a - 1 + 0.5 + (half - profile[a - 1]) / Math.max(1e-6, profile[a] - profile[a - 1])
  const down = b + 0.5 + (profile[b] - half) / Math.max(1e-6, profile[b] - profile[b + 1])
  const y0 = Math.round((from + up) * 100) / 100
  const y1 = Math.round((from + down) * 100) / 100
  return y1 - y0 >= 2 ? { core: { y0, y1 } } : {}
}

/** A block's columns: its runs split where a gap of white runs down the whole block (at least 8 units wide). */
function splitColumns(runs: (Box & { parts?: Box[] })[], box: Box): Box[] {
  const width = box.x1 - box.x0
  const covered = new Uint8Array(width)
  // By the letters, not the runs: a run may have bridged a narrow column gap.
  for (const r of runs) for (const p of r.parts ?? [r]) for (let x = p.x0; x < p.x1; x++) covered[x - box.x0] = 1
  const cols: Box[] = []
  let start = -1
  let gap = 0
  for (let x = 0; x <= width; x++) {
    const on = x < width && covered[x]
    if (on) {
      if (start < 0) start = x
      gap = 0
    } else if (start >= 0) {
      gap++
      if (gap >= 8 || x === width) {
        const end = x - gap + 1
        const inside = runs.flatMap((r) => r.parts ?? [r]).filter((p) => p.x0 - box.x0 >= start && p.x1 - box.x0 <= end)
        if (inside.length) cols.push(inside.reduce<Box>((a, b) => union(a, b), inside[0]))
        start = -1
        gap = 0
      }
    }
  }
  return cols.length ? cols : [box]
}

const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })

/**
 * Marks from the blobs: rules and swatches first (a blob that fills its own
 * box), then letters joined into runs along a line (close in height and
 * position: a gap wider than about a letter's height ends a run), runs
 * stacked at an even pitch with a shared edge into paragraphs, and
 * paragraphs side by side into columns. Whatever's left is a symbol.
 */
function group(blobs: Blob[], img: Img, ink: Uint8Array): Omit<Mark, "id">[] {
  const paperHex = hex(...paperOf(img))
  const out: Omit<Mark, "id">[] = []
  const rest: Blob[] = []
  for (const b of blobs) {
    const w = b.x1 - b.x0
    const h = b.y1 - b.y0
    const fill = b.count / (w * h)
    if (h <= 5 && w >= 40 && fill > 0.6) out.push({ kind: "rule", box: b, color: inkColor(img, b, paperHex) })
    else if (w <= 5 && h >= 40 && fill > 0.6) out.push({ kind: "rule", box: b, color: inkColor(img, b, paperHex) })
    // A block of colour (or a strip of them): solid but for its blended edges, even inside, not a letter's upright (an l, an I).
    else if (w >= 8 && h >= 4 && w * h >= 60 && h <= w * 2.5 && fill > 0.8) {
      const swatches = swatchesIn(img, b)
      if (swatches) out.push(...swatches)
      else rest.push(b)
    } else rest.push(b)
  }
  // Letters into runs along their line. A letter joins a run by the run's core, the band its
  // letters' middles share, not its whole height: else a descender reaching into the next line
  // of tight body text pulled that line in too (13 Oct).
  rest.sort((a, b) => a.x0 - b.x0)
  const runs: (Box & { parts: Blob[]; mids: number[]; heights: number[] })[] = []
  const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1]
  for (const b of rest) {
    const h = b.y1 - b.y0
    const mid = (b.y0 + b.y1) / 2
    const into = runs.find((r) => {
      const core = median(r.mids)
      const ch = median(r.heights)
      const gap = b.x0 - r.x1
      // Same line: its middle near the run's core (a dot or comma, or an ascender, still lands near it).
      const onLine = Math.abs(mid - core) <= Math.max(ch, h) * 0.55 || (h < ch * 0.5 && b.y0 >= r.y0 - 1 && b.y1 <= r.y1 + 1)
      // A word space is under a letter's height; columns and separate texts on a line are far wider apart.
      return onLine && gap < Math.max(ch, h, 6) * 1.8 && gap > -Math.max(ch, h)
    })
    if (into) {
      into.parts.push(b)
      into.mids.push(mid)
      into.heights.push(h)
      Object.assign(into, union(into, b))
    } else runs.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, parts: [b], mids: [mid], heights: [h] })
  }
  // Specks too small to read on their own (a stray dot) don't make a mark.
  const solid = runs.filter((r) => r.parts.reduce((s, p) => s + p.count, 0) >= 12 || r.x1 - r.x0 >= 6)
  // Rows: runs side by side on one line (overlapping heights), top to bottom.
  solid.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  const rows: { runs: (Box & { parts: Blob[] })[]; box: Box; h: number }[] = []
  for (const r of solid) {
    const h = r.y1 - r.y0
    const row = rows.find((w) => Math.min(w.box.y1, r.y1) - Math.max(w.box.y0, r.y0) > Math.min(w.h, h) * 0.5 && Math.abs(w.h - h) <= Math.max(4, Math.max(w.h, h) * 0.5))
    if (row) {
      row.runs.push(r)
      row.box = union(row.box, r)
    } else rows.push({ runs: [r], box: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }, h })
  }
  rows.sort((a, b) => a.box.y0 - b.box.y0)
  // Blocks of body text: rows of small type stacked close, overlapping across. Rows of tight
  // text can come out two lines tall (letters of two lines touching), so heights may differ.
  const small = rows.map((r, k) => ({ r, k })).filter(({ r }) => r.h <= 48)
  const typicalH = small.length ? [...small.map(({ r }) => r.h)].sort((a, b) => a - b)[small.length >> 1] : 12
  const inBlock = new Set<number>()
  const chains: number[][] = []
  for (let i = 0; i < small.length; i++) {
    if (inBlock.has(small[i].k)) continue
    const chain = [small[i].k]
    for (let j = i + 1; j < small.length; j++) {
      const last = rows[chain[chain.length - 1]]
      const c = small[j].r
      if (c.box.y0 - last.box.y1 > Math.max(6, typicalH * 0.9)) break
      const across = Math.min(c.box.x1, last.box.x1) - Math.max(c.box.x0, last.box.x0)
      if (across < Math.min(c.box.x1 - c.box.x0, last.box.x1 - last.box.x0) * 0.3) continue
      chain.push(small[j].k)
    }
    const tall = rows[chain[chain.length - 1]].box.y1 - rows[chain[0]].box.y0
    if (chain.length >= 3 || (chain.length >= 2 && tall >= typicalH * 3)) {
      chain.forEach((k) => inBlock.add(k))
      chains.push(chain)
    }
  }
  // Blocks one under the other with only a line's space between them are one paragraph.
  const blocks: { rows: number[]; box: Box }[] = []
  for (const chain of chains) {
    const box = chain.map((k) => rows[k].box).reduce((a, b) => union(a, b))
    const above = blocks.find((b) => box.y0 - b.box.y1 <= typicalH * 1.6 && box.y0 >= b.box.y0 && Math.min(b.box.x1, box.x1) - Math.max(b.box.x0, box.x0) > Math.min(b.box.x1 - b.box.x0, box.x1 - box.x0) * 0.5)
    if (above) {
      above.rows.push(...chain)
      above.box = union(above.box, box)
    } else blocks.push({ rows: [...chain], box })
  }
  // Each block made exact from its columns' ink, row by row: lines of body text above or below
  // it join (two touching lines no longer slip out), a taller line (a title) at its edge leaves it.
  const paragraphs: { box: Box; lines: Box[]; columns: Box[] }[] = []
  for (const block of blocks) {
    const runsIn = block.rows.flatMap((k) => rows[k].runs)
    const rough = splitColumns(runsIn, block.box)
    const reach = Math.round(typicalH * 3)
    const columns: Box[] = []
    const lines: Box[] = []
    for (const c of rough) {
      const window = { x0: c.x0, y0: Math.max(0, c.y0 - reach), x1: c.x1, y1: Math.min(img.height, c.y1 + reach) }
      const found = linesIn(ink, img.width, window, img, paperOf(img))
      const heights = found.map((l) => l.y1 - l.y0).sort((a, b) => a - b)
      const mh = heights[heights.length >> 1] ?? typicalH
      const tops = found.map((l) => l.y0)
      const pitches = tops.slice(1).map((t, i) => t - tops[i]).sort((a, b) => a - b)
      const pitch = pitches[pitches.length >> 1] ?? mh * 1.3
      // From the lines inside the rough block, out while they're body text at the block's pitch.
      const core = found.map((l, i) => ({ l, i })).filter(({ l }) => l.y1 > c.y0 && l.y0 < c.y1 && l.y1 - l.y0 <= mh * 1.5)
      if (!core.length) continue
      let first = core[0].i
      let last = core[core.length - 1].i
      const fits = (l: Box) => l.y1 - l.y0 <= mh * 1.5 && l.y1 - l.y0 >= mh * 0.4
      while (first > 0 && fits(found[first - 1]) && found[first].y0 - found[first - 1].y0 <= pitch * 1.6) first--
      while (last < found.length - 1 && fits(found[last + 1]) && found[last + 1].y0 - found[last].y0 <= pitch * 1.6) last++
      const kept = found.slice(first, last + 1).filter(fits)
      if (!kept.length) continue
      lines.push(...kept)
      columns.push(kept.reduce((a, b) => union(a, b)))
    }
    if (!columns.length) continue
    paragraphs.push({ box: columns.reduce((a, b) => union(a, b)), lines, columns })
  }
  const insideParagraph = (b: Box) => paragraphs.some((p) => (b.x0 + b.x1) / 2 >= p.box.x0 && (b.x0 + b.x1) / 2 <= p.box.x1 && (b.y0 + b.y1) / 2 >= p.box.y0 - 1 && (b.y0 + b.y1) / 2 <= p.box.y1 + 1)
  for (const p of paragraphs) out.push({ kind: "paragraph", box: p.box, color: inkColor(img, p.box, paperHex), lines: p.lines, columns: p.columns })
  for (const row of rows) {
    for (const run of row.runs) {
      if (insideParagraph(run)) continue
      const w = run.x1 - run.x0
      const h = run.y1 - run.y0
      // A lone shape about as wide as tall, not a word: a symbol.
      const kind = w <= h * 1.6 && h >= 10 && h <= 80 ? "symbol" : "text"
      out.push({ kind, box: { x0: run.x0, y0: run.y0, x1: run.x1, y1: run.y1 }, color: inkColor(img, run, paperHex), parts: run.parts.map((p) => ({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, count: p.count })) })
    }
  }
  return out.sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0)
}
