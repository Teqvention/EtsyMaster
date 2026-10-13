import type { Pixels } from "./sheet"
import type { Point, Quad } from "./types"

// Exact sheets in a blank mockup, from Gemini's rough boxes: every sheet's
// four edges and what stands in front of it. Pure and synchronous, so it
// runs anywhere sharp has decoded the room.
//
// Edges: rays run from the middle of a sheet's box outward, in every row
// (left and right side) and column (top and bottom) of it, to the first
// pixel that is no longer paper (much darker, or another colour: wood, gold,
// a black or coloured frame). Hits inside the boxes of things in front (a
// hand, books, a lamp) are dropped, so they can't pull an edge in. A robust
// line through each side's hits (RANSAC, up to 35° off the axis, for frames
// leaning or held at an angle) gives the edge, the edges' crossings the
// corners, also where a corner itself is hidden. A second pass searches
// again across each edge as found, for the exact line in perspective. A
// side without a clear edge keeps the box's.
//
// In front: within a sheet, inside the box of each thing Gemini saw in front
// of it, paper is filled in from the visible paper around it as long as no
// edge stops it; what the paper can't reach is the thing. Shadows and light
// on the paper are reached (soft) and stay paper.

/** A box Gemini drew: x0, y0, x1, y1. */
export type Box = [number, number, number, number]

export type Located = {
  /** One per sheet, in the order given; null where no sheet could be made out. */
  quads: Quad[]
  /** Room-sized mask (0–255) of what stands in front of a sheet, or null when nothing does. */
  front: Uint8Array | null
  /** The boxes of what's in front: Gemini's and those the original showed. */
  occluders: Box[]
}

export function boxOf(quad: Quad): Box {
  const xs = quad.map((p) => p[0])
  const ys = quad.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/**
 * The sheets' exact quads (in the order of `sheets`) and the mask of what's
 * in front of them. `original`, the photo the blank was painted from at the
 * room's size, helps where it's there: what the blanking left as it was and
 * isn't paper stands in front of a sheet (also where Gemini missed it), and
 * paper where the photo showed the design is paper for sure.
 */
export function locate(room: Pixels, sheets: Box[], occluders: Box[] = [], original?: Pixels): Located {
  const img = new Room(room, original)
  // Something in front of a sheet, not the sheet itself (a frame in front of others is both).
  const before = (box: Box, all: Box[]) => all.filter((o) => containment(box, o) < 0.6)
  let quads = sheets.map((box) => sheetQuad(img, box, before(box, occluders)))
  // What the original shows in front of a sheet as found, then the sheets found again around it.
  const more = quads.flatMap((quad, i) => unchangedThings(img, quad, before(sheets[i], occluders)))
  if (more.length) {
    occluders = [...occluders, ...more]
    quads = sheets.map((box) => sheetQuad(img, box, before(box, occluders)))
  }
  let front = frontMask(img, quads, sheets, occluders)
  if (front) {
    // Again, now that it's known exactly what's in front: only hits on it are dropped, not
    // all of its box (books along a whole edge leave the frame showing between them).
    const mask = front
    const hidden = (p: Point) => {
      const x = Math.round(p[0])
      const y = Math.round(p[1])
      for (let dy = -3; dy <= 3; dy += 3)
        for (let dx = -3; dx <= 3; dx += 3) if (img.inside(x + dx, y + dy) && mask[(y + dy) * img.w + x + dx] > 0) return true
      return false
    }
    quads = sheets.map((box) => sheetQuad(img, box, before(box, occluders), hidden))
    front = frontMask(img, quads, sheets, occluders)
  }
  return { quads, front, occluders }
}

// --- Pixels ---

class Room {
  readonly w: number
  readonly h: number
  private readonly data: Uint8ClampedArray
  private readonly photo: Uint8ClampedArray | null
  constructor({ data, width, height }: Pixels, original?: Pixels) {
    this.data = data
    this.w = width
    this.h = height
    this.photo = original && original.width === width && original.height === height ? original.data : null
  }
  get hasOriginal() {
    return !!this.photo
  }
  /** How far the original is from the blank here (0–255, largest channel, 3×3 means): 0 where blanking left it. */
  change(x: number, y: number) {
    if (!this.photo) return 0
    let worst = 0
    for (let c = 0; c < 3; c++) {
      let a = 0
      let b = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const i = this.at(x + dx, y + dy) + c
          a += this.data[i]
          b += this.photo[i]
        }
      worst = Math.max(worst, Math.abs(a - b) / 9)
    }
    return worst
  }
  private at(x: number, y: number) {
    const xi = Math.min(this.w - 1, Math.max(0, Math.round(x)))
    const yi = Math.min(this.h - 1, Math.max(0, Math.round(y)))
    return (yi * this.w + xi) * 4
  }
  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h
  }
  luma(x: number, y: number) {
    const i = this.at(x, y)
    const d = this.data
    return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  }
  /** Colour apart from brightness: red–green and yellow–blue, as shares of the sum. */
  chroma(x: number, y: number): [number, number] {
    const i = this.at(x, y)
    const d = this.data
    const s = d[i] + d[i + 1] + d[i + 2] + 3
    return [(d[i] - d[i + 1]) / s, (d[i] + d[i + 1] - 2 * d[i + 2]) / 2 / s]
  }
}

/** What a sheet's paper looks like: its brightness and colour, and how far the colour may stray. */
type Paper = { luma: number; cr: number; cb: number; tol: number }

function paperOf(img: Room, box: Box, skip: Box[]): Paper | null {
  const [x0, y0, x1, y1] = box
  const w = x1 - x0
  const h = y1 - y0
  const lumas: number[] = []
  const crs: number[] = []
  const cbs: number[] = []
  const step = Math.max(2, Math.round(Math.min(w, h) / 60))
  for (let y = y0 + h * 0.2; y < y1 - h * 0.2; y += step)
    for (let x = x0 + w * 0.2; x < x1 - w * 0.2; x += step) {
      if (skip.some((b) => inBox(b, x, y))) continue
      lumas.push(img.luma(x, y))
      const [cr, cb] = img.chroma(x, y)
      crs.push(cr)
      cbs.push(cb)
    }
  if (lumas.length < 20) return null
  const luma = median(lumas)
  const cr = median(crs)
  const cb = median(cbs)
  const spread = median(crs.map((v, i) => Math.max(Math.abs(v - cr), Math.abs(cbs[i] - cb))))
  return { luma, cr, cb, tol: Math.max(0.03, 4 * spread) }
}

function isPaper(img: Room, paper: Paper, x: number, y: number) {
  if (img.luma(x, y) < paper.luma * 0.45) return false
  const [cr, cb] = img.chroma(x, y)
  return Math.abs(cr - paper.cr) <= paper.tol && Math.abs(cb - paper.cb) <= paper.tol
}

/** The original differs from the blank by this much (0–255) where the design was. */
const CHANGED = 40
/** …and by less than this where blanking left the photo as it was. */
const UNCHANGED = 16

/**
 * Things in front of a sheet the original shows: within the sheet, pixels
 * the blanking left as they were and that are plainly no paper (dark, or of
 * another colour; not a shadow, not a mat), in pieces big enough to be an
 * object and reaching the sheet's edge, as a hand, a lamp or a plant does.
 */
function unchangedThings(img: Room, quad: Quad, known: Box[]): Box[] {
  if (!img.hasOriginal) return []
  const box = boxOf(quad)
  const paper = paperOf(img, box, known)
  if (!paper) return []
  // Clear of the edge by 2 %: a pixel or two of frame inside it is no object.
  const inner = shrink(quad, 0.02)
  const rim = shrink(quad, 0.05)
  const [x0, y0, x1, y1] = box
  const bw = x1 - x0
  const bh = y1 - y0
  const step = Math.max(2, Math.round(Math.min(bw, bh) / 200))
  const gw = Math.floor(bw / step)
  const gh = Math.floor(bh / step)
  if (gw < 8 || gh < 8) return []
  const grid = new Uint8Array(gw * gh)
  const plainlyNot = (x: number, y: number) => {
    if (img.luma(x, y) < paper.luma * 0.35) return true
    const [cr, cb] = img.chroma(x, y)
    return Math.abs(cr - paper.cr) > 2 * paper.tol || Math.abs(cb - paper.cb) > 2 * paper.tol
  }
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      const x = x0 + i * step
      const y = y0 + j * step
      if (!inQuad(inner, x, y) || known.some((b) => inBox(b, x, y))) continue
      if (img.change(x, y) < UNCHANGED && plainlyNot(x, y)) grid[j * gw + i] = 1
    }
  const things: Box[] = []
  for (const piece of pieces(dilate(erode(grid, gw, gh), gw, gh), gw, gh)) {
    const [i0, j0, i1, j1] = piece.box
    const w = (i1 - i0 + 1) / gw
    const h = (j1 - j0 + 1) / gh
    if (Math.min(w, h) < 0.05 || piece.size < gw * gh * 0.005) continue
    const atEdge = piece.cells.some((c) => !inQuad(rim, x0 + (c % gw) * step, y0 + Math.floor(c / gw) * step))
    if (!atEdge) continue
    const pad = 0.01 * Math.max(bw, bh)
    things.push([x0 + i0 * step - pad, y0 + j0 * step - pad, x0 + (i1 + 1) * step + pad, y0 + (j1 + 1) * step + pad])
  }
  return things
}

/** The quad pulled towards its centre by `by` of its size. */
function shrink(quad: Quad, by: number): Quad {
  const [cx, cy] = centroid(quad)
  return quad.map(([x, y]) => [cx + (x - cx) * (1 - 2 * by), cy + (y - cy) * (1 - 2 * by)]) as Quad
}

// --- Edges ---

type Side = "left" | "right" | "top" | "bottom"
const SIDES: Side[] = ["left", "right", "top", "bottom"]
const vertical = (side: Side) => side === "left" || side === "right"

/** A side as a line: x = a·y + b for left and right, y = a·x + b for top and bottom. */
type Line = { a: number; b: number }

/** Largest slope an edge may have against its axis (35°): frames leaning, tilted or held. */
const MAX_SLOPE = 0.7

/**
 * A sheet's quad within its box. Hits on what's in front don't count: those
 * in its boxes, or, once it's been made out, on it (`hidden`).
 */
function sheetQuad(img: Room, box: Box, occluders: Box[], hidden?: (p: Point) => boolean): Quad {
  const fallback = quadOf(box)
  const paper = paperOf(img, box, occluders)
  if (!paper) return fallback
  const [x0, y0, x1, y1] = box
  const bw = x1 - x0
  const bh = y1 - y0
  if (bw < 12 || bh < 12) return fallback
  const blocked = hidden ?? ((p: Point) => occluders.some((o) => inBox(grown(o, 4), p[0], p[1])))

  // First pass: rays from the box's middle out past each side.
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const lines = {} as Record<Side, Line | null>
  for (const side of SIDES) {
    const across = vertical(side) ? bh : bw
    const reach = (vertical(side) ? bw : bh) * 0.57
    const hits: Point[] = []
    const n = Math.min(400, Math.max(40, Math.round(across / 3)))
    for (let k = 0; k < n; k++) {
      const t = (vertical(side) ? y0 : x0) + across * (0.04 + (0.92 * k) / (n - 1))
      const start: Point = vertical(side) ? [cx, t] : [t, cy]
      const dir: Point = side === "left" ? [-1, 0] : side === "right" ? [1, 0] : side === "top" ? [0, -1] : [0, 1]
      const hit = firstExit(img, paper, start, dir, reach)
      if (hit && !blocked(hit)) hits.push(hit)
    }
    lines[side] = pickLine(side, hits, box, n)
  }

  let quad = quadFrom(lines, box)
  if (!plausible(quad, box)) return fallback

  // Second pass: across each edge found, for the sharp step where the paper meets the frame.
  const refined = {} as Record<Side, Line | null>
  for (const side of SIDES) {
    if (!lines[side]) {
      refined[side] = null
      continue
    }
    const [p, q] = sideEnds(quad, side)
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    const size = Math.min(bw, bh)
    const inward = inwardNormal(quad, side)
    const hits: Point[] = []
    const n = Math.min(400, Math.max(30, Math.round(len / 3)))
    for (let k = 0; k < n; k++) {
      const t = 0.06 + (0.88 * k) / (n - 1)
      const on: Point = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
      const hit = edgeAcross(img, paper, on, inward, Math.max(6, size * 0.04))
      if (hit && !blocked(hit)) hits.push(hit)
    }
    const line = fitTight(side, hits, n)
    // Kept only near the first pass's edge: a second line nearby is the frame's outside.
    refined[side] = line && nearLine(side, line, lines[side]!, quad, size * 0.04) ? line : lines[side]
  }
  const exact = quadFrom(refined, box)
  if (plausible(exact, box)) quad = exact
  return quad.map(([x, y]) => [round(x), round(y)]) as Quad
}

/**
 * The first pixel along the ray that is no longer paper, once the ray is on
 * paper; brightness and colour are averaged across three pixels of the ray.
 */
function firstExit(img: Room, paper: Paper, start: Point, dir: Point, reach: number): Point | null {
  const nx = -dir[1]
  const ny = dir[0]
  const paperAt = (x: number, y: number) => {
    let votes = 0
    for (const o of [-1, 0, 1]) if (isPaper(img, paper, x + nx * o, y + ny * o)) votes++
    return votes >= 2
  }
  let onPaper = 0
  let off = 0
  for (let s = 0; s <= reach; s++) {
    const x = start[0] + dir[0] * s
    const y = start[1] + dir[1] * s
    if (!img.inside(x, y)) return null
    if (paperAt(x, y)) {
      onPaper++
      off = 0
    } else if (onPaper >= 4) {
      // Two off-paper pixels in a row: past the paper's edge.
      if (++off === 2) return [x - dir[0], y - dir[1]]
    } else {
      onPaper = 0
    }
  }
  return null
}

/**
 * Where the paper meets the frame across the edge at `on`: the innermost
 * sharp step in colour within `reach` either side of it that has frame (not
 * paper, shaded though it may be) beyond it. The soft shade a frame casts on
 * the paper inside it is no such step, a mat's cut edge is.
 */
function edgeAcross(img: Room, paper: Paper, on: Point, inward: Point, reach: number): Point | null {
  const out: Point = [-inward[0], -inward[1]]
  const along: Point = [inward[1], -inward[0]]
  const at = (s: number) => {
    let luma = 0
    let cr = 0
    let cb = 0
    for (const o of [-1, 0, 1]) {
      const x = on[0] + out[0] * s + along[0] * o
      const y = on[1] + out[1] * s + along[1] * o
      luma += img.luma(x, y)
      const [r, b] = img.chroma(x, y)
      cr += r
      cb += b
    }
    return [luma / 3, cr / 3, cb / 3]
  }
  const r = Math.round(reach)
  const profile = Array.from({ length: 2 * r + 3 }, (_, k) => at(k - r - 1))
  const steps = profile.map((_, k) => {
    if (k === 0 || k === profile.length - 1) return 0
    const [l0, r0, b0] = profile[k - 1]
    const [l1, r1, b1] = profile[k + 1]
    return Math.abs(l1 - l0) + 255 * (Math.abs(r1 - r0) + Math.abs(b1 - b0))
  })
  const strongest = Math.max(...steps)
  if (strongest < paper.luma * 0.06) return null
  const sharp: number[] = []
  // Sharp enough to be an edge, whatever the frame's dark outer edge beside it does.
  const enough = Math.max(paper.luma * 0.1, strongest / 8)
  for (let k = 1; k < steps.length - 1; k++) {
    if (steps[k] >= enough && steps[k] >= steps[k - 1] && steps[k] >= steps[k + 1]) sharp.push(k)
  }
  // Paper on the outside, in shade though it may be, means the frame is further out.
  const frameBeyond = (k: number) => {
    const [luma, cr, cb] = profile[Math.min(profile.length - 1, k + 3)]
    return luma < paper.luma * 0.45 || Math.abs(cr - paper.cr) > 2 * paper.tol || Math.abs(cb - paper.cb) > 2 * paper.tol
  }
  const k = sharp.find(frameBeyond) ?? sharp[0]
  if (k === undefined) return null
  // The step is centred between k − 1 and k + 1: the paper's last pixel is just before it.
  const at0 = k - r - 1 - 0.5
  return [on[0] + out[0] * at0, on[1] + out[1] * at0]
}

/**
 * The edge among a side's hits: the lines RANSAC finds through them, one
 * after another, of which the one nearest the box's side wins among those
 * with enough hits (something in front Gemini missed leaves a second, inner
 * line).
 */
function pickLine(side: Side, hits: Point[], box: Box, rays: number): Line | null {
  const pts = hits.map((p) => (vertical(side) ? ([p[1], p[0]] as Point) : p))
  const tol = Math.max(1.5, 0.004 * (vertical(side) ? box[3] - box[1] : box[2] - box[0]))
  const found: { line: Line; support: number }[] = []
  let left = pts
  for (let round = 0; round < 3 && left.length >= Math.max(8, rays * 0.12); round++) {
    const best = ransac(left, tol, 300 + round)
    if (!best || best.inliers.length < Math.max(8, rays * 0.12)) break
    found.push({ line: leastSquares(best.inliers), support: best.inliers.length })
    const used = new Set(best.inliers)
    left = left.filter((p) => !used.has(p))
  }
  if (!found.length) return null
  const strongest = Math.max(...found.map((f) => f.support))
  const boxSide = side === "left" ? box[0] : side === "right" ? box[2] : side === "top" ? box[1] : box[3]
  const [t0, t1] = vertical(side) ? [box[1], box[3]] : [box[0], box[2]]
  // How close the line comes to the box's side over the side's length.
  const gap = (l: Line) => Math.min(Math.abs(l.a * t0 + l.b - boxSide), Math.abs(l.a * t1 + l.b - boxSide))
  return found
    .filter((f) => f.support >= strongest * 0.3)
    .sort((a, b) => gap(a.line) - gap(b.line))[0].line
}

/**
 * A line through hits that lie close together already (the second pass):
 * RANSAC for the bulk of them, then least squares refitted without outliers,
 * so a soft edge (hits a few pixels either side) gives the line through its
 * middle, not one tilted through a lucky few.
 */
function fitTight(side: Side, hits: Point[], rays: number): Line | null {
  if (hits.length < Math.max(8, rays * 0.2)) return null
  const pts = hits.map((p) => (vertical(side) ? ([p[1], p[0]] as Point) : p))
  const best = ransac(pts, 3, 77)
  if (!best || best.inliers.length < Math.max(8, rays * 0.2)) return null
  let keep = best.inliers
  let line = leastSquares(keep)
  for (let pass = 0; pass < 3; pass++) {
    const residuals = pts.map(([t, v]) => Math.abs(v - (line.a * t + line.b)))
    const limit = Math.max(1.5, 2.5 * median(keep.map(([t, v]) => Math.abs(v - (line.a * t + line.b)))))
    const next = pts.filter((_, i) => residuals[i] <= limit)
    if (next.length < 8 || next.length === keep.length) break
    keep = next
    line = leastSquares(keep)
  }
  return line
}

/** The line (as v = a·t + b) through most of `pts` within `tol`, from pairs tried in a fixed order. */
function ransac(pts: Point[], tol: number, seed: number) {
  if (pts.length < 2) return null
  let rand = seed
  const next = () => {
    rand = (rand * 1103515245 + 12345) & 0x7fffffff
    return rand / 0x7fffffff
  }
  let best: { line: Line; inliers: Point[] } | null = null
  for (let i = 0; i < 250; i++) {
    const p = pts[Math.floor(next() * pts.length)]
    const q = pts[Math.floor(next() * pts.length)]
    if (Math.abs(q[0] - p[0]) < 4) continue
    const a = (q[1] - p[1]) / (q[0] - p[0])
    if (Math.abs(a) > MAX_SLOPE) continue
    const line = { a, b: p[1] - a * p[0] }
    const inliers = pts.filter(([t, v]) => Math.abs(v - (line.a * t + line.b)) <= tol * Math.sqrt(1 + a * a))
    if (!best || inliers.length > best.inliers.length) best = { line, inliers }
  }
  if (!best) return null
  // Once more around the least-squares line through them.
  const refit = leastSquares(best.inliers)
  const inliers = pts.filter(([t, v]) => Math.abs(v - (refit.a * t + refit.b)) <= tol)
  return inliers.length >= best.inliers.length ? { line: refit, inliers } : best
}

function leastSquares(points: Point[]): Line {
  const n = points.length
  let st = 0, sv = 0, stt = 0, stv = 0
  for (const [t, v] of points) {
    st += t
    sv += v
    stt += t * t
    stv += t * v
  }
  const d = n * stt - st * st
  const a = d ? (n * stv - st * sv) / d : 0
  return { a, b: (sv - a * st) / n }
}

/** The quad the four sides make, a missing side taken from the box. */
function quadFrom(lines: Record<Side, Line | null>, box: Box): Quad {
  const L = lines.left ?? { a: 0, b: box[0] }
  const R = lines.right ?? { a: 0, b: box[2] }
  const T = lines.top ?? { a: 0, b: box[1] }
  const B = lines.bottom ?? { a: 0, b: box[3] }
  const corner = (side: Line, edge: Line): Point => {
    // x = side.a·y + side.b, y = edge.a·x + edge.b
    const y = (edge.a * side.b + edge.b) / (1 - edge.a * side.a)
    return [side.a * y + side.b, y]
  }
  return [corner(L, T), corner(R, T), corner(R, B), corner(L, B)]
}

/** Convex, about the box's size and inside it give or take a little, with corners near right angles. */
function plausible(quad: Quad, box: Box) {
  if (quad.some((p) => !p.every(Number.isFinite))) return false
  const bw = box[2] - box[0]
  const bh = box[3] - box[1]
  const margin = 0.12 * Math.max(bw, bh)
  if (quad.some(([x, y]) => x < box[0] - margin || x > box[2] + margin || y < box[1] - margin || y > box[3] + margin)) {
    return false
  }
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const [a, b, c] = [quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4]]
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (sign && Math.sign(cross) !== sign) return false
    sign = Math.sign(cross)
    const u = [a[0] - b[0], a[1] - b[1]]
    const v = [c[0] - b[0], c[1] - b[1]]
    const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]))
    if (Math.abs(cos) > Math.cos((55 * Math.PI) / 180)) return false
  }
  return area(quad) >= 0.4 * bw * bh
}

function sideEnds(quad: Quad, side: Side): [Point, Point] {
  const [tl, tr, br, bl] = quad
  return side === "left" ? [tl, bl] : side === "right" ? [tr, br] : side === "top" ? [tl, tr] : [bl, br]
}

/** Unit normal of a side, pointing into the quad. */
function inwardNormal(quad: Quad, side: Side): Point {
  const [p, q] = sideEnds(quad, side)
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
  let n: Point = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len]
  const c = centroid(quad)
  const mid: Point = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  if ((c[0] - mid[0]) * n[0] + (c[1] - mid[1]) * n[1] < 0) n = [-n[0], -n[1]]
  return n
}

/** Whether two lines of a side stay within `tol` of each other along the side. */
function nearLine(side: Side, a: Line, b: Line, quad: Quad, tol: number) {
  const [p, q] = sideEnds(quad, side)
  const ts = vertical(side) ? [p[1], q[1]] : [p[0], q[0]]
  return ts.every((t) => Math.abs(a.a * t + a.b - (b.a * t + b.b)) <= tol)
}

// --- In front ---

function frontMask(img: Room, quads: Quad[], sheets: Box[], occluders: Box[]): Uint8Array | null {
  if (!occluders.length) return null
  const { w, h } = img
  const mask = new Uint8Array(w * h)
  let any = false
  for (const [i, quad] of quads.entries()) {
    const own = occluders.filter((o) => containment(sheets[i], o) < 0.6 && overlaps(o, boxOf(quad)))
    if (!own.length) continue
    const paper = paperOf(img, boxOf(quad), own)
    if (!paper) continue
    // Inside the sheet, other sheets excluded: their posters are drawn over this one anyway.
    const others = quads.filter((_, j) => j !== i)
    const [qx0, qy0, qx1, qy1] = boxOf(quad).map(Math.round)
    const x0 = Math.max(0, qx0)
    const y0 = Math.max(0, qy0)
    const x1 = Math.min(w - 1, qx1)
    const y1 = Math.min(h - 1, qy1)
    const rw = x1 - x0 + 1
    const rh = y1 - y0 + 1
    if (rw < 4 || rh < 4) continue
    const region = new Uint8Array(rw * rh) // 1: this sheet's paper area, 2: inside a box in front
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!inQuad(quad, x + 0.5, y + 0.5) || others.some((q) => inQuad(q, x + 0.5, y + 0.5))) continue
        region[(y - y0) * rw + (x - x0)] = own.some((o) => inBox(grown(o, 0.02 * Math.max(rw, rh)), x, y)) ? 2 : 1
      }
    const reached = fillPaper(img, paper, region, x0, y0, rw, rh)
    const blob = new Uint8Array(rw * rh)
    for (let k = 0; k < region.length; k++) if (region[k] === 2 && !reached[k]) blob[k] = 1
    const cleaned = clean(blob, rw, rh, Math.max(16, rw * rh * 0.0008))
    for (let y = 0; y < rh; y++)
      for (let x = 0; x < rw; x++) {
        if (!cleaned[y * rw + x]) continue
        mask[(y + y0) * w + (x + x0)] = 1
        any = true
      }
  }
  return any ? soften(mask, w, h) : null
}

/**
 * Paper flooded from the visible paper (region 1) into the boxes in front
 * (region 2): through paper-coloured pixels, never across a sharp step in
 * brightness (an object's outline).
 */
function fillPaper(img: Room, paper: Paper, region: Uint8Array, x0: number, y0: number, rw: number, rh: number) {
  const reached = new Uint8Array(rw * rh)
  const queue = new Int32Array(rw * rh)
  let head = 0
  let tail = 0
  const luma = new Float32Array(rw * rh)
  const passable = new Uint8Array(rw * rh)
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const k = y * rw + x
      if (!region[k]) continue
      luma[k] = img.luma(x + x0, y + y0)
      passable[k] = isPaper(img, paper, x + x0, y + y0) ? 1 : 0
    }
  // Outlines: where brightness changes faster than shadows and light on paper ever do (Sobel).
  const edge = paper.luma * 0.025
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const k = y * rw + x
      if (!passable[k]) continue
      const L = (dx: number, dy: number) => img.luma(x + x0 + dx, y + y0 + dy)
      const gx = L(1, -1) + 2 * L(1, 0) + L(1, 1) - L(-1, -1) - 2 * L(-1, 0) - L(-1, 1)
      const gy = L(-1, 1) + 2 * L(0, 1) + L(1, 1) - L(-1, -1) - 2 * L(0, -1) - L(1, -1)
      if (Math.hypot(gx, gy) / 8 > edge) passable[k] = 0
    }
  // A step between neighbours of this much (of the paper's brightness) is an outline.
  const step = paper.luma * 0.06
  for (let k = 0; k < region.length; k++) {
    // Visible paper around the boxes, and paper inside them where the original showed the design.
    const seed =
      passable[k] && (region[k] === 1 || (img.hasOriginal && img.change((k % rw) + x0, Math.floor(k / rw) + y0) > CHANGED))
    if (seed) {
      reached[k] = 1
      queue[tail++] = k
    }
  }
  while (head < tail) {
    const k = queue[head++]
    const x = k % rw
    const y = (k - x) / rw
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue
      const j = ny * rw + nx
      if (reached[j] || !region[j] || !passable[j]) continue
      if (Math.abs(luma[j] - luma[k]) > step) continue
      reached[j] = 1
      queue[tail++] = j
    }
  }
  return reached
}

/** Speckles out (open by one pixel), small pieces dropped, gaps closed. */
function clean(blob: Uint8Array, w: number, h: number, minArea: number) {
  const opened = dilate(erode(blob, w, h), w, h)
  const closed = erode(dilate(dilate(opened, w, h), w, h), w, h)
  const out = new Uint8Array(w * h)
  for (const piece of pieces(closed, w, h)) {
    if (piece.size >= minArea) for (const c of piece.cells) out[c] = 1
  }
  return out
}

/** The 4-connected pieces of a 0/1 mask, with their cells and bounding boxes (in cells). */
function pieces(m: Uint8Array, w: number, h: number) {
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  const found: { cells: number[]; size: number; box: Box }[] = []
  for (let k = 0; k < m.length; k++) {
    if (!m[k] || seen[k]) continue
    const cells: number[] = []
    const box: Box = [w, h, 0, 0]
    stack.push(k)
    seen[k] = 1
    while (stack.length) {
      const c = stack.pop()!
      cells.push(c)
      const x = c % w
      const y = (c - x) / w
      box[0] = Math.min(box[0], x)
      box[1] = Math.min(box[1], y)
      box[2] = Math.max(box[2], x)
      box[3] = Math.max(box[3], y)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (m[j] && !seen[j]) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    found.push({ cells, size: cells.length, box })
  }
  return found
}

function erode(m: Uint8Array, w: number, h: number) {
  const out = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x
      out[k] = m[k] & m[k - 1] & m[k + 1] & m[k - w] & m[k + w]
    }
  return out
}

function dilate(m: Uint8Array, w: number, h: number) {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      out[k] = m[k] | (x > 0 ? m[k - 1] : 0) | (x < w - 1 ? m[k + 1] : 0) | (y > 0 ? m[k - w] : 0) | (y < h - 1 ? m[k + w] : 0)
    }
  return out
}

/** 0/1 → 0–255: a pixel wider, so an object's own soft rim stays in front, then a one-pixel ramp. */
function soften(mask: Uint8Array, w: number, h: number) {
  const wide = dilate(mask, w, h)
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          s += wide[yy * w + xx]
          n++
        }
      out[y * w + x] = Math.round((255 * s) / n)
    }
  return out
}

// --- Geometry ---

const quadOf = ([x0, y0, x1, y1]: Box): Quad => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

const inBox = ([x0, y0, x1, y1]: Box, x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1

const grown = ([x0, y0, x1, y1]: Box, by: number): Box => [x0 - by, y0 - by, x1 + by, y1 + by]

const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

/** How much of `a` lies inside `b`, 0–1. */
export function containment(a: Box, b: Box) {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const own = (a[2] - a[0]) * (a[3] - a[1])
  return own > 0 ? (w * h) / own : 0
}

/** Intersection over union of two boxes, 0–1. */
export function iou(a: Box, b: Box) {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const i = w * h
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
  return u > 0 ? i / u : 0
}

function area(quad: Quad) {
  let s = 0
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = quad[i]
    const [x2, y2] = quad[(i + 1) % 4]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

function centroid(quad: Quad): Point {
  return [quad.reduce((s, p) => s + p[0], 0) / 4, quad.reduce((s, p) => s + p[1], 0) / 4]
}

/** Whether (x, y) lies inside the convex quad. */
function inQuad(quad: Quad, x: number, y: number) {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = quad[i]
    const [bx, by] = quad[(i + 1) % 4]
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
    if (cross === 0) continue
    if (sign && Math.sign(cross) !== sign) return false
    sign = Math.sign(cross)
  }
  return true
}

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b)
  return s[s.length >> 1]
}

const round = (v: number) => Math.round(v * 10) / 10

// --- Behind what's in front ---

/**
 * The room with the paper filled in where something stands in front of a
 * sheet, from the paper around it (push–pull over a quarter-size grid; light
 * on paper is smooth): light and shine are read off this, so a hand leaves
 * no hand-shaped shade on the design under it.
 */
export function paperBehind(room: Pixels, front: Uint8Array, quads: Quad[]): Pixels {
  const { width: w, height: h } = room
  const data = new Uint8ClampedArray(room.data)
  const f = 4
  for (const quad of quads) {
    const [qx0, qy0, qx1, qy1] = boxOf(quad)
    const x0 = Math.max(0, Math.floor(qx0))
    const y0 = Math.max(0, Math.floor(qy0))
    const x1 = Math.min(w - 1, Math.ceil(qx1))
    const y1 = Math.min(h - 1, Math.ceil(qy1))
    const gw = Math.ceil((x1 - x0 + 1) / f)
    const gh = Math.ceil((y1 - y0 + 1) / f)
    if (gw < 2 || gh < 2) continue
    // Known paper per cell: inside the sheet, nothing in front.
    const sum = new Float32Array(gw * gh * 3)
    const weight = new Float32Array(gw * gh)
    let hidden = false
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!inQuad(quad, x + 0.5, y + 0.5)) continue
        // Its soft rim too: those pixels still hold some of the thing's colour.
        if (front[y * w + x] > 0) {
          hidden = true
          continue
        }
        const c = Math.floor((y - y0) / f) * gw + Math.floor((x - x0) / f)
        const i = (y * w + x) * 4
        sum[c * 3] += data[i]
        sum[c * 3 + 1] += data[i + 1]
        sum[c * 3 + 2] += data[i + 2]
        weight[c] += 1
      }
    if (!hidden) continue
    const filled = pushPull(sum, weight, gw, gh)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const a = front[y * w + x]
        if (!a || !inQuad(quad, x + 0.5, y + 0.5)) continue
        const gx = Math.min(gw - 1, Math.max(0, (x - x0 + 0.5) / f - 0.5))
        const gy = Math.min(gh - 1, Math.max(0, (y - y0 + 0.5) / f - 0.5))
        const i = (y * w + x) * 4
        for (let ch = 0; ch < 3; ch++) {
          const v = bilinear(filled, gw, gh, gx, gy, ch)
          data[i + ch] = Math.round(data[i + ch] + ((v - data[i + ch]) * a) / 255)
        }
      }
  }
  return { data, width: w, height: h }
}

/** Colours per cell (RGB), each the mean of what's known in it; unknown cells from coarser levels. */
function pushPull(sum: Float32Array, weight: Float32Array, w: number, h: number): Float32Array {
  const colour = new Float32Array(w * h * 3)
  const known = new Float32Array(w * h)
  for (let k = 0; k < w * h; k++) {
    if (weight[k] > 0) for (let c = 0; c < 3; c++) colour[k * 3 + c] = sum[k * 3 + c] / weight[k]
    known[k] = Math.min(1, weight[k] / 4)
  }
  if (w <= 2 && h <= 2) return colour
  const sw = Math.ceil(w / 2)
  const sh = Math.ceil(h / 2)
  const sSum = new Float32Array(sw * sh * 3)
  const sWeight = new Float32Array(sw * sh)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      const s = (y >> 1) * sw + (x >> 1)
      for (let c = 0; c < 3; c++) sSum[s * 3 + c] += colour[k * 3 + c] * known[k]
      sWeight[s] += known[k]
    }
  const coarse = pushPull(sSum, sWeight, sw, sh)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      if (known[k] >= 1) continue
      const gx = Math.min(sw - 1, Math.max(0, (x + 0.5) / 2 - 0.5))
      const gy = Math.min(sh - 1, Math.max(0, (y + 0.5) / 2 - 0.5))
      for (let c = 0; c < 3; c++) {
        colour[k * 3 + c] = colour[k * 3 + c] * known[k] + bilinear(coarse, sw, sh, gx, gy, c) * (1 - known[k])
      }
    }
  return colour
}

function bilinear(grid: Float32Array, w: number, h: number, x: number, y: number, c: number) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const at = (xx: number, yy: number) => grid[(yy * w + xx) * 3 + c]
  return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty
}

/**
 * Posters in the order they're drawn: as given (reading order), except that
 * of two sheets that overlap the larger one, nearer the camera, comes later.
 */
export function drawingOrder(quads: Quad[]): number[] {
  const order = quads.map((_, i) => i)
  for (let pass = 0; pass < quads.length; pass++) {
    for (let a = 0; a < order.length; a++)
      for (let b = a + 1; b < order.length; b++) {
        const qa = quads[order[a]]
        const qb = quads[order[b]]
        if (area(qa) > area(qb) && iou(boxOf(qa), boxOf(qb)) > 0.02) {
          const [moved] = order.splice(a, 1)
          order.splice(b, 0, moved)
        }
      }
  }
  return order
}

/** Whether `box` in the room is mostly blank paper: bright and of hardly any colour. */
export function looksBlank(room: Pixels, box: Box) {
  const img = new Room(room)
  const [x0, y0, x1, y1] = box
  let paper = 0
  let all = 0
  for (let y = y0 + (y1 - y0) * 0.25; y < y1 - (y1 - y0) * 0.25; y += Math.max(2, (y1 - y0) / 40))
    for (let x = x0 + (x1 - x0) * 0.25; x < x1 - (x1 - x0) * 0.25; x += Math.max(2, (x1 - x0) / 40)) {
      if (!img.inside(x, y)) continue
      all++
      const [cr, cb] = img.chroma(x, y)
      if (img.luma(x, y) > 150 && Math.abs(cr) < 0.06 && Math.abs(cb) < 0.06) paper++
    }
  return all > 0 && paper / all >= 0.7
}
