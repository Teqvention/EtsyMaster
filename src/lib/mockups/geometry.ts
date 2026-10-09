import type { Point, Quad } from "./types"

/** 3×3 homography, row-major, h[8] = 1. */
export type Homography = number[]

/** Homography mapping the four `from` points onto the four `to` points. */
export function homography(from: Point[], to: Point[]): Homography {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]
    const [u, v] = to[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(u, v)
  }
  return [...solve(A, b), 1]
}

export function apply(h: Homography, x: number, y: number): Point {
  const w = h[6] * x + h[7] * y + h[8]
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]
}

/** Gaussian elimination with partial pivoting (8×8 is all we need). */
function solve(A: number[][], b: number[]) {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array<number>(n)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x
}

export function rectQuad(w: number, h: number): Quad {
  return [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]
}

/** The quad scaled about its centroid, e.g. 0.008 → 0.8 % larger. */
export function grow(quad: Quad, amount: number): Quad {
  const cx = quad.reduce((s, p) => s + p[0], 0) / 4
  const cy = quad.reduce((s, p) => s + p[1], 0) / 4
  const f = 1 + amount
  return quad.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]) as Quad
}

/** Size of the upright rectangle a quad is unwarped to (width = longer horizontal edge). */
export function sheetSize(quad: Quad, aspect = 1.4) {
  const w = Math.round(
    Math.max(quad[1][0] - quad[0][0], quad[2][0] - quad[3][0])
  )
  return { width: w, height: Math.round(w * aspect) }
}

/** Height / width of the quad measured along its edges. */
export function quadAspect(quad: Quad) {
  const d = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const w = (d(quad[0], quad[1]) + d(quad[3], quad[2])) / 2
  const h = (d(quad[0], quad[3]) + d(quad[1], quad[2])) / 2
  return h / w
}

/** Centre-crop rectangle of a w×h image to height/width = aspect (never squash). */
export function coverCrop(w: number, h: number, aspect: number) {
  if (h / w > aspect) {
    const nh = Math.round(w * aspect)
    return { x: 0, y: Math.floor((h - nh) / 2), width: w, height: nh }
  }
  const nw = Math.round(h / aspect)
  return { x: Math.floor((w - nw) / 2), y: 0, width: nw, height: h }
}
