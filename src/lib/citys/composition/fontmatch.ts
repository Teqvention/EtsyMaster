import sharp from "sharp"

import { inkOf, xHeightOf } from "./fit"
import { fontCatalog, loadFont } from "./fonts"
import type { Box } from "./measure"

// The font a poster's line is set in, found by setting it: the line's words
// in each likely Google Font (and the weights near the one it looks), each
// sized and spaced to fill the line's ink box exactly, drawn and laid over
// the original's pixels; the one that covers them best wins. Gemini names a
// font and its kind; this checks it against the alternatives of that kind.
// A line out of justified copy gets its width from its word spaces, not its
// letters, and its size from its x-height band where that was measured (a
// line of copy touching the next one loses its ascenders' tops). A poster
// out of a photo is softer than type drawn crisp: ours is
// softened as much as makes Gemini's guess most alike, for every candidate
// alike, so softness doesn't pass for weight.

export type FontKind = "serif" | "sans" | "condensed" | "slab" | "display" | "mono"

/** Likely fonts by kind: the free Google Fonts best-selling posters are set in, or look like. */
const CANDIDATES: Record<FontKind, string[]> = {
  serif: ["EB Garamond", "Cormorant Garamond", "Libre Baskerville", "Lora", "Crimson Pro", "Crimson Text", "Source Serif 4", "Merriweather", "PT Serif", "Spectral", "Noto Serif", "Gelasio", "Libre Caslon Text", "Cardo", "Tinos", "Playfair Display", "DM Serif Display", "Prata", "Bodoni Moda", "Alegreya", "Newsreader", "Literata"],
  sans: ["Inter", "Arimo", "Roboto", "Open Sans", "Lato", "Montserrat", "Work Sans", "Archivo", "DM Sans", "IBM Plex Sans", "Source Sans 3", "Nunito Sans", "Manrope", "Poppins", "Raleway", "Jost", "Mulish", "Karla", "Figtree", "Outfit", "Barlow", "Public Sans", "Inter Tight", "Hanken Grotesk", "Urbanist", "Plus Jakarta Sans", "Lexend", "Sora", "Albert Sans", "Red Hat Display", "Questrial", "Josefin Sans", "Kumbh Sans", "Space Grotesk"],
  condensed: ["Oswald", "Bebas Neue", "Barlow Condensed", "Archivo Narrow", "Roboto Condensed", "Antonio", "Anton", "League Gothic", "Fjalla One", "Saira Condensed", "Big Shoulders Display"],
  slab: ["Roboto Slab", "Zilla Slab", "Arvo", "Bitter", "Josefin Slab", "Crete Round"],
  display: ["Playfair Display", "DM Serif Display", "Abril Fatface", "Bodoni Moda", "Cinzel", "Prata", "Yeseva One", "Righteous", "Lobster"],
  mono: ["IBM Plex Mono", "Roboto Mono", "Space Mono", "JetBrains Mono", "Courier Prime"],
}

type Img = { rgb: Uint8Array; width: number; height: number }

/** The original's ink in a box as 0–1 (paper 0, the ink's colour 1). */
function inkMap(img: Img, box: Box, paper: number[], ink: number[]) {
  const w = box.x1 - box.x0
  const h = box.y1 - box.y0
  const out = new Float32Array(w * h)
  const span = Math.max(30, Math.abs((paper[0] + paper[1] + paper[2]) / 3 - (ink[0] + ink[1] + ink[2]) / 3))
  const paperLum = (paper[0] + paper[1] + paper[2]) / 3
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((box.y0 + y) * img.width + box.x0 + x) * 3
      const lum = (img.rgb[i] + img.rgb[i + 1] + img.rgb[i + 2]) / 3
      out[y * w + x] = Math.min(1, Math.max(0, Math.abs(paperLum - lum) / span))
    }
  }
  return out
}

/** A map softened by a pixel ([1 2 1] each way). */
function soften(map: Float32Array, w: number, h: number) {
  const across = new Float32Array(map.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      across[i] = (2 * map[i] + map[x > 0 ? i - 1 : i] + map[x < w - 1 ? i + 1 : i]) / 4
    }
  }
  const out = new Float32Array(map.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      out[i] = (2 * across[i] + across[y > 0 ? i - w : i] + across[y < h - 1 ? i + w : i]) / 4
    }
  }
  return out
}

type Core = { y0: number; y1: number }

/**
 * A line set in `family` to fill `ink` exactly, drawn over `area` as 0–1:
 * its size from its ink's height, or from its x-height band (`core`, its
 * baseline at the band's foot); its width from letter spacing, or
 * (`spaced`, a line of justified copy) from its word spaces.
 */
async function drawn(family: string, weight: number, italic: boolean, text: string, ink: Box, area: Box, spaced: boolean, core?: Core, letters = 0) {
  const font = await loadFont({ family, weight, italic })
  const tall = inkOf(font, text, 1000, 0)
  const size = core ? (core.y1 - core.y0) / xHeightOf(font) : (1000 * (ink.y1 - ink.y0)) / Math.max(1, tall.y2 - tall.y1)
  const words = text.split(/\s+/).filter(Boolean)
  let d: string
  let tracking = 0
  if (spaced && words.length > 1) {
    // Its letters spaced as the copy's are (`letters`), the extra width shared by the spaces between words.
    // Justified copy only stretches them: a font that needs them squeezed is too wide for these words.
    const plain = inkOf(font, text, size, letters)
    const extra = ink.x1 - ink.x0 - (plain.x2 - plain.x1)
    const space = font.getAdvanceWidth(" ", size, { kerning: false, tracking: letters })
    const gap = space + extra / (words.length - 1)
    if (gap < space * 0.75) return null
    let x = ink.x0 - plain.x1 - area.x0
    const baseline = core ? core.y1 - area.y0 : ink.y0 - plain.y1 - area.y0
    const parts: string[] = []
    for (const word of words) {
      parts.push(font.getPath(word, x, baseline, size, { kerning: true, tracking: letters }).toPathData(2))
      x += font.getAdvanceWidth(word, size, { kerning: true, tracking: letters }) - (letters / 1000) * size + gap
    }
    d = parts.join("")
    tracking = letters
  } else {
    const plain = inkOf(font, text, size, 0)
    const extra = ink.x1 - ink.x0 - (plain.x2 - plain.x1)
    const glyphs = [...text].length
    tracking = glyphs > 1 ? (extra * 1000) / (size * (glyphs - 1)) : 0
    if (tracking < -150 || tracking > 1000) return null
    const set = inkOf(font, text, size, tracking)
    d = font.getPath(text, ink.x0 - set.x1 - area.x0, core ? core.y1 - area.y0 : ink.y0 - set.y1 - area.y0, size, { kerning: true, tracking }).toPathData(2)
  }
  const w = area.x1 - area.x0
  const h = area.y1 - area.y0
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
  const { data } = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: true })
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = 1 - data[i] / 255
  return { map: out, w, h, tracking }
}

const softened = (map: Float32Array, w: number, h: number, times: number) => {
  let out = map
  for (let i = 0; i < times; i++) out = soften(out, w, h)
  return out
}

/** How alike two ink maps are: 1 less their mean difference where either has ink. */
function likeness(a: Float32Array, b: Float32Array) {
  let diff = 0
  let weight = 0
  for (let i = 0; i < a.length; i++) {
    const m = Math.max(a[i], b[i])
    if (m < 0.05) continue
    diff += Math.abs(a[i] - b[i])
    weight += m
  }
  return weight ? 1 - diff / weight : 0
}

/** A line of the original to match: its words, its ink box, and (copy) its x-height band. */
export type Sample = { text: string; ink: Box; core?: Core }

/** Where a sample is compared: its ink box padded, or for copy from its ascenders' height to its descenders'. */
function areaOf(img: Img, { ink, core }: Sample): Box {
  const pad = Math.max(2, Math.round((ink.y1 - ink.y0) * 0.15))
  const xh = core ? core.y1 - core.y0 : 0
  return core
    ? { x0: Math.max(0, ink.x0 - pad), y0: Math.max(0, Math.floor(core.y0 - 1.1 * xh)), x1: Math.min(img.width, ink.x1 + pad), y1: Math.min(img.height, Math.ceil(core.y1 + 0.75 * xh)) }
    : { x0: Math.max(0, ink.x0 - pad), y0: Math.max(0, ink.y0 - pad), x1: Math.min(img.width, ink.x1 + pad), y1: Math.min(img.height, ink.y1 + pad) }
}

/**
 * The font (family, weight, italic) that sets the samples most like the
 * original's lines (their likeness averaged): Gemini's guess first, then
 * the other fonts of its kind, at the weights near its; with its likeness
 * (0–1). `spaced`: the lines are out of justified copy (their width is in
 * their word spaces). `fits`: all of the copy's printed lines, its
 * column's width and its x-height; a font any line of them doesn't fit at
 * the size that x-height gives is passed over, as its lines would wrap.
 */
export async function matchFont(
  img: Img,
  samples: Sample[],
  guess: { family: string; weight: number; italic: boolean },
  kind: FontKind,
  paper: number[],
  inkColor: number[],
  spaced = false,
  fits?: { lines: string[]; width: number; xHeight: number }
): Promise<{ family: string; weight: number; italic: boolean; likeness: number; tracking: number }> {
  const lines = samples.filter((sample) => sample.text.trim() && sample.ink.x1 > sample.ink.x0 && sample.ink.y1 > sample.ink.y0)
  const copy = lines.some((line) => line.core)
  const areas = lines.map((line) => areaOf(img, line))
  const theirs = lines.map((_, i) => inkMap(img, areas[i], paper, inkColor))
  const catalog = await fontCatalog().catch(() => [])
  const weightsOf = (family: string) => catalog.find((f) => f.family.toLowerCase() === family.toLowerCase())?.weights ?? [400, 700]
  const families = [guess.family, ...CANDIDATES[kind].filter((f) => f.toLowerCase() !== guess.family.toLowerCase())]
  let best = { ...guess, likeness: -1, tracking: 0 }
  if (!lines.length) return best
  // How soft the original is: the softening that makes Gemini's guess most alike (on the first line).
  let soft = 0
  const reference = await drawn(guess.family, guess.weight, guess.italic, lines[0].text, lines[0].ink, areas[0], spaced, lines[0].core).catch(() => null)
  if (reference) {
    let top = -1
    for (let times = 0; times <= 4; times++) {
      const l = likeness(theirs[0], softened(reference.map, reference.w, reference.h, times))
      if (l > top) {
        top = l
        soft = times
      }
    }
  }
  for (const family of families) {
    const weights = weightsOf(family)
    if (!weights.length) continue
    // The weights nearest the one it looks: three of them, near it. A photo of a print makes type look
    // heavier than it is set; body text's weight, regular or bold, is plain to see, so it stays within a step.
    const reach = copy ? 100 : 200
    const near = [...weights]
      .filter((w) => Math.abs(w - guess.weight) <= reach)
      .sort((a, b) => Math.abs(a - guess.weight) - Math.abs(b - guess.weight))
      .slice(0, 3)
    for (const weight of near) {
      // The letter spacing every printed line fits its column at (none, when they fit as set): copy
      // set tight is common; a font that needs it squeezed hard is likely too wide, and counts for less.
      let letters = 0
      let squeeze = 1
      if (fits) {
        const font = await loadFont({ family, weight, italic: guess.italic }).catch(() => null)
        if (!font) continue
        const size = fits.xHeight / xHeightOf(font)
        const space = font.getAdvanceWidth(" ", size, { kerning: false })
        let most = Infinity
        for (const line of fits.lines) {
          // As the renderer breaks lines: its words' widths and a plain space between them.
          const words = line.split(/\s+/).filter(Boolean)
          const natural = words.reduce((sum, word, i) => sum + font.getAdvanceWidth(word, size, { kerning: true }) + (i ? space : 0), 0)
          const steps = [...line].length - 1
          if (steps > 0) most = Math.min(most, ((fits.width - 1 - natural) * 1000) / (size * steps))
        }
        if (most < -180) continue
        letters = most < 0 ? Math.floor(most) : 0
        if (most < -60) squeeze = Math.max(0.5, 1 - (-60 - most) / 200)
      }
      let sum = 0
      let counted = 0
      for (let i = 0; i < lines.length; i++) {
        const set = await drawn(family, weight, guess.italic, lines[i].text, lines[i].ink, areas[i], spaced, lines[i].core, letters).catch(() => null)
        if (!set) continue
        sum += likeness(theirs[i], softened(set.map, set.w, set.h, soft))
        counted++
      }
      if (counted < lines.length) continue
      const l = (sum / counted) * squeeze
      if (l > best.likeness) best = { family, weight, italic: guess.italic, likeness: l, tracking: letters }
    }
  }
  return best
}
