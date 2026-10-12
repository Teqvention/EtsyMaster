import type { Font } from "opentype.js"

import type { SizeKey } from "@/lib/catalog/sizes"

import {
  applyCase,
  CANVAS,
  fillText,
  heightOf,
  layoutAt,
  type Color,
  type CompositionData,
  type CompositionElement,
  type IconName,
  type PhotoRole,
  type PlaceFacts,
  type TextElement,
} from "./model"

// A composition drawn as SVG, the same in the editor and in print files.
// Text is set here, glyph by glyph, from the font files themselves
// (opentype.js): line breaks, kerning, letter spacing, justified columns and
// shrinking a long name to fit, then drawn as outlines, so no browser or
// print renderer ever substitutes a font or breaks a line differently.

export type Fonts = Map<string, Font>
export const fontKey = (f: TextElement["font"]) => `${f.family}|${f.weight}|${f.italic ? 1 : 0}`

/** The photo to set in the photo frames: its address (or data URI) and size in pixels. */
export type PhotoInput = { href: string; width: number; height: number } | null

export type Palette = Record<PhotoRole, string>

export const DEFAULT_PALETTE: Palette = { dominant: "#3B7A8C", vibrant: "#E07A3F", muted: "#9DB4B8", dark: "#1F2A30", light: "#F4F1EA" }

export type RenderInput = {
  data: CompositionData
  /** Width ÷ height to draw at (a print size's), the layout's own by default. */
  ratio?: number
  size?: SizeKey
  facts: PlaceFacts
  fonts: Fonts
  photo: PhotoInput
  palette?: Palette
  /** Pixel width of the SVG; the height follows. */
  width?: number
  /** The editor's view: a placeholder where there's no photo, outlines of empty text. */
  editing?: boolean
}

export const resolveColor = (color: Color, palette: Palette) => (color.kind === "fixed" ? color.hex : (palette[color.role] ?? color.fallback))

const esc = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
const n = (v: number) => Math.round(v * 100) / 100

export function renderSvg(input: RenderInput): { svg: string; height: number; overflow: string[] } {
  const ratio = input.ratio ?? input.data.ratio
  const H = heightOf(ratio)
  const palette = input.palette ?? DEFAULT_PALETTE
  const elements = layoutAt(input.data, ratio, input.size)
  const width = input.width ?? CANVAS
  const overflow: string[] = []
  const parts: string[] = []
  const defs: string[] = []

  parts.push(`<rect x="0" y="0" width="${CANVAS}" height="${n(H)}" fill="${resolveColor(input.data.background, palette)}"/>`)
  for (const el of elements) {
    if (el.hidden) continue
    const drawn = draw(el, input, palette, defs, overflow)
    if (drawn) parts.push(drawn)
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${n((width / CANVAS) * H)}" viewBox="0 0 ${CANVAS} ${n(H)}">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${parts.join("")}</svg>`
  return { svg, height: H, overflow }
}

function draw(el: CompositionElement, input: RenderInput, palette: Palette, defs: string[], overflow: string[]) {
  switch (el.type) {
    case "rect": {
      const stroke = el.stroke ? ` stroke="${resolveColor(el.stroke.color, palette)}" stroke-width="${n(el.stroke.width)}"` : ""
      return `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" rx="${n(el.radius)}" fill="${resolveColor(el.fill, palette)}"${el.opacity !== undefined && el.opacity < 1 ? ` opacity="${el.opacity}"` : ""}${stroke}/>`
    }
    case "line": {
      const color = resolveColor(el.color, palette)
      return el.w >= el.h
        ? `<rect x="${n(el.x)}" y="${n(el.y + el.h / 2 - el.thickness / 2)}" width="${n(el.w)}" height="${n(el.thickness)}" fill="${color}"/>`
        : `<rect x="${n(el.x + el.w / 2 - el.thickness / 2)}" y="${n(el.y)}" width="${n(el.thickness)}" height="${n(el.h)}" fill="${color}"/>`
    }
    case "icon":
      return iconSvg(el.icon, el.x, el.y, el.w, el.h, resolveColor(el.color, palette), el.stroke)
    case "photo": {
      const clip = `clip-${el.id}`
      defs.push(`<clipPath id="${clip}"><rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" rx="${n(el.radius)}"/></clipPath>`)
      const stroke = el.stroke
        ? `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" rx="${n(el.radius)}" fill="none" stroke="${resolveColor(el.stroke.color, palette)}" stroke-width="${n(el.stroke.width)}"/>`
        : ""
      if (!input.photo) {
        if (!input.editing) return stroke
        return `<g clip-path="url(#${clip})"><rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" fill="#D9DDE0"/><text x="${n(el.x + el.w / 2)}" y="${n(el.y + el.h / 2)}" font-family="sans-serif" font-size="28" fill="#7A8389" text-anchor="middle" dominant-baseline="middle">City photo</text></g>${stroke}`
      }
      const { href, width: iw, height: ih } = input.photo
      // Cover: the photo fills the frame, cropped around its focus.
      const scale = Math.max(el.w / iw, el.h / ih)
      const dw = iw * scale
      const dh = ih * scale
      const dx = el.x + (el.w - dw) * el.focusX
      const dy = el.y + (el.h - dh) * el.focusY
      return `<g clip-path="url(#${clip})"><image x="${n(dx)}" y="${n(dy)}" width="${n(dw)}" height="${n(dh)}" preserveAspectRatio="none" href="${esc(href)}" xlink:href="${esc(href)}"/></g>${stroke}`
    }
    case "text":
      return textSvg(el, input, palette, overflow)
  }
}

// --- Text ---

type Line = { words: string[]; width: number; last: boolean }

function measure(font: Font, text: string, size: number, tracking: number) {
  if (!text) return 0
  // opentype adds the spacing after the last glyph too; it doesn't belong to the width.
  return font.getAdvanceWidth(text, size, { kerning: true, tracking }) - (tracking / 1000) * size
}

function breakLines(font: Font, text: string, size: number, tracking: number, width: number) {
  const space = font.getAdvanceWidth(" ", size, { kerning: false, tracking })
  const lines: Line[] = []
  let widest = 0
  for (const paragraph of text.split(/\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    let current: string[] = []
    let currentWidth = 0
    for (const word of words) {
      const w = measure(font, word, size, tracking)
      widest = Math.max(widest, w)
      if (current.length && currentWidth + space + w > width) {
        lines.push({ words: current, width: currentWidth, last: false })
        current = [word]
        currentWidth = w
      } else {
        currentWidth = current.length ? currentWidth + space + w : w
        current.push(word)
      }
    }
    lines.push({ words: current, width: currentWidth, last: true })
  }
  return { lines, widest, space }
}

/** The text set at `size`: its lines per column, and whether it fits the box. */
function setText(el: TextElement, font: Font, text: string, size: number) {
  const columns = Math.max(1, Math.min(3, Math.round(el.columns)))
  const colWidth = (el.w - el.gap * (columns - 1)) / columns
  const { lines, widest, space } = breakLines(font, text, size, el.tracking, colWidth)
  const perColumn = Math.ceil(lines.length / columns)
  const lineHeight = size * el.leading
  const fits = widest <= colWidth + 0.5 && perColumn * lineHeight <= el.h + 0.5
  return { columns, colWidth, lines, perColumn, lineHeight, space, fits }
}

function textSvg(el: TextElement, input: RenderInput, palette: Palette, overflow: string[]) {
  const font = input.fonts.get(fontKey(el.font))
  const text = applyCase(fillText(el.text, input.facts), el.case)
  if (!text.trim()) return input.editing ? `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" fill="none" stroke="#B9C0C5" stroke-dasharray="6 6"/>` : ""
  if (!font) return input.editing ? `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" fill="#E8EBED"/>` : ""

  let size = el.size
  let set = setText(el, font, text, size)
  if (el.fit === "shrink") {
    for (let i = 0; i < 40 && !set.fits && size > el.size * 0.3; i++) {
      size *= 0.95
      set = setText(el, font, text, size)
    }
  }
  if (!set.fits) overflow.push(el.id)

  const scale = size / font.unitsPerEm
  const glyphHeight = (font.ascender - font.descender) * scale
  const color = resolveColor(el.color, palette)
  const paths: string[] = []
  for (let c = 0; c < set.columns; c++) {
    const lines = set.lines.slice(c * set.perColumn, (c + 1) * set.perColumn)
    if (!lines.length) continue
    const blockHeight = lines.length * set.lineHeight
    const top = el.vAlign === "middle" ? el.y + (el.h - blockHeight) / 2 : el.vAlign === "bottom" ? el.y + el.h - blockHeight : el.y
    const left = el.x + c * (set.colWidth + el.gap)
    lines.forEach((line, i) => {
      // The glyphs sit in the middle of their line, so a single line centres in its box.
      const baseline = top + i * set.lineHeight + (set.lineHeight - glyphHeight) / 2 + font.ascender * scale
      const justify = el.align === "justify" && !line.last && line.words.length > 1
      const gap = justify ? set.space + (set.colWidth - line.width) / (line.words.length - 1) : set.space
      const lineWidth = justify ? set.colWidth : line.width
      let x = el.align === "center" ? left + (set.colWidth - lineWidth) / 2 : el.align === "right" ? left + set.colWidth - lineWidth : left
      if (justify) {
        for (const word of line.words) {
          paths.push(font.getPath(word, x, baseline, size, { kerning: true, tracking: el.tracking }).toPathData(2))
          x += measure(font, word, size, el.tracking) + gap
        }
      } else {
        paths.push(font.getPath(line.words.join(" "), x, baseline, size, { kerning: true, tracking: el.tracking }).toPathData(2))
      }
    })
  }
  const opacity = el.opacity !== undefined && el.opacity < 1 ? ` opacity="${el.opacity}"` : ""
  return `<path d="${paths.join(" ")}" fill="${color}"${opacity}/>`
}

// --- Icons ---

// Simple line icons on a 24 grid, drawn with the element's colour.
const ICON_PATHS: Record<IconName, string> = {
  compass: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20Z M16.2 7.8l-2.1 6.3l-6.3 2.1l2.1-6.3Z",
  pin: "M12 21s-7-6.3-7-11.5a7 7 0 0 1 14 0C19 14.7 12 21 12 21Z M12 7a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5Z",
  star: "M12 2.5l2.9 6.1l6.6.8l-4.9 4.6l1.3 6.6L12 17.3l-5.9 3.3l1.3-6.6l-4.9-4.6l6.6-.8Z",
  plane: "M2 13l9-3l4-7h2l-2 8l6 2v2l-6-1l-1 6l-2 1l-1-6l-9 1Z",
  sun: "M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10Z M12 1v3 M12 20v3 M4.2 4.2l2.1 2.1 M17.7 17.7l2.1 2.1 M1 12h3 M20 12h3 M4.2 19.8l2.1-2.1 M17.7 6.3l2.1-2.1",
  wave: "M2 12c2.5-3 5-3 7.5 0s5 3 7.5 0s3.5-2 5-1 M2 18c2.5-3 5-3 7.5 0s5 3 7.5 0s3.5-2 5-1 M2 6c2.5-3 5-3 7.5 0s5 3 7.5 0s3.5-2 5-1",
  mountain: "M2 20l7-12l4 6l3-4l6 10Z",
  anchor: "M12 2a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5Z M12 7v15 M5 12H2a10 10 0 0 0 20 0h-3 M8 11h8",
  heart: "M12 21s-8.5-5.2-8.5-11.2A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 8.5 3.2C20.5 15.8 12 21 12 21Z",
  globe: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20Z M2 12h20 M12 2c3 3.2 3 16.8 0 20 M12 2c-3 3.2-3 16.8 0 20",
  camera: "M3 7h4l2-3h6l2 3h4v13H3Z M12 9a4 4 0 1 0 0 8a4 4 0 1 0 0-8Z",
  dot: "M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10Z",
}

function iconSvg(icon: IconName, x: number, y: number, w: number, h: number, color: string, stroke: number) {
  const s = Math.min(w, h) / 24
  const ox = x + (w - 24 * s) / 2
  const oy = y + (h - 24 * s) / 2
  const filled = icon === "dot"
  return `<path transform="translate(${n(ox)} ${n(oy)}) scale(${n(s)})" d="${ICON_PATHS[icon]}" fill="${filled ? color : "none"}" stroke="${filled ? "none" : color}" stroke-width="${n(stroke / Math.max(s, 0.01))}" stroke-linecap="round" stroke-linejoin="round"/>`
}

/** Every font a composition's text needs. */
export function fontsOf(data: CompositionData) {
  const found = new Map<string, TextElement["font"]>()
  for (const el of data.elements) if (el.type === "text") found.set(fontKey(el.font), el.font)
  return [...found.values()]
}
