import type { Font } from "opentype.js"

import type { Box, Line } from "./measure"
import type { TextElement } from "./model"

// Type set to match a measured poster exactly, from the font's own glyphs:
// the size that gives the words the height their ink has, the letter
// spacing that gives them its width, and the box that puts that ink where
// it is, worked out for the renderer's own way of placing a line
// (render.ts). A paragraph's size comes from its lines' x-height (their
// height when that wasn't measured), its line spacing from the distance
// between their baselines, its columns from where they stand.

/** The ink of `text` set at `size` with `tracking` from x = 0 on its baseline, and its advance width. */
export function inkOf(font: Font, text: string, size: number, tracking: number) {
  const path = font.getPath(text, 0, 0, size, { kerning: true, tracking })
  const b = path.getBoundingBox()
  const advance = font.getAdvanceWidth(text, size, { kerning: true, tracking }) - (tracking / 1000) * size
  return { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, advance }
}

/** The font's x-height as a share of its size: its own figure, or its "x" measured. */
export function xHeightOf(font: Font) {
  const own = (font.tables.os2 as { sxHeight?: number } | undefined)?.sxHeight
  if (own && own > 0) return own / font.unitsPerEm
  const x = font.charToGlyph("x").getBoundingBox()
  return x.y2 > 0 ? x.y2 / font.unitsPerEm : 0.5
}

/** Where the renderer puts a single line's baseline in a box of height `h` (render.ts): centred in its line. */
export function baselineIn(font: Font, size: number, leading: number, top: number) {
  const scale = size / font.unitsPerEm
  const glyphHeight = (font.ascender - font.descender) * scale
  return top + (size * leading - glyphHeight) / 2 + font.ascender * scale
}

export type LineFit = Pick<TextElement, "x" | "y" | "w" | "h" | "size" | "tracking" | "leading" | "align">

/**
 * One line of type fitted to its ink box: size from the ink's height,
 * tracking from its width, the box placed so the ink lands on the box.
 * `align` keeps the edge the line grows from when its words change (a
 * country right-aligned stays flush right); `room` is how wide its box may
 * be for longer words, from that edge.
 */
export function fitLine(font: Font, text: string, ink: Box, align: TextElement["align"], room: number): LineFit {
  const glyphs = [...text].length
  const tall = inkOf(font, text, 1000, 0)
  const inkHeight = Math.max(1, ink.y1 - ink.y0)
  const size = Math.max(3, (1000 * inkHeight) / Math.max(1, tall.y2 - tall.y1))
  const plain = inkOf(font, text, size, 0)
  const wanted = ink.x1 - ink.x0
  const tracking = glyphs > 1 ? clamp(((wanted - (plain.x2 - plain.x1)) * 1000) / (size * (glyphs - 1)), -120, 900) : 0
  const set = inkOf(font, text, size, tracking)
  const leading = 1.2
  const h = size * leading
  // The ink's top is the baseline plus the glyphs' top (negative, above it).
  const baseline = ink.y0 - set.y1
  const y = baseline - (baselineIn(font, size, leading, 0) - 0)
  // Room enough that the line never wraps where the renderer measures it word by word.
  const w = Math.max(room, set.advance + 6)
  let x: number
  if (align === "right") x = ink.x1 - set.x2 + set.advance - w
  else if (align === "center") x = (ink.x0 + ink.x1) / 2 - w / 2 + (set.advance - (set.x2 + set.x1)) / 2
  else x = ink.x0 - set.x1
  return { x, y, w, h, size, tracking: Math.round(tracking), leading, align }
}

export type ParagraphFit = Pick<TextElement, "x" | "y" | "w" | "h" | "size" | "tracking" | "leading" | "align" | "columns" | "gap">

/**
 * A paragraph in columns fitted to its lines: the size whose ascender to
 * descender spans the typical line's ink, the line spacing from their
 * pitch, the columns and gap from where they stand, justified when the
 * lines share their right edge.
 */
export function fitParagraph(font: Font, lines: Line[], columns: Box[]): ParagraphFit {
  const all = lines.map((l) => l.y1 - l.y0).sort((a, b) => a - b)
  // Lines measured as two (touching) aside: no line is half again as tall as the middle one.
  const middle = all[all.length >> 1] ?? 10
  const heights = all.filter((h) => h <= middle * 1.5)
  const probe = inkOf(font, "dp", 1000, 0)
  const cores = lines.flatMap((l) => (l.core ? [l.core.y1 - l.core.y0] : [])).sort((a, b) => a - b)
  const xHeight = cores[cores.length >> 1]
  // The x-height where the lines' bands were measured (a line in capitals or figures aside);
  // else most lines hold an ascender and a descender: their ink spans the font's d-to-p height.
  const typical = heights[Math.floor(heights.length * 0.75)] ?? middle
  const size =
    cores.length >= Math.max(2, lines.length / 2) && xHeight
      ? Math.max(3, xHeight / xHeightOf(font))
      : Math.max(3, (1000 * typical) / Math.max(1, probe.y2 - probe.y1))
  // Pitch: the median distance between baselines (line tops where unmeasured) within a column.
  const cols = columns.length ? columns : [lines.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))]
  const baseOf = (l: Line) => l.core?.y1 ?? l.y0
  const pitches: number[] = []
  for (const c of cols) {
    const inside = lines.filter((l) => l.x0 >= c.x0 - 2 && l.x1 <= c.x1 + 2).sort((a, b) => a.y0 - b.y0)
    for (let i = 1; i < inside.length; i++) pitches.push(baseOf(inside[i]) - baseOf(inside[i - 1]))
  }
  pitches.sort((a, b) => a - b)
  const pitch = pitches[pitches.length >> 1] ?? size * 1.3
  const leading = clamp(pitch / size, 0.9, 2.4)
  const left = Math.min(...cols.map((c) => c.x0))
  const right = Math.max(...cols.map((c) => c.x1))
  const gaps = cols.slice(1).map((c, i) => c.x0 - cols[i].x1)
  const gap = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 28
  // Justified: the lines of a column (but its last) end at its right edge.
  let flush = 0
  let counted = 0
  for (const c of cols) {
    const inside = lines.filter((l) => l.x0 >= c.x0 - 2 && l.x1 <= c.x1 + 2).sort((a, b) => a.y0 - b.y0)
    for (const l of inside.slice(0, -1)) {
      counted++
      if (c.x1 - l.x1 <= 2) flush++
    }
  }
  const align: TextElement["align"] = counted && flush / counted > 0.7 ? "justify" : "left"
  // The first line's baseline: measured, or its ink top (an ascender's) less the ascender's height.
  const top = Math.min(...cols.map((c) => c.y0))
  const bottom = Math.max(...cols.map((c) => c.y1))
  const first = [...lines].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)[0]
  const baseline = first?.core ? first.core.y1 : top - probe.y1 * (size / 1000)
  const y = baseline - baselineIn(font, size, leading, 0)
  return { x: left, y, w: right - left, h: bottom - y + pitch * 0.6, size, tracking: 0, leading, align, columns: cols.length, gap }
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
