import { createHash } from "node:crypto"

import sharp from "sharp"

import { BLEED_MM, MAX_DPI, OFFERED_KEYS, PRINT_DPI, SIZES, type Orientation, type SizeKey } from "@/lib/catalog/sizes"
import { writeFileUnder } from "@/lib/pipeline/files"
import type { PrintFile } from "@/lib/pipeline/types"

import { loadFonts } from "./fonts"
import { CANVAS, layoutAt, type CompositionData, type PhotoElement, type PlaceFacts } from "./model"
import { DEFAULT_PALETTE, fontsOf, renderSvg, type Palette, type PhotoInput } from "./render"

// Compositions to pixels on the server: previews, the poster image the
// mockups show, and one print file per size. The SVG is drawn by
// renderSvg (as in the editor), the photo set into it at exactly the size
// its frame has in pixels, so nothing is scaled twice; colours a layout
// takes from the photo are read off it here.

/** The colours a layout can take from a photo: its main, brightest, softest, darkest and lightest. */
export async function photoPalette(image: Buffer): Promise<Palette> {
  const { data } = await sharp(image).resize(48, 48, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const pixels: [number, number, number][] = []
  for (let i = 0; i < data.length; i += 3) pixels.push([data[i], data[i + 1], data[i + 2]])
  // A few rounds of k-means: enough to find the photo's main colour groups.
  let centres = [0, 0.2, 0.4, 0.6, 0.8].map((t) => pixels[Math.floor(t * (pixels.length - 1))])
  let groups: [number, number, number][][] = []
  for (let round = 0; round < 8; round++) {
    groups = centres.map(() => [])
    for (const p of pixels) {
      let best = 0
      let bestD = Infinity
      centres.forEach((c, i) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2
        if (d < bestD) {
          bestD = d
          best = i
        }
      })
      groups[best].push(p)
    }
    centres = groups.map((g, i) => (g.length ? (g.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v / g.length) as [number, number, number]) : centres[i]))
  }
  const stats = centres.map((c, i) => {
    const max = Math.max(...c) / 255
    const min = Math.min(...c) / 255
    const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
    return { c, size: groups[i].length, sat: max === 0 ? 0 : (max - min) / max, lum }
  })
  const hex = (c: number[]) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase()
  const by = <T,>(list: T[], score: (t: T) => number) => list.reduce((a, b) => (score(b) > score(a) ? b : a))
  return {
    dominant: hex(by(stats, (s) => s.size).c),
    vibrant: hex(by(stats, (s) => s.sat * (1 - Math.abs(s.lum - 0.55))).c),
    muted: hex(by(stats, (s) => (1 - s.sat) * (1 - Math.abs(s.lum - 0.6))).c),
    dark: hex(darken(by(stats, (s) => -s.lum).c, 0.85)),
    light: hex(lighten(by(stats, (s) => s.lum).c, 0.9)),
  }
}

const darken = (c: number[], k: number) => c.map((v) => v * k)
const lighten = (c: number[], k: number) => c.map((v) => 255 - (255 - v) * k)

/** The photo cut to a frame's shape around its focus, at `px` wide: what the SVG shows at 1:1. */
async function framePhoto(photo: Buffer, el: PhotoElement, scale: number) {
  const width = Math.max(1, Math.round(el.w * scale))
  const height = Math.max(1, Math.round(el.h * scale))
  const meta = await sharp(photo).rotate().metadata()
  const iw = meta.width!
  const ih = meta.height!
  const cover = Math.max(width / iw, height / ih)
  const rw = Math.ceil(iw * cover)
  const rh = Math.ceil(ih * cover)
  const left = Math.round((rw - width) * el.focusX)
  const top = Math.round((rh - height) * el.focusY)
  const data = await sharp(photo).rotate().resize(rw, rh, { kernel: "lanczos3" }).extract({ left: Math.min(left, rw - width), top: Math.min(top, rh - height), width, height }).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer()
  return { href: `data:image/jpeg;base64,${data.toString("base64")}`, width, height }
}

export type RenderRequest = {
  data: CompositionData
  ratio?: number
  size?: SizeKey
  facts: PlaceFacts
  photo: Buffer | null
  /** Output width in pixels. */
  width: number
  palette?: Palette
}

/** The composition as an image (sRGB, no alpha). */
export async function renderComposition({ data, ratio = data.ratio, size, facts, photo, width, palette }: RenderRequest) {
  const fonts = await loadFonts(fontsOf(data))
  const scale = width / CANVAS
  const frames = layoutAt(data, ratio, size).filter((e): e is PhotoElement => e.type === "photo" && !e.hidden)
  let input: PhotoInput = null
  if (photo && frames.length === 1) input = await framePhoto(photo, frames[0], scale)
  else if (photo && frames.length > 1) {
    const big = await sharp(photo).rotate().resize(Math.round(width), Math.round(width), { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true })
    input = { href: `data:image/jpeg;base64,${big.data.toString("base64")}`, width: big.info.width, height: big.info.height }
  }
  const colors = palette ?? (photo ? await photoPalette(photo) : DEFAULT_PALETTE)
  // A single frame was cut to its own shape: drawn at 1:1, the cover maths lands exactly on it.
  const drawData = frames.length === 1 && input ? { ...data, elements: data.elements.map((e) => (e.id === frames[0].id ? { ...e, focusX: 0.5, focusY: 0.5 } : e)) } : data
  const { svg } = renderSvg({ data: drawData, ratio, size, facts, fonts, photo: input, palette: colors, width })
  return sharp(Buffer.from(svg)).flatten({ background: "#ffffff" }).toColourspace("srgb")
}

/** A JPEG preview, `width` pixels wide. */
export async function previewJpeg(request: Omit<RenderRequest, "width"> & { width?: number }) {
  return (await renderComposition({ ...request, width: request.width ?? 900 })).jpeg({ quality: 88 }).toBuffer()
}

/**
 * Print files: the composition drawn at each size's own shape, as sharp as
 * the photo allows between Gelato's minimum and what's worth printing, with
 * Gelato's bleed mirrored around it (as pipeline/print.ts does).
 */
export async function compositionPrintFiles(
  request: Omit<RenderRequest, "width" | "ratio" | "size">,
  orientation: Orientation,
  dir: string,
  sizes: SizeKey[] = [...OFFERED_KEYS]
): Promise<PrintFile[]> {
  const files: PrintFile[] = []
  const photoWidth = request.photo ? ((await sharp(request.photo).metadata()).width ?? 0) : 0
  const frame = request.data.elements.find((e): e is PhotoElement => e.type === "photo")
  const colors = request.palette ?? (request.photo ? await photoPalette(request.photo) : DEFAULT_PALETTE)
  for (const size of SIZES.filter((s) => sizes.includes(s.key))) {
    const [widthMm, heightMm] = orientation === "hor" ? [size.heightMm, size.widthMm] : [size.widthMm, size.heightMm]
    // The photo's own pixels across its frame, held between Gelato's minimum and what's worth printing.
    const frameMm = frame ? (frame.w / CANVAS) * widthMm : widthMm
    const own = photoWidth && frameMm ? photoWidth / (frameMm / 25.4) : PRINT_DPI
    const dpi = Math.round(Math.min(MAX_DPI, Math.max(PRINT_DPI, own)))
    const px = (mm: number) => Math.round((mm / 25.4) * dpi)
    const bleed = px(BLEED_MM)
    const image = await renderComposition({ ...request, ratio: widthMm / heightMm, size: size.key, width: px(widthMm), palette: colors })
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
    const jpeg = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .extend({ top: bleed, bottom: bleed, left: bleed, right: bleed, extendWith: "mirror" })
      .withMetadata({ density: dpi })
      .withIccProfile("srgb")
      .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
      .toBuffer()
    const file = `${dir}/${size.key}.jpg`
    await writeFileUnder(file, jpeg)
    files.push({
      bandId: size.key,
      sizes: [size.key],
      file,
      url: null,
      sha: createHash("sha256").update(jpeg).digest("hex").slice(0, 16),
      width: info.width + 2 * bleed,
      height: info.height + 2 * bleed,
      fit: "exact",
    })
  }
  return files
}
