import sharp from "sharp"

import { askJson } from "@/lib/mockups/gemini"
import { quadAspect } from "@/lib/mockups/geometry"
import { unwarp, type Pixels } from "@/lib/mockups/sheet"
import type { Point, Quad } from "@/lib/mockups/types"

// The poster a composition is rebuilt from, flat and front-on, edge to edge
// on its paper. A design file is that already. A photo of a framed poster
// (on a wall, leaning against one) is unwarped: Gemini points at the four
// corners of the printed sheet, inside the frame and any mat; each side is
// then found in the pixels near its line (the step from frame, mat or
// shadow onto the paper) and the corners are where those lines meet; the
// quad is unwarped at a print size's shape, and strips of frame left along
// the edges are cut. 13 Oct: the poster extraction made for listing
// photos (a box, then its strongest edges) left frame along the edges,
// cut the bottom margin off and left a leaning poster askew.

/** Print shapes as height ÷ width; a measured shape this close to one is snapped to it. */
const SHAPES = [1, 5 / 4, 14 / 11, 4 / 3, 7 / 5, Math.SQRT2, 3 / 2]
const SNAP = 0.035

export type FlatPoster = { image: Buffer; width: number; height: number; fromPhoto: boolean }

const CORNERS_SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["design", "photo"] },
    corners: { type: "ARRAY", items: { type: "ARRAY", items: { type: "NUMBER" } } },
  },
  required: ["kind", "corners"],
}

/** The poster in `image`, flat: as it is for a design file, unwarped out of a photo of it. */
export async function flatPoster(image: Buffer): Promise<FlatPoster> {
  const upright = await sharp(image).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = upright.info
  const look = await sharp(upright.data).resize(1536, 1536, { fit: "inside" }).jpeg({ quality: 90 }).toBuffer()
  const found = await askJson<{ kind?: string; corners?: number[][] }>(
    `Is this image a poster design itself ("design": the artwork edge to edge, nothing around it) or a photo of a printed poster ("photo": framed or unframed, on a wall, a shelf or the floor, in a room)?
For a photo, give the four corners of the printed poster sheet: the paper with the design on it, inside the frame moulding and inside any mat or passe-partout, including the poster's own white margins. Corners in this order: top left, top right, bottom right, bottom left, each as [y, x] normalized to 0-1000, as exact as you can (they're refined afterwards). For a design, corners is [].`,
    [look],
    // Hardly any thinking: given time, it pondered a leaning poster's corners past every timeout (13 Oct); the pixels refine them anyway.
    { schema: CORNERS_SCHEMA, temperature: 0, quick: true }
  )
  const corners = (found.corners ?? []).filter((c) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite))
  if (found.kind !== "photo" || corners.length !== 4) return { image: upright.data, width: W, height: H, fromPhoto: false }

  const px = await pixelsOf(upright.data)
  const rough = corners.map(([y, x]) => [(x / 1000) * W, (y / 1000) * H] as Point) as Quad
  const quad = refineSheet(px, rough)
  const ratio = snap(quadAspect(quad))
  const length = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const width = Math.round(Math.max(length(quad[0], quad[1]), length(quad[3], quad[2])))
  const height = Math.round(width * ratio)
  const [r, g, b] = unwarp(px, quad, width, height)
  const rgb = Buffer.alloc(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = r[i]
    rgb[i * 3 + 1] = g[i]
    rgb[i * 3 + 2] = b[i]
  }
  const trimmed = trimFrame({ rgb, width, height })
  const flat = await sharp(trimmed.rgb, { raw: { width: trimmed.width, height: trimmed.height, channels: 3 } }).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer()
  return { image: flat, width: trimmed.width, height: trimmed.height, fromPhoto: true }
}

function snap(measured: number) {
  const nearest = SHAPES.flatMap((r) => [r, 1 / r]).reduce((best, r) => (Math.abs(Math.log(r / measured)) < Math.abs(Math.log(best / measured)) ? r : best))
  return Math.abs(Math.log(nearest / measured)) < SNAP ? nearest : measured
}

async function pixelsOf(image: Buffer): Promise<Pixels> {
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height }
}

const lumaAt = (px: Pixels, x: number, y: number) => {
  const xi = Math.min(px.width - 1, Math.max(0, Math.round(x)))
  const yi = Math.min(px.height - 1, Math.max(0, Math.round(y)))
  const i = (yi * px.width + xi) * 4
  return 0.299 * px.data[i] + 0.587 * px.data[i + 1] + 0.114 * px.data[i + 2]
}

/**
 * Each side of the sheet found in the pixels near Gemini's line: along the
 * side, the brightness across it, and where it steps onto an even, paper
 * coloured run inside (the poster's margin); lines fitted through those
 * points without the strays, the corners where they meet. Sides that find
 * too little keep Gemini's line.
 */
function refineSheet(px: Pixels, rough: Quad): Quad {
  const length = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const size = Math.min(length(rough[0], rough[1]), length(rough[0], rough[3]))
  const reach = Math.max(6, Math.round(size * 0.035))
  const cx = rough.reduce((s, p) => s + p[0], 0) / 4
  const cy = rough.reduce((s, p) => s + p[1], 0) / 4
  const lines: ({ p: Point; d: Point } | null)[] = []
  for (let s = 0; s < 4; s++) {
    const a = rough[s]
    const b = rough[(s + 1) % 4]
    const along: Point = [(b[0] - a[0]) / length(a, b), (b[1] - a[1]) / length(a, b)]
    // The normal pointing into the sheet.
    let normal: Point = [-along[1], along[0]]
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    if ((cx - mid[0]) * normal[0] + (cy - mid[1]) * normal[1] < 0) normal = [-normal[0], -normal[1]]
    const points: Point[] = []
    for (let t = 0.1; t <= 0.9; t += 0.01) {
      const base: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      const at = (k: number) => lumaAt(px, base[0] + normal[0] * k, base[1] + normal[1] * k)
      let best: number | null = null
      let score = 0
      for (let k = -reach; k <= reach; k++) {
        const outside = (at(k - 2) + at(k - 1)) / 2
        const inside = (at(k) + at(k + 1) + at(k + 2) + at(k + 3)) / 4
        const step = Math.abs(inside - outside)
        if (step < 12) continue
        // Paper inside: even, and lighter than what's outside (a frame, a shadow) or a mat's tone step.
        let spread = 0
        for (let j = 0; j < 6; j++) spread = Math.max(spread, Math.abs(at(k + j) - inside))
        const even = spread < 14 ? 1 : spread < 28 ? 0.5 : 0.15
        const weighted = step * even * (1 - (0.4 * Math.abs(k)) / reach)
        if (weighted > score) {
          score = weighted
          best = k
        }
      }
      if (best !== null) points.push([base[0] + normal[0] * best, base[1] + normal[1] * best])
    }
    lines.push(points.length >= 30 ? fit(points) : null)
  }
  const roughLine = (s: number) => {
    const a = rough[s]
    const b = rough[(s + 1) % 4]
    return { p: a, d: [b[0] - a[0], b[1] - a[1]] as Point }
  }
  const sides = lines.map((l, s) => l ?? roughLine(s))
  const meet = (l1: { p: Point; d: Point }, l2: { p: Point; d: Point }): Point | null => {
    const det = l1.d[0] * l2.d[1] - l1.d[1] * l2.d[0]
    if (Math.abs(det) < 1e-9) return null
    const t = ((l2.p[0] - l1.p[0]) * l2.d[1] - (l2.p[1] - l1.p[1]) * l2.d[0]) / det
    return [l1.p[0] + l1.d[0] * t, l1.p[1] + l1.d[1] * t]
  }
  // Corner k is where side k-1 (coming in) meets side k (going out).
  const quad = [0, 1, 2, 3].map((k) => meet(sides[(k + 3) % 4], sides[k])) as (Point | null)[]
  // A corner far from Gemini's means a bad fit: Gemini's quad then.
  if (quad.some((p, k) => !p || length(p, rough[k]) > size * 0.06)) return rough
  return quad as Quad
}

/** A line through points (direction from their spread), refitted without the strays. */
function fit(points: Point[]): { p: Point; d: Point } {
  let keep = points
  let line = principal(keep)
  for (let pass = 0; pass < 3; pass++) {
    const dist = keep.map(([x, y]) => Math.abs((x - line.p[0]) * line.d[1] - (y - line.p[1]) * line.d[0]))
    const sorted = [...dist].sort((a, b) => a - b)
    const limit = Math.max(1.5, 3 * sorted[sorted.length >> 1])
    const next = keep.filter((_, i) => dist[i] <= limit)
    if (next.length === keep.length || next.length < 10) break
    keep = next
    line = principal(keep)
  }
  return line
}

function principal(points: Point[]) {
  const n = points.length
  const mx = points.reduce((s, p) => s + p[0], 0) / n
  const my = points.reduce((s, p) => s + p[1], 0) / n
  let sxx = 0, syy = 0, sxy = 0
  for (const [x, y] of points) {
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
    sxy += (x - mx) * (y - my)
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  return { p: [mx, my] as Point, d: [Math.cos(angle), Math.sin(angle)] as Point }
}

type Rgb = { rgb: Buffer; width: number; height: number }

/**
 * Strips of frame left along the edges: lines from the very edge in that
 * aren't mostly the paper's colour (up to 4 % a side). Content near an edge
 * never counts, as it starts after paper.
 */
function trimFrame(img: Rgb): Rgb {
  const { rgb, width, height } = img
  const luma = (x: number, y: number) => {
    const i = (y * width + x) * 3
    return 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2]
  }
  // The paper: the light tone most of the image's light pixels share.
  const sample: number[] = []
  for (let y = 0; y < height; y += 4) for (let x = 0; x < width; x += 4) sample.push(luma(x, y))
  sample.sort((a, b) => a - b)
  const paper = sample[Math.floor(sample.length * 0.92)]
  const paperish = (count: number, at: (k: number) => number) => {
    let hits = 0
    for (let k = 0; k < count; k++) if (Math.abs(at(k) - paper) <= 28) hits++
    return hits / count >= 0.6
  }
  const cut = (lines: number, count: number, at: (line: number, k: number) => number) => {
    const most = Math.floor(lines * 0.04)
    let n = 0
    while (n < most && !paperish(count, (k) => at(n, k))) n++
    return n < most ? n : 0
  }
  const top = cut(height, width, (line, k) => luma(k, line))
  const bottom = cut(height, width, (line, k) => luma(k, height - 1 - line))
  const left = cut(width, height, (line, k) => luma(line, k))
  const right = cut(width, height, (line, k) => luma(width - 1 - line, k))
  if (!top && !bottom && !left && !right) return img
  const w = width - left - right
  const h = height - top - bottom
  const out = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) rgb.copy(out, y * w * 3, ((y + top) * width + left) * 3, ((y + top) * width + left + w) * 3)
  return { rgb: out, width: w, height: h }
}

type Lit = { rgb: Uint8Array; width: number; height: number }
type Area = { x0: number; y0: number; x1: number; y1: number }

/**
 * The paper's light made even, as in the print file: a photo of a poster is
 * lit unevenly (brighter towards a window, shaded by its frame, a glare
 * across the glass). The paper's own brightness is read cell by cell from
 * its lightest pixels; left out where the photo is (`photo`, its sky may be
 * as pale as paper), where a cell is coloured or far darker than the paper
 * around it (type set large); filled in there from the cells around,
 * smoothed, and every pixel lifted (or lowered) by how much darker (or
 * lighter) than the paper its spot was lit. 13 Oct: in a leaning Bondi
 * poster the shaded top read as part of the photo; behind glass, a New
 * York's paper ran from 190 to 226.
 */
export function evenLight(img: Lit, photo: Area | null): Lit {
  const { rgb, width: W, height: H } = img
  const S = 20
  const gw = Math.ceil(W / S)
  const gh = Math.ceil(H / S)
  const lum = (i: number) => 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]
  const chromaOf = (i: number) => Math.max(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]) - Math.min(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])
  const read = new Float32Array(gw * gh).fill(NaN)
  const tint = new Float32Array(gw * gh).fill(NaN)
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      const x0 = cx * S
      const y0 = cy * S
      const x1 = Math.min(W, x0 + S)
      const y1 = Math.min(H, y0 + S)
      if (photo && x1 > photo.x0 - 3 && x0 < photo.x1 + 3 && y1 > photo.y0 - 3 && y0 < photo.y1 + 3) continue
      const values: number[] = []
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) values.push(lum(y * W + x))
      values.sort((a, b) => a - b)
      const light = values[Math.floor(values.length * 0.9)]
      let chroma = 0
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * W + x
          if (lum(i) < light - 4) continue
          chroma += chromaOf(i)
          n++
        }
      }
      read[cy * gw + cx] = light
      tint[cy * gw + cx] = n ? chroma / n : 0
    }
  }
  const valid = [...read].filter(Number.isFinite).sort((a, b) => a - b)
  if (valid.length < 12) return img
  const paper = valid[Math.floor(valid.length * 0.9)]
  const tints = [...tint].filter(Number.isFinite).sort((a, b) => a - b)
  const paperTint = tints[tints.length >> 1]
  // Cells that aren't paper: dark, coloured, or darker than the paper around them.
  const est = read.slice()
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      const k = cy * gw + cx
      if (!Number.isFinite(read[k])) continue
      if (read[k] < paper - 80 || tint[k] > paperTint + 14) {
        est[k] = NaN
        continue
      }
      const around: number[] = []
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx
          const ny = cy + dy
          if ((dx || dy) && nx >= 0 && ny >= 0 && nx < gw && ny < gh && Number.isFinite(read[ny * gw + nx])) around.push(read[ny * gw + nx])
        }
      }
      around.sort((a, b) => a - b)
      if (around.length >= 4 && around[around.length >> 1] - read[k] > 8) est[k] = NaN
    }
  }
  // Filled in from the cells around, ring by ring.
  for (let pass = 0; pass < gw + gh; pass++) {
    const next = est.slice()
    let missing = 0
    for (let cy = 0; cy < gh; cy++) {
      for (let cx = 0; cx < gw; cx++) {
        const k = cy * gw + cx
        if (Number.isFinite(est[k])) continue
        let sum = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx
            const ny = cy + dy
            if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && Number.isFinite(est[ny * gw + nx])) {
              sum += est[ny * gw + nx]
              n++
            }
          }
        }
        if (n) next[k] = sum / n
        else missing++
      }
    }
    est.set(next)
    if (!missing) break
  }
  if (est.some((v) => !Number.isFinite(v))) return img
  // Smoothed: light changes slowly.
  for (let pass = 0; pass < 2; pass++) {
    const next = est.slice()
    for (let cy = 0; cy < gh; cy++) {
      for (let cx = 0; cx < gw; cx++) {
        let sum = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx
            const ny = cy + dy
            if (nx >= 0 && ny >= 0 && nx < gw && ny < gh) {
              sum += est[ny * gw + nx]
              n++
            }
          }
        }
        next[cy * gw + cx] = sum / n
      }
    }
    est.set(next)
  }
  const out = new Uint8Array(rgb.length)
  for (let y = 0; y < H; y++) {
    const gy = Math.min(gh - 1, Math.max(0, (y + 0.5) / S - 0.5))
    const y0 = Math.floor(gy)
    const y1 = Math.min(gh - 1, y0 + 1)
    const fy = gy - y0
    for (let x = 0; x < W; x++) {
      const gx = Math.min(gw - 1, Math.max(0, (x + 0.5) / S - 0.5))
      const x0 = Math.floor(gx)
      const x1 = Math.min(gw - 1, x0 + 1)
      const fx = gx - x0
      const lit = (est[y0 * gw + x0] * (1 - fx) + est[y0 * gw + x1] * fx) * (1 - fy) + (est[y1 * gw + x0] * (1 - fx) + est[y1 * gw + x1] * fx) * fy
      const f = Math.min(1.6, Math.max(0.85, paper / Math.max(1, lit)))
      const i = (y * W + x) * 3
      out[i] = Math.min(255, Math.round(rgb[i] * f))
      out[i + 1] = Math.min(255, Math.round(rgb[i + 1] * f))
      out[i + 2] = Math.min(255, Math.round(rgb[i + 2] * f))
    }
  }
  return { rgb: out, width: W, height: H }
}
