import type { Pixels } from "./sheet"
import type { Point, Quad } from "./types"

// Exact corners of a printed artwork from a rough box around it. A print has
// edges of its own inside, so rays from the middle would stop on the design:
// instead each row and column is searched in a narrow band around the box's
// side for the strongest step in brightness (print to mat, frame or wall),
// favouring steps near the box's line. Lines through those edge points give
// the corners; no clear edge keeps the box. (Blank sheets are found in
// detect.ts.)

/** Half-width of the band searched around each side, as a share of the box. */
const BAND = 0.06
/** Smallest step in brightness (0–255) across two pixels that counts as an edge. */
const MIN_EDGE = 10

export function refineArtwork(room: Pixels, box: Quad): Quad {
  const { data, width: w, height: h } = room
  const luma = (x: number, y: number) => {
    const i = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  const x0 = Math.round(Math.min(box[0][0], box[3][0]))
  const x1 = Math.round(Math.max(box[1][0], box[2][0]))
  const y0 = Math.round(Math.min(box[0][1], box[1][1]))
  const y1 = Math.round(Math.max(box[2][1], box[3][1]))
  const bw = x1 - x0
  const bh = y1 - y0
  if (bw < 16 || bh < 16) return box

  // Offset of the strongest edge crossing (x, y) along (dx, dy), within ±m,
  // brightness averaged over three pixels along the edge against JPEG noise.
  const edge = (x: number, y: number, dx: number, dy: number, m: number): number | null => {
    const at = (px: number, py: number) =>
      (luma(px - dy, py - dx) + luma(px, py) + luma(px + dy, py + dx)) / 3
    let best: number | null = null
    let score = 0
    for (let s = -m; s <= m; s++) {
      const px = x + dx * s
      const py = y + dy * s
      if (px < 1 || py < 1 || px >= w - 1 || py >= h - 1) continue
      const step = Math.abs(at(px + dx, py + dy) - at(px - dx, py - dy))
      const weighted = step * (1 - (0.5 * Math.abs(s)) / m)
      if (step >= MIN_EDGE && weighted > score) {
        score = weighted
        best = s
      }
    }
    return best
  }

  const left: Point[] = []
  const right: Point[] = []
  const top: Point[] = []
  const bottom: Point[] = []
  const mx = Math.max(3, Math.round(bw * BAND))
  const my = Math.max(3, Math.round(bh * BAND))
  for (let y = Math.round(y0 + bh * 0.15); y < y1 - bh * 0.15; y += 2) {
    const l = edge(x0, y, 1, 0, mx)
    const r = edge(x1, y, 1, 0, mx)
    if (l !== null) left.push([y, x0 + l])
    if (r !== null) right.push([y, x1 + r])
  }
  for (let x = Math.round(x0 + bw * 0.15); x < x1 - bw * 0.15; x += 2) {
    const t = edge(x, y0, 0, 1, my)
    const b = edge(x, y1, 0, 1, my)
    if (t !== null) top.push([x, y0 + t])
    if (b !== null) bottom.push([x, y1 + b])
  }

  return corners(box, [left, right, top, bottom])
}

/** The quad where the lines through each side's points meet, or `box` when they don't fit. */
function corners(box: Quad, [left, right, top, bottom]: Point[][]): Quad {
  const bw = Math.max(box[1][0], box[2][0]) - Math.min(box[0][0], box[3][0])
  const bh = Math.max(box[2][1], box[3][1]) - Math.min(box[0][1], box[1][1])
  // Sides as x = a·y + b, top and bottom as y = a·x + b.
  const lines = [left, right, top, bottom].map((points) => fitLine(points, points === left || points === right ? bh : bw))
  if (lines.some((l) => !l)) return box
  const [L, R, T, B] = lines as Line[]
  const corner = (side: Line, edge: Line): Point => {
    // x = side.a·y + side.b, y = edge.a·x + edge.b
    const y = (edge.a * side.b + edge.b) / (1 - edge.a * side.a)
    return [side.a * y + side.b, y]
  }
  const quad: Quad = [corner(L, T), corner(R, T), corner(R, B), corner(L, B)]

  // Each corner should land near the box's; a far-off one means a bad fit.
  const reach = 0.12 * Math.hypot(bw, bh)
  const near = quad.every((p, k) => Math.hypot(p[0] - box[k][0], p[1] - box[k][1]) < reach)
  return near ? quad.map(([x, y]) => [round(x), round(y)]) as Quad : box
}

type Line = { a: number; b: number }

/**
 * Least-squares line through (t, v) pairs as v = a·t + b, refitted without
 * outliers. Needs hits along at least half the side (`span` px long) and
 * a near-axis-aligned result (|a| < 0.25, ~14°).
 */
function fitLine(points: Point[], span: number): Line | null {
  // Rays run every 2 px over the middle 70 % of the side.
  if (points.length < (span * 0.7) / 2 / 2) return null
  let keep = points
  let line = leastSquares(keep)
  for (let pass = 0; pass < 3; pass++) {
    const residuals = keep.map(([t, v]) => Math.abs(v - (line.a * t + line.b)))
    const sorted = [...residuals].sort((a, b) => a - b)
    const limit = Math.max(1.5, 3 * sorted[sorted.length >> 1])
    const next = keep.filter((_, i) => residuals[i] <= limit)
    if (next.length === keep.length || next.length < 8) break
    keep = next
    line = leastSquares(keep)
  }
  if (keep.length < points.length * 0.5 || Math.abs(line.a) > 0.25) return null
  return line
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

const round = (v: number) => Math.round(v * 10) / 10
