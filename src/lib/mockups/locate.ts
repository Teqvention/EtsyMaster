import type { Pixels } from "./sheet"
import type { Point, Quad } from "./types"

// Exact corners of a blank sheet from a rough box around it. Rays run from
// the box's middle outward in every row and column until they hit the frame
// (much darker than the paper); a straight line through each side's hits
// gives the edge, and the edges' intersections the corners. Light stripes
// and soft shadows on the paper don't stop a ray, a plant in front of the
// frame only costs a few outliers. Light frames on a light wall give no
// edge, so the box is kept as is.

/** A pixel this much darker than the paper is frame. */
const DARK = 0.45

export function refineSheet(room: Pixels, box: Quad): Quad {
  const { data, width: w, height: h } = room
  const luma = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  const x0 = Math.min(box[0][0], box[3][0])
  const x1 = Math.max(box[1][0], box[2][0])
  const y0 = Math.min(box[0][1], box[1][1])
  const y1 = Math.max(box[2][1], box[3][1])
  const cx = Math.round((x0 + x1) / 2)
  const cy = Math.round((y0 + y1) / 2)
  const bw = x1 - x0
  const bh = y1 - y0
  if (cx < 0 || cy < 0 || cx >= w || cy >= h || bw < 8 || bh < 8) return box

  // Paper brightness: median of the box's middle half.
  const samples: number[] = []
  for (let y = Math.round(y0 + bh / 4); y < y1 - bh / 4; y += 4)
    for (let x = Math.round(x0 + bw / 4); x < x1 - bw / 4; x += 4) samples.push(luma(x, y))
  samples.sort((a, b) => a - b)
  const dark = samples[samples.length >> 1] * DARK

  // First dark pixel from (x, y) stepping (dx, dy), at most `reach` px away.
  const ray = (x: number, y: number, dx: number, dy: number, reach: number): number | null => {
    for (let s = 0; s <= reach; s++) {
      const px = x + dx * s
      const py = y + dy * s
      if (px < 0 || py < 0 || px >= w || py >= h) return null
      if (luma(px, py) < dark) return s
    }
    return null
  }

  const left: Point[] = []
  const right: Point[] = []
  const top: Point[] = []
  const bottom: Point[] = []
  const rx = Math.round(bw * 0.7)
  const ry = Math.round(bh * 0.7)
  for (let y = Math.round(y0 + bh * 0.15); y < y1 - bh * 0.15; y += 2) {
    const l = ray(cx, y, -1, 0, rx)
    const r = ray(cx, y, 1, 0, rx)
    if (l !== null) left.push([y, cx - l])
    if (r !== null) right.push([y, cx + r + 1])
  }
  for (let x = Math.round(x0 + bw * 0.15); x < x1 - bw * 0.15; x += 2) {
    const t = ray(x, cy, 0, -1, ry)
    const b = ray(x, cy, 0, 1, ry)
    if (t !== null) top.push([x, cy - t])
    if (b !== null) bottom.push([x, cy + b + 1])
  }

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
