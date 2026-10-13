import sharp from "sharp"

import { getFile } from "@/lib/storage/files"
import { fileKey as styleFileKey, getStyle } from "@/lib/styles/storage"

import { readSetFile } from "./storage"
import type { GenerationSet, Output } from "./types"

// Nano Banana paints too smoothly: flat fills without grain, razor-clean
// edges, flawless gradients — next to the originals (photos of printed
// posters) its pictures read as made by a machine (Robin, 13 Oct: "alles so
// glatt"). Measured in the flat areas at 1024 px tall, ours had a half to a
// third of the originals' fine grain, and a photo's sky a third of their
// mid-scale texture. So every painted poster gets the texture of what it
// was painted after: its edges softened a touch, film grain or paper tooth
// up to the original's level, and for art the slightly uneven, mottled
// colour of real paint. Capped, so a noisy photo of a framed print doesn't
// make a noisy poster; for photos grain only (mottling looked like dirt in a
// sky).

/** Measured at this height, so grain sizes compare whatever the resolution. */
const MEASURE = 1024
/** At most this much fine grain and mottling (median deviation, 0–255): beyond it, texture turns into noise. */
const CAP = { fine: 2.2, mid: 3.5 }
/** Below this the difference doesn't show. */
const ENOUGH = 0.15

export type Texture = { fine: number; mid: number }

/** How much fine grain and mid-scale unevenness an image has in its flat areas. */
export async function textureOf(image: Buffer): Promise<Texture> {
  const { data, info } = await sharp(image)
    .rotate()
    .resize({ height: MEASURE })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return measure(Float32Array.from(data), info.width, info.height)
}

function measure(g: Float32Array, w: number, h: number): Texture {
  const b12 = blur(g, w, h, 1.2)
  const b15 = blur(g, w, h, 1.5)
  const b8 = blur(g, w, h, 8)
  // Texture lives in the fills: leave the 40 % strongest edges out.
  const edge = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      edge[i] = Math.hypot(b15[i + 1] - b15[i - 1], b15[i + w] - b15[i - w])
    }
  }
  const step = 3
  const sample: number[] = []
  for (let i = 0; i < edge.length; i += step) sample.push(edge[i])
  const limit = quantile(sample, 0.6)
  const fine: number[] = []
  const mid: number[] = []
  for (let i = 0; i < g.length; i += step) {
    if (edge[i] >= limit) continue
    fine.push(g[i] - b12[i])
    mid.push(b15[i] - b8[i])
  }
  return { fine: deviation(fine), mid: deviation(mid) }
}

/**
 * `image` with the grain and mottling of `like`, its edges a touch softer;
 * JPEG. The full-size work (noise, blur, blending) is sharp's, off the event
 * loop; only measuring at 1024 px runs here.
 */
export async function withTexture(image: Buffer, like: Texture, photo: boolean): Promise<Buffer> {
  const { height: h0 = 0 } = await sharp(image).metadata()
  const scale = h0 / MEASURE
  // 1. A touch softer: digital edges are sharper than paint or a lens.
  const soft = await sharp(image)
    .rotate()
    .removeAlpha()
    .blur(Math.max(0.3, (photo ? 0.25 : 0.45) * scale))
    .raw()
    .toBuffer({ resolveWithObject: true })
  const raw = { width: soft.info.width, height: soft.info.height, channels: 3 as const }
  const target = { fine: Math.min(like.fine, CAP.fine), mid: Math.min(like.mid, CAP.mid) }
  let current: Buffer = soft.data
  let now = await measureRaw(current, raw)

  // Soft-light over mid grey: a layer of noise darkens and lightens like grain
  // in the mid tones and leaves the extremes; its strength is found by trying.
  const blend = async (layer: (sigma: number) => Promise<Buffer>, kind: keyof Texture, cap: number) => {
    const trial = 30
    const tried = await softLight(current, raw, await layer(trial))
    const after = (await measureRaw(tried, raw))[kind]
    const gain = Math.sqrt(Math.max(1e-6, after ** 2 - now[kind] ** 2)) / trial
    const sigma = Math.min(cap, Math.sqrt(Math.max(0, target[kind] ** 2 - now[kind] ** 2)) / gain)
    current = await softLight(current, raw, await layer(sigma))
    now = await measureRaw(current, raw)
  }

  // 2. Grain: luminance noise a little soft, the size of film grain or paper tooth.
  if (target.fine - now.fine > ENOUGH) {
    await blend(
      (sigma) =>
        sharp({ create: { ...raw, background: "#808080", noise: { type: "gaussian", mean: 128, sigma } } })
          .greyscale()
          .blur(Math.max(0.3, 0.55 * scale))
          .raw()
          .toBuffer(),
      "fine",
      90
    )
  }

  // 3. Art only: the uneven, slightly mottled colour of real paint.
  if (!photo && target.mid - now.mid > ENOUGH) {
    const cell = 16
    await blend(
      (sigma) =>
        sharp({
          create: {
            width: Math.ceil(raw.width / cell) + 2,
            height: Math.ceil(raw.height / cell) + 2,
            channels: 3,
            background: "#808080",
            noise: { type: "gaussian", mean: 128, sigma },
          },
        })
          .greyscale()
          .blur(1)
          .resize(raw.width, raw.height, { kernel: "cubic", fit: "fill" })
          .raw()
          .toBuffer(),
      "mid",
      70
    )
  }

  // Nearly lossless: it's stored as JPEG once more.
  return sharp(current, { raw }).jpeg({ quality: 97 }).toBuffer()
}

type Raw = { width: number; height: number; channels: 3 }

/** `layer` (one grey channel around mid grey) soft-lit over `base`. */
async function softLight(base: Buffer, raw: Raw, layer: Buffer) {
  return sharp(base, { raw })
    .composite([{ input: layer, raw: { width: raw.width, height: raw.height, channels: 1 }, blend: "soft-light" }])
    .removeAlpha()
    .raw()
    .toBuffer()
}

async function measureRaw(rgb: Buffer, raw: Raw) {
  const small = await sharp(rgb, { raw }).resize({ height: MEASURE }).greyscale().raw().toBuffer({ resolveWithObject: true })
  return measure(Float32Array.from(small.data), small.info.width, small.info.height)
}

// --- What to match ---

const memo = new Map<string, Promise<Texture | null>>()

/** Texturing a 2K poster holds a few hundred MB for a second or two: two at a time, however many come in at once. */
const PARALLEL = 2
const turns: { running: number; waiting: (() => void)[] } = { running: 0, waiting: [] }
async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (turns.running >= PARALLEL) await new Promise<void>((go) => turns.waiting.push(go))
  turns.running++
  try {
    return await work()
  } finally {
    turns.running--
    turns.waiting.shift()?.()
  }
}

/**
 * The painted `image` of `output` with the texture of what it was painted
 * after: its saved style's first image, or the set's poster it took after
 * (the anchor, for Autonomous scale). Mockups, and anything that can't be
 * read, come back as they are.
 */
export async function textured(set: GenerationSet, output: Output, image: Buffer): Promise<Buffer> {
  if (set.kind !== "poster") return image
  try {
    const source = await sourceOf(set, output)
    if (!source) return image
    let measured = memo.get(source.key)
    if (!measured) {
      measured = source.read().then(textureOf).catch(() => null)
      memo.set(source.key, measured)
      if (memo.size > 400) memo.delete(memo.keys().next().value!)
    }
    const like = await measured
    if (!like) return image
    return await inTurn(() => withTexture(image, like, source.photo))
  } catch (error) {
    console.error(`Generation ${set.id}, texture of ${output.id}:`, error)
    return image
  }
}

async function sourceOf(set: GenerationSet, output: Output) {
  const poster = set.posters.find((p) => p.index === output.poster && p.file) ?? set.posters.find((p) => p.file)
  const styleId = output.city?.styleId ?? (output.mode === "variant" ? output.styleId : null)
  if (styleId) {
    const style = await getStyle(styleId).catch(() => null)
    const first = style?.images[0]
    if (style && first) {
      return {
        key: `style/${styleId}/${first.file}`,
        read: () => getFile(styleFileKey(styleId, first.file)),
        photo: style.city?.medium === "photo",
      }
    }
  }
  if (!poster) return null
  const medium = output.city?.medium ?? set.city?.read?.medium
  const photo = medium ? medium === "photo" : /\bphotograph/i.test(poster.analysis?.style ?? "")
  return { key: `set/${set.id}/${poster.file}`, read: () => readSetFile(set.id, poster.file!), photo }
}

// --- Numbers ---

function blur(src: Float32Array, w: number, h: number, sigma: number) {
  const radius = Math.max(1, Math.ceil(sigma * 3))
  const kernel = new Float32Array(radius * 2 + 1)
  let sum = 0
  for (let i = -radius; i <= radius; i++) sum += kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma))
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let k = -radius; k <= radius; k++) v += kernel[k + radius] * src[row + Math.min(w - 1, Math.max(0, x + k))]
      tmp[row + x] = v
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let k = -radius; k <= radius; k++) v += kernel[k + radius] * tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]
      out[y * w + x] = v
    }
  }
  return out
}



function quantile(values: number[], q: number) {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
}

/** Median absolute deviation as a standard deviation: robust to the odd stroke. */
function deviation(values: number[]) {
  if (!values.length) return 0
  const median = quantile(values, 0.5)
  return quantile(values.map((v) => Math.abs(v - median)), 0.5) / 0.6745
}
