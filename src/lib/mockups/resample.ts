import type { Pixels } from "./sheet"

// Lanczos-3 resize as PIL's `Image.resize(..., LANCZOS)`: the kernel widens
// with the scale factor when shrinking, so thin lines fade instead of
// vanishing, and coefficients are normalised per output pixel.

export type Rect = { x: number; y: number; width: number; height: number }

export function resize(src: Pixels, crop: Rect, width: number, height: number): Pixels {
  const horizontal = coefficients(crop.x, crop.width, width)
  const vertical = coefficients(crop.y, crop.height, height)

  // Rows the vertical pass will read, then the horizontal pass over just those.
  const y0 = vertical.first
  const rows = vertical.last - y0
  const tmp = new Float32Array(width * rows * 4)
  for (let r = 0; r < rows; r++) {
    const line = (y0 + r) * src.width * 4
    for (let x = 0; x < width; x++) {
      const start = horizontal.start[x]
      const w = horizontal.weights[x]
      let a = 0, b = 0, c = 0, d = 0
      for (let k = 0; k < w.length; k++) {
        const i = line + (start + k) * 4
        a += w[k] * src.data[i]
        b += w[k] * src.data[i + 1]
        c += w[k] * src.data[i + 2]
        d += w[k] * src.data[i + 3]
      }
      const o = (r * width + x) * 4
      tmp[o] = a
      tmp[o + 1] = b
      tmp[o + 2] = c
      tmp[o + 3] = d
    }
  }

  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const start = vertical.start[y] - y0
    const w = vertical.weights[y]
    for (let x = 0; x < width; x++) {
      let a = 0, b = 0, c = 0, d = 0
      for (let k = 0; k < w.length; k++) {
        const i = ((start + k) * width + x) * 4
        a += w[k] * tmp[i]
        b += w[k] * tmp[i + 1]
        c += w[k] * tmp[i + 2]
        d += w[k] * tmp[i + 3]
      }
      const o = (y * width + x) * 4
      data[o] = Math.round(a)
      data[o + 1] = Math.round(b)
      data[o + 2] = Math.round(c)
      data[o + 3] = Math.round(d)
    }
  }
  return { data, width, height }
}

function lanczos(x: number) {
  if (x === 0) return 1
  if (x <= -3 || x >= 3) return 0
  const p = Math.PI * x
  return (3 * Math.sin(p) * Math.sin(p / 3)) / (p * p)
}

/** Per output pixel: first source index and normalised weights (PIL `precompute_coeffs`). */
function coefficients(offset: number, inSize: number, outSize: number) {
  const scale = inSize / outSize
  const filterScale = Math.max(scale, 1)
  const support = 3 * filterScale
  const start = new Int32Array(outSize)
  const weights: Float32Array[] = []
  let first = Infinity
  let last = 0
  for (let i = 0; i < outSize; i++) {
    const center = (i + 0.5) * scale
    const lo = Math.max(0, Math.floor(center - support + 0.5))
    const hi = Math.min(inSize, Math.floor(center + support + 0.5))
    const w = new Float32Array(hi - lo)
    let sum = 0
    for (let j = lo; j < hi; j++) sum += w[j - lo] = lanczos((j - center + 0.5) / filterScale)
    if (sum) for (let j = 0; j < w.length; j++) w[j] /= sum
    start[i] = offset + lo
    weights.push(w)
    first = Math.min(first, offset + lo)
    last = Math.max(last, offset + hi)
  }
  return { start, weights, first, last }
}
