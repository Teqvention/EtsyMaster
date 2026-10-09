import { apply, homography, rectQuad, sheetSize } from "./geometry"
import type { Quad } from "./types"

// Light and glass reflection from the blank white sheet in an AI room — a
// port of `rahmenglas` as described in ANLEITUNG-FUER-KI.md § 3 Weg B:
//   1. unwarp the sheet to an upright rectangle (width × 1.4)
//   2. light = grey opening (16 % of the width) + Gaussian (σ 6 %),
//      reflection = sheet − light
//   3. flat field: light × (median(broad) / broad)^flat, broad = σ 25 %
//   4. white balance on the 97th percentile, capped at 1
// Pure and synchronous so it runs in a worker or in Node alike.

export type Pixels = { data: Uint8ClampedArray; width: number; height: number }

export type SheetResult = {
  width: number
  height: number
  /** Multiply layer: 255 = full light. */
  light: Uint8ClampedArray
  /** Add layer at `shine` opacity. */
  shine: Uint8ClampedArray
}

export function extractSheet(
  room: Pixels,
  quad: Quad,
  { flat = 0.7, aspect = 1.4 }: { flat?: number; aspect?: number } = {}
): SheetResult {
  const { width: bw, height: bh } = sheetSize(quad, aspect)
  const n = bw * bh
  const sheet = unwarp(room, quad, bw, bh)

  const f = Math.max(3, Math.round(0.16 * bw) | 1)
  const light: Float32Array[] = []
  const shine = new Uint8ClampedArray(n * 4)
  for (let c = 0; c < 3; c++) {
    const ch = sheet[c]
    const l = gaussian(dilate(erode(ch, bw, bh, f), bw, bh, f), bw, bh, 0.06 * bw)
    for (let i = 0; i < n; i++) shine[i * 4 + c] = Math.round(Math.max(0, ch[i] - l[i]))
    light.push(l)
  }

  const broad = light.map((l) => gaussian(l, bw, bh, 0.25 * Math.min(bw, bh)))
  const median = percentile(concat(broad), 50)
  for (let c = 0; c < 3; c++) {
    const l = light[c]
    const g = broad[c]
    for (let i = 0; i < n; i++) l[i] = (l[i] / 255) * (median / Math.max(g[i], 1e-3)) ** flat
  }
  const white = Math.max(percentile(concat(light), 97), 0.15)

  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(Math.min(light[c][i] / white, 1) * 255)
    out[i * 4 + 3] = 255
    shine[i * 4 + 3] = 255
  }
  return { width: bw, height: bh, light: out, shine }
}

/** Sheet → upright rectangle, bicubic, one Float32Array per channel. */
function unwarp(room: Pixels, quad: Quad, w: number, h: number) {
  const H = homography(rectQuad(w, h), quad)
  const out = [0, 1, 2].map(() => new Float32Array(w * h))
  const { data, width: W, height: Hh } = room
  const px = (x: number, y: number, c: number) =>
    data[(Math.min(Hh - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4 + c]
  const wx = [0, 0, 0, 0]
  const wy = [0, 0, 0, 0]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = apply(H, x + 0.5, y + 0.5)
      const fx = sx - 0.5
      const fy = sy - 0.5
      const ix = Math.floor(fx)
      const iy = Math.floor(fy)
      cubic(fx - ix, wx)
      cubic(fy - iy, wy)
      for (let c = 0; c < 3; c++) {
        let s = 0
        for (let j = 0; j < 4; j++) {
          let r = 0
          for (let i = 0; i < 4; i++) r += wx[i] * px(ix - 1 + i, iy - 1 + j, c)
          s += wy[j] * r
        }
        out[c][y * w + x] = Math.min(255, Math.max(0, s))
      }
    }
  }
  return out
}

/** Bicubic weights, a = −0.5 (as PIL). */
function cubic(t: number, w: number[]) {
  const a = -0.5
  const k = (d: number) => {
    d = Math.abs(d)
    if (d <= 1) return ((a + 2) * d - (a + 3)) * d * d + 1
    if (d < 2) return ((a * d - 5 * a) * d + 8 * a) * d - 4 * a
    return 0
  }
  w[0] = k(t + 1)
  w[1] = k(t)
  w[2] = k(1 - t)
  w[3] = k(2 - t)
}

const erode = (a: Float32Array, w: number, h: number, size: number) =>
  morph(a, w, h, size, Math.min)
const dilate = (a: Float32Array, w: number, h: number, size: number) =>
  morph(a, w, h, size, Math.max)

/** Separable size×size min/max filter, edges extended (scipy `nearest`). */
function morph(
  a: Float32Array,
  w: number,
  h: number,
  size: number,
  pick: (x: number, y: number) => number
) {
  const tmp = new Float32Array(a.length)
  const out = new Float32Array(a.length)
  const r = size >> 1
  const line = (src: Float32Array, dst: Float32Array, len: number, at: (i: number) => number) => {
    // van Herk / Gil-Werman: running extremes forward and backward in blocks.
    const padded = len + 2 * r
    const v = new Float32Array(padded)
    for (let i = 0; i < padded; i++) v[i] = src[at(Math.min(len - 1, Math.max(0, i - r)))]
    const g = new Float32Array(padded)
    const hh = new Float32Array(padded)
    for (let i = 0; i < padded; i++) g[i] = i % size === 0 ? v[i] : pick(g[i - 1], v[i])
    for (let i = padded - 1; i >= 0; i--)
      hh[i] = i === padded - 1 || (i + 1) % size === 0 ? v[i] : pick(hh[i + 1], v[i])
    for (let i = 0; i < len; i++) dst[at(i)] = pick(hh[i], g[i + size - 1])
  }
  for (let y = 0; y < h; y++) line(a, tmp, w, (i) => y * w + i)
  for (let x = 0; x < w; x++) line(tmp, out, h, (i) => i * w + x)
  return out
}

/** Separable Gaussian, truncated at 4σ, edges extended. Large σ runs on a reduced grid. */
function gaussian(a: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const k = Math.max(1, Math.ceil(sigma / 48))
  if (k > 1) {
    const sw = Math.ceil(w / k)
    const sh = Math.ceil(h / k)
    const small = new Float32Array(sw * sh)
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        let s = 0
        let c = 0
        for (let j = y * k; j < Math.min(h, (y + 1) * k); j++)
          for (let i = x * k; i < Math.min(w, (x + 1) * k); i++) {
            s += a[j * w + i]
            c++
          }
        small[y * sw + x] = s / c
      }
    const blurred = gaussian(small, sw, sh, sigma / k)
    const out = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / k - 0.5))
      const y0 = Math.floor(fy)
      const y1 = Math.min(sh - 1, y0 + 1)
      const ty = fy - y0
      for (let x = 0; x < w; x++) {
        const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / k - 0.5))
        const x0 = Math.floor(fx)
        const x1 = Math.min(sw - 1, x0 + 1)
        const tx = fx - x0
        const top = blurred[y0 * sw + x0] * (1 - tx) + blurred[y0 * sw + x1] * tx
        const bottom = blurred[y1 * sw + x0] * (1 - tx) + blurred[y1 * sw + x1] * tx
        out[y * w + x] = top * (1 - ty) + bottom * ty
      }
    }
    return out
  }
  const r = Math.floor(4 * sigma + 0.5)
  const kernel = new Float32Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) sum += kernel[i + r] = Math.exp((-i * i) / (2 * sigma * sigma))
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum
  const tmp = new Float32Array(a.length)
  const out = new Float32Array(a.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += kernel[i + r] * a[y * w + Math.min(w - 1, Math.max(0, x + i))]
      tmp[y * w + x] = s
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += kernel[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x]
      out[y * w + x] = s
    }
  return out
}

function concat(parts: Float32Array[]) {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** numpy-style percentile with linear interpolation. */
function percentile(values: Float32Array, q: number) {
  const s = Float32Array.from(values).sort()
  const pos = (q / 100) * (s.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.min(s.length - 1, lo + 1)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}
