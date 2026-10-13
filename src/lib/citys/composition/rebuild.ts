import sharp from "sharp"

import { askJson } from "@/lib/mockups/gemini"
import { putFile } from "@/lib/storage/files"

import { fitLine, fitParagraph, inkOf } from "./fit"
import { matchFont, type FontKind, type Sample } from "./fontmatch"
import { loadFont } from "./fonts"
import { canvasPixels, measurePixels, type Box, type Mark, type Measured } from "./measure"
import {
  CANVAS,
  heightOf,
  ICONS,
  newElementId,
  SAMPLE_FACTS,
  textElement,
  type CompositionData,
  type CompositionElement,
  type Hold,
  type IconName,
  type Rebuild,
  type TextCase,
  type TextElement,
} from "./model"
import { renderComposition } from "./raster"
import { LINE_BREAK } from "./render"
import { changeComposition, compositionFileKey, getComposition, readCompositionFile, saveSource, setBusy, withVersion } from "./store"
import { evenLight, flatPoster } from "./sheet"

// A poster rebuilt as a template, to the pixel. The poster is taken out of
// a photo of it when that's what came (sheet.ts), drawn 1000 wide, and
// measured (measure.ts): its paper, its photo's frame, every line of type,
// paragraph, rule, swatch and symbol with the box its ink fills. Gemini
// reads what the marks are (the words, which are the place's name or
// country, the nearest Google Font, case, alignment). Type is then set to
// fill each mark's ink exactly (fit.ts) and the rebuild is drawn in the
// original's own words, with the original's photo in its frame, measured
// the same way and compared: each element nudged and resized to where the
// original's ink is, pass after pass while it gets closer, Gemini looking
// over the two side by side once for what pixels can't tell (a wrong
// font, a missing mark). The best pass is kept with its score and the
// images compared; the words become placeholders, the template for any
// place.

const STR = { type: "STRING" }
const NUM = { type: "NUMBER" }
const ROLES = ["city", "country", "region", "code", "coords", "lat", "lng", "tagline", "description", "story", "founded", "landmark", "literal"] as const
type Role = (typeof ROLES)[number]

type Label = {
  id: number
  keep: boolean
  kind: "text" | "paragraph" | "rule" | "swatch" | "symbol" | "framed"
  text: string
  /** A paragraph's first line (its first column's), word for word: what its font is matched on. */
  firstLine: string
  /** A paragraph's lines as printed, column after column, a hyphen where a word breaks: what it's compared in. */
  lines: string[]
  fontKind: FontKind
  role: Role
  family: string
  weight: number
  italic: boolean
  case: TextCase
  align: TextElement["align"]
  icon: IconName | "none"
}

const LABEL = {
  type: "OBJECT",
  properties: {
    id: { type: "INTEGER" },
    keep: { type: "BOOLEAN" },
    kind: { type: "STRING", enum: ["text", "paragraph", "rule", "swatch", "symbol", "framed"] },
    text: STR,
    firstLine: STR,
    lines: { type: "ARRAY", items: STR },
    role: { type: "STRING", enum: [...ROLES] },
    fontKind: { type: "STRING", enum: ["serif", "sans", "condensed", "slab", "display", "mono"] },
    family: STR,
    weight: NUM,
    italic: { type: "BOOLEAN" },
    case: { type: "STRING", enum: ["none", "upper", "lower", "title"] },
    align: { type: "STRING", enum: ["left", "center", "right", "justify"] },
    icon: { type: "STRING", enum: [...ICONS, "none"] },
  },
  required: ["id", "keep", "kind", "text", "firstLine", "lines", "role", "fontKind", "family", "weight", "italic", "case", "align", "icon"],
  propertyOrdering: ["id", "keep", "kind", "text", "firstLine", "lines", "role", "fontKind", "family", "weight", "italic", "case", "align", "icon"],
}
const READ_SCHEMA = { type: "OBJECT", properties: { marks: { type: "ARRAY", items: LABEL } }, required: ["marks"] }

const FRAME_SCHEMA = {
  type: "OBJECT",
  properties: { photo: { type: "BOOLEAN" }, box_2d: { type: "ARRAY", items: NUM } },
  required: ["photo", "box_2d"],
}

/** Where Gemini sees the poster's photo or illustration, in canvas units; null when there's none. */
async function photoFrame(poster: Buffer, height: number): Promise<Box | null> {
  const found = await askJson<{ photo?: boolean; box_2d?: number[] }>(
    `This is a poster. Box its photograph or illustration (the picture itself, without the poster's margins, title, captions or body text). "photo": false when the poster has no picture. "box_2d": [ymin, xmin, ymax, xmax] normalized to 0-1000.`,
    [poster],
    { schema: FRAME_SCHEMA, temperature: 0, quick: true }
  )
  const b = found.box_2d
  if (!found.photo || !Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) return null
  const [ymin, xmin, ymax, xmax] = b.map((v) => Math.min(1000, Math.max(0, v)))
  return { x0: Math.round(xmin), y0: Math.round((ymin / 1000) * height), x1: Math.round(xmax), y1: Math.round((ymax / 1000) * height) }
}

const KIND_COLORS: Record<Mark["kind"], string> = { text: "#E53935", paragraph: "#1E88E5", rule: "#43A047", swatch: "#FB8C00", symbol: "#8E24AA" }

/** The poster with every mark's box and number drawn on it, for Gemini to name them by. */
async function numbered(poster: Buffer, m: Measured) {
  const label = (k: Mark) => {
    const x = Math.max(0, k.box.x0 - 1)
    const y = Math.max(12, k.box.y0 - 2)
    return `<rect x="${k.box.x0 - 1}" y="${k.box.y0 - 1}" width="${k.box.x1 - k.box.x0 + 2}" height="${k.box.y1 - k.box.y0 + 2}" fill="none" stroke="${KIND_COLORS[k.kind]}" stroke-width="1.5"/><rect x="${x}" y="${y - 12}" width="${String(k.id).length * 8 + 6}" height="13" fill="${KIND_COLORS[k.kind]}"/><text x="${x + 3}" y="${y - 2}" font-family="Helvetica, Arial, sans-serif" font-size="11" font-weight="700" fill="#fff">${k.id}</text>`
  }
  const photo = m.photo ? `<rect x="${m.photo.x0}" y="${m.photo.y0}" width="${m.photo.x1 - m.photo.x0}" height="${m.photo.y1 - m.photo.y0}" fill="none" stroke="#00BCD4" stroke-width="3"/>` : ""
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}">${photo}${m.marks.map(label).join("")}</svg>`
  return sharp(poster).resize(m.width, m.height).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 90 }).toBuffer()
}

/** What each measured mark is: Gemini reads the poster with the marks numbered on it. */
async function readMarks(poster: Buffer, m: Measured): Promise<Label[]> {
  const overlay = await numbered(poster, m)
  const list = m.marks.map((k) => `${k.id}: measured as ${k.kind}${k.kind === "paragraph" ? ` (${k.columns?.length ?? 1} columns, ${k.lines?.length ?? 0} lines)` : ""}, ink box ${k.box.x0},${k.box.y0} to ${k.box.x1},${k.box.y1}`).join("\n")
  const answer = await askJson<{ marks?: Partial<Label>[] }>(
    `You rebuild city and travel posters as editable templates, exactly. Image 1 is a poster. Image 2 is the same poster with a numbered box around every mark measured on it (the photo's frame in cyan). For every number below, say what the mark is:
- keep: false for what isn't part of the design (a speck, a reflection, a scrap of the photo or of a frame); it's dropped.
- kind: text (a line of words), paragraph (body text, maybe in columns), rule (a line), swatch (a solid block of colour), symbol (an icon or small graphic), framed (a short text inside a drawn box or outline, like a country code in a square).
- text: for text, paragraph and framed, the words exactly as printed, letter for letter, keeping their capitals; a paragraph's whole text as one run (line breaks as spaces, a word hyphenated at a line's end joined again). "" for the rest.
- firstLine: for a paragraph, exactly the words of its first line (in its first column), as printed, with a hyphen if it ends in one; else "".
- lines: for a paragraph, every one of its printed lines in reading order (down the first column, then the next), each exactly as printed, with the hyphen where a word is broken at the line's end; [] for the rest.
- In a paragraph's text and lines, words printed bolder than the rest of it (a lead-in such as the place's name) go between ** (**New York City** is the city…); nothing else is marked.
- role: what the words stand for, so the template can be filled for any place: city (the place's name as the title), country, region, code (a short code like NYC or JP), coords (both coordinates), lat, lng, tagline, description (a short paragraph about the place), story (a long text about it, in columns), founded (its year), landmark, or literal (words that stay as printed for every place: "EST.", "/", a label). Rules, swatches and symbols are literal.
- fontKind: serif, sans, condensed (tall and narrow), slab, display (a decorative or very high-contrast face) or mono.
- family: the closest free Google Font for its lettering, named exactly as on Google Fonts (sans like Inter, Archivo, Work Sans, Montserrat, Helvetica-like "Inter"; serif like Playfair Display, Libre Baskerville, Lora, EB Garamond, Cormorant Garamond, DM Serif Display; condensed like Oswald, Bebas Neue); weight 100–900 as heavy as it looks; italic.
- case: as printed: upper, lower, title or none (mixed).
- align: how it's aligned on its line or in its column (justify for a paragraph whose lines end flush).
- icon: for a symbol, the nearest of ${ICONS.join(", ")}; else none.

Marks:
${list}`,
    [poster, overlay],
    { schema: READ_SCHEMA, temperature: 0 }
  )
  const byId = new Map((answer.marks ?? []).map((l) => [l.id, l]))
  return m.marks.map((k) => {
    const l = byId.get(k.id) ?? {}
    return {
      id: k.id,
      keep: l.keep !== false,
      kind: (["text", "paragraph", "rule", "swatch", "symbol", "framed"].includes(l.kind ?? "") ? l.kind : k.kind) as Label["kind"],
      text: typeof l.text === "string" ? l.text.trim() : "",
      firstLine: typeof l.firstLine === "string" ? l.firstLine.trim() : "",
      lines: Array.isArray(l.lines) ? l.lines.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean) : [],
      fontKind: (["serif", "sans", "condensed", "slab", "display", "mono"].includes(l.fontKind ?? "") ? l.fontKind : "sans") as FontKind,
      role: (ROLES.includes(l.role as Role) ? l.role : "literal") as Role,
      family: typeof l.family === "string" && l.family.trim() ? l.family.trim() : "Inter",
      weight: Math.round(Math.min(900, Math.max(100, Number(l.weight) || 400)) / 100) * 100,
      italic: l.italic === true,
      case: (["none", "upper", "lower", "title"].includes(l.case ?? "") ? l.case : "none") as TextCase,
      align: (["left", "center", "right", "justify"].includes(l.align ?? "") ? l.align : "left") as TextElement["align"],
      icon: (ICONS.includes(l.icon as IconName) ? l.icon : "none") as Label["icon"],
    }
  })
}

const PLACEHOLDER: Record<Role, string | null> = {
  city: "{city}",
  country: "{country}",
  region: "{region}",
  code: "{code}",
  coords: "{coords}",
  lat: "{lat}",
  lng: "{lng}",
  tagline: "{tagline}",
  description: "{description}",
  story: "{story}",
  founded: "{founded}",
  landmark: "{landmark}",
  literal: null,
}

/** What an element keeps its distance to as the poster's shape changes: by where it sits against the photo. */
function holdOf(box: Box, photo: Box | null, H: number): Hold {
  if (photo) return box.y1 <= photo.y0 + 2 ? "start" : box.y0 >= photo.y1 - 2 ? "end" : "center"
  const centre = (box.y0 + box.y1) / 2 / H
  return centre < 0.4 ? "start" : centre > 0.6 ? "end" : "center"
}

/** Where a text may grow for longer words: from its edge to the poster's margin or the photo's. */
function roomFor(box: Box, align: TextElement["align"], m: Measured, others: Box[]) {
  const margin = m.photo ? m.photo.x0 : Math.min(box.x0, CANVAS - box.x1)
  const right = m.photo ? m.photo.x1 : CANVAS - margin
  // Another mark on the same line limits it.
  const line = others.filter((o) => o !== box && Math.min(o.y1, box.y1) - Math.max(o.y0, box.y0) > 0)
  const leftWall = Math.max(margin, ...line.filter((o) => o.x1 <= box.x0).map((o) => o.x1 + 12))
  const rightWall = Math.min(right, ...line.filter((o) => o.x0 >= box.x1).map((o) => o.x0 - 12))
  if (align === "right") return Math.max(box.x1 - box.x0, box.x1 - leftWall)
  if (align === "center") return Math.max(box.x1 - box.x0, 2 * Math.min((box.x0 + box.x1) / 2 - leftWall, rightWall - (box.x0 + box.x1) / 2))
  return Math.max(box.x1 - box.x0, rightWall - box.x0)
}

type Built = { data: CompositionData; targets: Map<string, Box> }

const rgbOf = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]

/**
 * The ink a mark is printed in: its own colour, or for a grey one (small
 * type never shows its full black) the darkest grey any text on the poster
 * is printed in.
 */
function inkOfMark(m: Measured, id: number) {
  const own = rgbOf(m.marks.find((k) => k.id === id)?.color ?? "#111111")
  const grey = (c: number[]) => Math.max(...c) - Math.min(...c) < 28
  if (!grey(own)) return own
  const darkest = m.marks
    .filter((k) => k.kind === "text" || k.kind === "paragraph")
    .map((k) => rgbOf(k.color))
    .filter(grey)
    .sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]))[0]
  return darkest && darkest[0] + darkest[1] + darkest[2] < own[0] + own[1] + own[2] ? darkest : own
}

/**
 * The font a mark is set in: Gemini's guess checked against the others of
 * its kind, by setting its lines in each; a paragraph's first lines by
 * their x-height bands, their width in their word spaces.
 */
async function fontFor(img: Img, m: Measured, l: Label, samples: Sample[]): Promise<{ font: TextElement["font"]; tracking: number }> {
  const guess = { font: { family: l.family, weight: l.weight, italic: l.italic }, tracking: 0 }
  const usable = samples.filter((sample) => sample.text.trim() && sample.ink.y1 - sample.ink.y0 >= 5)
  if (!usable.length) return guess
  const copy = usable.some((sample) => sample.core)
  // Every printed line must fit its column in the font, at the size the paragraph gets, or ours would break them elsewhere.
  const mark = m.marks.find((k) => k.id === l.id)
  const column = Math.min(...(mark?.columns ?? []).map((c) => c.x1 - c.x0))
  const cores = (mark?.lines ?? []).flatMap((line) => (line.core ? [line.core.y1 - line.core.y0] : [])).sort((a, b) => a - b)
  const xHeight = cores[cores.length >> 1]
  const fits = copy && l.lines.length && Number.isFinite(column) && xHeight ? { lines: l.lines.map((line) => line.replaceAll("**", "")), width: column, xHeight } : undefined
  const found = await matchFont(img, usable, { family: l.family, weight: l.weight, italic: l.italic }, l.fontKind, rgbOf(m.paper), inkOfMark(m, l.id), copy, fits).catch(() => null)
  return found && found.likeness > 0 ? { font: { family: found.family, weight: found.weight, italic: found.italic }, tracking: found.tracking } : guess
}

/** A paragraph's first printed lines (up to three, in its first column; a line with a bold lead-in aside) with their words, to match its font on. */
function copySamples(l: Label, k: Mark): Sample[] {
  const words = l.lines.length ? l.lines : l.firstLine ? [l.firstLine] : []
  return (k.lines ?? [])
    .slice(0, Math.min(6, words.length))
    .map((line, i) => ({ text: words[i], ink: line, core: line.core }))
    .filter((sample) => !sample.text.includes("**"))
    .slice(0, 3)
}

/** The layout from the measured marks and what they are, type fitted to each mark's ink. */
async function build(m: Measured, labels: Label[], img: Img): Promise<Built> {
  const H = m.height
  const elements: CompositionElement[] = []
  const targets = new Map<string, Box>()
  if (m.photo) {
    elements.push({ id: newElementId(), name: "Photo", type: "photo", x: m.photo.x0, y: m.photo.y0, w: m.photo.x1 - m.photo.x0, h: m.photo.y1 - m.photo.y0, hold: "stretch", focusX: 0.5, focusY: 0.5, radius: 0 })
  }
  const kept = labels.map((l, i) => ({ l, k: m.marks[i] })).filter(({ l }) => l.keep)
  const boxes = kept.map(({ k }) => k.box)
  // Lines of one title (the same role, font and alignment, stacked close) become one text.
  const used = new Set<number>()
  for (let i = 0; i < kept.length; i++) {
    if (used.has(i)) continue
    const { l, k } = kept[i]
    const hold = holdOf(k.box, m.photo, H)
    if (l.kind === "rule" || k.kind === "rule") {
      const horizontal = k.box.x1 - k.box.x0 >= k.box.y1 - k.box.y0
      const thickness = Math.max(0.5, horizontal ? k.box.y1 - k.box.y0 : k.box.x1 - k.box.x0)
      elements.push({ id: newElementId(), name: "Rule", type: "line", x: k.box.x0, y: k.box.y0, w: Math.max(1, k.box.x1 - k.box.x0), h: Math.max(1, k.box.y1 - k.box.y0), hold, color: { kind: "fixed", hex: k.color }, thickness })
      continue
    }
    if (l.kind === "swatch") {
      elements.push({ id: newElementId(), name: "Swatch", type: "rect", x: k.box.x0, y: k.box.y0, w: k.box.x1 - k.box.x0, h: k.box.y1 - k.box.y0, hold, fill: { kind: "fixed", hex: k.color }, radius: 0 })
      continue
    }
    if (l.kind === "symbol" && l.icon !== "none") {
      elements.push({ id: newElementId(), name: "Symbol", type: "icon", x: k.box.x0, y: k.box.y0, w: k.box.x1 - k.box.x0, h: k.box.y1 - k.box.y0, hold, icon: l.icon, color: { kind: "fixed", hex: k.color }, stroke: 1.6 })
      continue
    }
    if (!l.text) continue
    const paragraph = l.kind === "paragraph" || k.kind === "paragraph"
    const found = paragraph ? await fontFor(img, m, l, copySamples(l, k)) : await fontFor(img, m, l, [{ text: l.text.split("\n")[0], ink: l.kind === "framed" ? framedText(k) : k.box }])
    const spec = found.font
    const font = await loadFont(spec).catch(() => loadFont({ family: "Inter", weight: spec.weight, italic: false }))
    if (paragraph) {
      // Its letters spaced as tight (or loose) as the copy's lines need to fit as printed.
      const fit = { ...fitParagraph(font, k.lines ?? [k.box], k.columns ?? [k.box]), tracking: found.tracking }
      const el = textElement({ name: l.role === "story" || l.role === "description" ? "Copy" : "Paragraph", ...fit, hold, text: l.text, literal: asPrinted(l, k), font: spec, case: "none", vAlign: "top", color: { kind: "fixed", hex: k.color }, fit: "none" })
      elements.push(el)
      targets.set(el.id, k.box)
      continue
    }
    // A framed text: its outline, and the words set in it.
    if (l.kind === "framed") {
      // Its outline as thick as the original's: its pixels spread round its box.
      const outline = outlineOf(k)
      const width = outline ? Math.max(0.75, Math.min(6, outline.count / (2 * (outline.x1 - outline.x0 + outline.y1 - outline.y0)))) : 1.5
      elements.push({ id: newElementId(), name: "Frame", type: "rect", x: k.box.x0 + width / 2, y: k.box.y0 + width / 2, w: k.box.x1 - k.box.x0 - width, h: k.box.y1 - k.box.y0 - width, hold, fill: { kind: "fixed", hex: m.paper }, radius: 0, stroke: { width, color: { kind: "fixed", hex: k.color } } })
    }
    // Further lines of the same title.
    const group = [kept[i]]
    for (let j = i + 1; j < kept.length; j++) {
      const n = kept[j]
      const last = group[group.length - 1].k.box
      if (n.l.role === l.role && l.role !== "literal" && n.l.family === l.family && n.l.align === l.align && n.k.box.y0 - last.y1 < (last.y1 - last.y0) * 0.8 && n.k.box.y0 > last.y0) {
        group.push(n)
        used.add(j)
      }
    }
    const text = group.map((g) => g.l.text).join("\n")
    const first = group[0].k.box
    const inner = l.kind === "framed" ? framedText(k) : first
    const fit = fitLine(font, group[0].l.text, inner, l.align === "justify" ? "left" : l.align, roomFor(first, l.align, m, boxes))
    const leading = group.length > 1 ? (group[1].k.box.y0 - group[0].k.box.y0) / fit.size : fit.leading
    const box: Box = group.map((g) => g.k.box).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))
    const el = textElement({
      name: l.role === "literal" ? "Text" : l.role[0].toUpperCase() + l.role.slice(1),
      ...fit,
      leading,
      h: fit.size * leading * group.length,
      hold,
      text,
      literal: text,
      font: spec,
      case: "none",
      vAlign: "top",
      color: { kind: "fixed", hex: k.color },
      fit: "none",
    })
    if (group.length > 1) el.y = fit.y - (fit.size * leading - fit.size * fit.leading) / 2
    elements.push(el)
    targets.set(el.id, l.kind === "framed" ? inner : box)
  }
  return { data: { ratio: CANVAS / H, background: { kind: "fixed", hex: m.paper }, elements, sizes: {} }, targets }
}

/**
 * A paragraph's words line for line as printed (Gemini's lines, when as
 * many as were measured), so ours breaks where the original does: each
 * line kept justified, the last one too when the original's runs to the
 * column's edge. Its plain text otherwise.
 */
function asPrinted(l: Label, k: Mark) {
  const measured = k.lines?.length ?? 0
  if (!l.lines.length || Math.abs(l.lines.length - measured) > 1) return l.text
  const lastLine = k.lines?.[k.lines.length - 1]
  const column = lastLine && k.columns?.find((c) => lastLine.x0 >= c.x0 - 2 && lastLine.x1 <= c.x1 + 2)
  const fullLast = !!column && column.x1 - lastLine.x1 <= 2 && lastLine.x1 - lastLine.x0 >= (column.x1 - column.x0) * 0.9
  return l.lines.join(LINE_BREAK) + (fullLast ? LINE_BREAK : "")
}

/** A framed text's outline: its biggest piece of ink, when it holds the others. */
function outlineOf(k: Mark) {
  const parts = k.parts ?? []
  const area = (b: Box) => (b.x1 - b.x0) * (b.y1 - b.y0)
  const outline = parts.reduce<(typeof parts)[number] | null>((a, p) => (!a || area(p) > area(a) ? p : a), null)
  return outline && parts.some((p) => p !== outline && p.x0 >= outline.x0 && p.x1 <= outline.x1 && p.y0 >= outline.y0 && p.y1 <= outline.y1) ? outline : null
}

/** A framed text's words: the ink inside its outline (the box less a fifth of its height all round, when that wasn't found). */
function framedText(k: Mark): Box {
  const outline = outlineOf(k)
  const inside = (k.parts ?? []).filter((p) => outline && p !== outline && p.x0 >= outline.x0 && p.x1 <= outline.x1 && p.y0 >= outline.y0 && p.y1 <= outline.y1)
  if (inside.length) return inside.reduce<Box>((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
  const pad = (k.box.y1 - k.box.y0) * 0.22
  return { x0: k.box.x0 + pad, y0: k.box.y0 + pad, x1: k.box.x1 - pad, y1: k.box.y1 - pad }
}

// --- Comparing ---

type Img = { rgb: Uint8Array; width: number; height: number }

/** The layout drawn in the original's own words, the original's photo in its frame, 1000 wide. */
async function drawLiteral(data: CompositionData, photo: Buffer | null): Promise<Img> {
  const literal: CompositionData = { ...data, elements: data.elements.map((e) => (e.type === "text" && e.literal !== undefined ? { ...e, text: e.literal, case: "none" as TextCase } : e)) }
  const image = await renderComposition({ data: literal, facts: SAMPLE_FACTS, photo, width: CANVAS, palette: { dominant: "#000000", vibrant: "#000000", muted: "#000000", dark: "#000000", light: "#ffffff" } })
  const { data: raw, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { rgb: new Uint8Array(raw), width: info.width, height: info.height }
}

/**
 * How alike two posters are, the photo's frame aside (0–100): half how much
 * of the ink lies where the other's does (within a pixel), half how many
 * pixels look alike.
 */
function score(a: Img, b: Img, photo: Box | null, paper: string) {
  const W = Math.min(a.width, b.width)
  const H = Math.min(a.height, b.height)
  const pr = parseInt(paper.slice(1, 3), 16)
  const pg = parseInt(paper.slice(3, 5), 16)
  const pb = parseInt(paper.slice(5, 7), 16)
  const inkA = new Uint8Array(W * H)
  const inkB = new Uint8Array(W * H)
  let alike = 0
  let counted = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (photo && x >= photo.x0 && x < photo.x1 && y >= photo.y0 && y < photo.y1) continue
      const i = y * W + x
      const ia = (y * a.width + x) * 3
      const ib = (y * b.width + x) * 3
      const da = Math.max(Math.abs(a.rgb[ia] - pr), Math.abs(a.rgb[ia + 1] - pg), Math.abs(a.rgb[ia + 2] - pb))
      const db = Math.max(Math.abs(b.rgb[ib] - pr), Math.abs(b.rgb[ib + 1] - pg), Math.abs(b.rgb[ib + 2] - pb))
      if (da > 48) inkA[i] = 1
      if (db > 48) inkB[i] = 1
      counted++
      const la = 0.299 * a.rgb[ia] + 0.587 * a.rgb[ia + 1] + 0.114 * a.rgb[ia + 2]
      const lb = 0.299 * b.rgb[ib] + 0.587 * b.rgb[ib + 1] + 0.114 * b.rgb[ib + 2]
      if (Math.abs(la - lb) < 30) alike++
    }
  }
  // Ink within a pixel of the other's counts as in place.
  const near = (ink: Uint8Array, x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && ink[ny * W + nx]) return true
    }
    return false
  }
  let both = 0
  let either = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (!inkA[i] && !inkB[i]) continue
      either++
      if ((inkA[i] && near(inkB, x, y)) || (inkB[i] && near(inkA, x, y))) both++
    }
  }
  const inkScore = either ? both / either : 1
  const pixelScore = counted ? alike / counted : 1
  return Math.round(1000 * (0.5 * inkScore + 0.5 * pixelScore)) / 10
}

/** Where they differ: the original greyed, red where only the original has ink, blue where only ours does. */
async function diffImage(a: Img, b: Img, paper: string) {
  const W = Math.min(a.width, b.width)
  const H = Math.min(a.height, b.height)
  const pr = parseInt(paper.slice(1, 3), 16)
  const pg = parseInt(paper.slice(3, 5), 16)
  const pb = parseInt(paper.slice(5, 7), 16)
  const out = Buffer.alloc(W * H * 3)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ia = (y * a.width + x) * 3
      const ib = (y * b.width + x) * 3
      const da = Math.max(Math.abs(a.rgb[ia] - pr), Math.abs(a.rgb[ia + 1] - pg), Math.abs(a.rgb[ia + 2] - pb)) > 48
      const db = Math.max(Math.abs(b.rgb[ib] - pr), Math.abs(b.rgb[ib + 1] - pg), Math.abs(b.rgb[ib + 2] - pb)) > 48
      const o = (y * W + x) * 3
      const grey = 255 - (255 - (0.299 * a.rgb[ia] + 0.587 * a.rgb[ia + 1] + 0.114 * a.rgb[ia + 2])) * 0.25
      if (da && !db) out.set([225, 40, 40], o)
      else if (db && !da) out.set([30, 110, 230], o)
      else out.set([grey, grey, grey], o)
    }
  }
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 88 }).toBuffer()
}

/**
 * The ink of `img` inside `area` (padded a little: a line's by part of its
 * height, a paragraph's by a few units, so neighbours stay out), the photo
 * aside: where an element's ink really landed, and how much of it there is.
 */
function inkIn(img: Img, area: Box, paper: string, photo: Box | null, paragraph = false): (Box & { count: number }) | null {
  const pr = parseInt(paper.slice(1, 3), 16)
  const pg = parseInt(paper.slice(3, 5), 16)
  const pb = parseInt(paper.slice(5, 7), 16)
  const pad = paragraph ? 4 : Math.max(4, Math.min(20, (area.y1 - area.y0) * 0.6))
  const x0 = Math.max(0, Math.floor(area.x0 - pad))
  const y0 = Math.max(0, Math.floor(area.y0 - pad))
  const x1 = Math.min(img.width, Math.ceil(area.x1 + pad))
  const y1 = Math.min(img.height, Math.ceil(area.y1 + pad))
  let found: (Box & { count: number }) | null = null
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (photo && x >= photo.x0 && x < photo.x1 && y >= photo.y0 && y < photo.y1) continue
      const i = (y * img.width + x) * 3
      const d = Math.max(Math.abs(img.rgb[i] - pr), Math.abs(img.rgb[i + 1] - pg), Math.abs(img.rgb[i + 2] - pb))
      if (d <= 48) continue
      if (!found) found = { x0: x, y0: y, x1: x + 1, y1: y + 1, count: 1 }
      else {
        found.count++
        if (x < found.x0) found.x0 = x
        if (y < found.y0) found.y0 = y
        if (x + 1 > found.x1) found.x1 = x + 1
        if (y + 1 > found.y1) found.y1 = y + 1
      }
    }
  }
  return found
}

/**
 * Each text's correction: its ink in our drawing against the original's,
 * moved by the difference of their edges (the edge it's aligned to), its
 * size scaled by their heights, its letter spacing set again for their
 * widths. Each one is tried on its own (see refine).
 */
async function corrections(data: CompositionData, targets: Map<string, Box>, ours: Img, original: Img, paper: string): Promise<CompositionElement[]> {
  const photo = data.elements.find((e) => e.type === "photo")
  const frame = photo ? { x0: photo.x, y0: photo.y, x1: photo.x + photo.w, y1: photo.y + photo.h } : null
  const elements: CompositionElement[] = []
  for (const el of data.elements) {
    const target = targets.get(el.id)
    if (el.type !== "text" || !target) continue
    const paragraph = el.columns > 1 || (el.literal ?? "").length > 120
    const got = inkIn(ours, target, paper, frame, paragraph)
    const theirs = inkIn(original, target, paper, frame, paragraph)
    if (!got || !theirs) continue
    const next = { ...el }
    // As dark as theirs: a quarter more (or less) ink than the original's is a weight off. Not for
    // body text: its weight was found by setting it, and a photo of a print makes small type look heavier.
    const density = theirs.count / Math.max(1, got.count)
    if (!paragraph && density > 1.25 && el.font.weight < 900) next.font = { ...el.font, weight: el.font.weight + 100 }
    else if (!paragraph && density < 0.78 && el.font.weight > 100) next.font = { ...el.font, weight: el.font.weight - 100 }
    // Theirs and ours measured alike (the same box, the same padding and threshold): like with like.
    if (paragraph) {
      // A paragraph: its block's top and left onto the original's. Its line spacing was measured;
      // set in our font it may run longer or shorter, so its letter spacing makes up the lines.
      next.x += theirs.x0 - got.x0
      next.y += theirs.y0 - got.y0
      const pitch = el.size * el.leading
      const extra = Math.round((got.y1 - got.y0 - (theirs.y1 - theirs.y0)) / pitch)
      if (extra) next.tracking = Math.round(Math.min(120, Math.max(-80, el.tracking - 7 * extra)))
    } else {
      const ratio = (theirs.y1 - theirs.y0) / Math.max(1, got.y1 - got.y0)
      if (Math.abs(ratio - 1) > 0.005) next.size = el.size * ratio
      const font = await loadFont(el.font).catch(() => null)
      const words = (el.literal ?? el.text).split(/\n|\u2028/)[0]
      if (font && [...words].length > 1) {
        const plain = inkOf(font, words, next.size, 0)
        next.tracking = Math.round(Math.min(900, Math.max(-120, (((theirs.x1 - theirs.x0) - (plain.x2 - plain.x1)) * 1000) / (next.size * ([...words].length - 1)))))
      }
      // Moved by the edge it's aligned to, scaled about it.
      const dx = el.align === "right" ? theirs.x1 - got.x1 : el.align === "center" ? (theirs.x0 + theirs.x1 - got.x0 - got.x1) / 2 : theirs.x0 - got.x0
      next.x += dx
      next.y += theirs.y0 - got.y0
    }
    elements.push(next)
  }
  return elements
}

// --- Gemini's look ---

const REVIEW = {
  type: "OBJECT",
  properties: {
    fixes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { element: { type: "INTEGER" }, family: STR, weight: NUM, italic: { type: "BOOLEAN" }, color: STR, note: STR },
        required: ["element", "family", "weight", "italic", "color", "note"],
      },
    },
  },
  required: ["fixes"],
}

/** Gemini compares the two side by side and names what pixels can't: a text set in the wrong font, weight or colour. */
async function review(original: Buffer, ours: Buffer, data: CompositionData) {
  const texts = data.elements.map((e, i) => ({ e, i })).filter(({ e }) => e.type === "text") as { e: TextElement; i: number }[]
  if (!texts.length) return data
  const list = texts.map(({ e, i }) => `${i}: "${(e.literal ?? e.text).replaceAll(LINE_BREAK, " ").slice(0, 60)}" in ${e.font.family} ${e.font.weight}${e.font.italic ? " italic" : ""}, ${e.color.kind === "fixed" ? e.color.hex : "photo colour"}`).join("\n")
  const answer = await askJson<{ fixes?: { element?: number; family?: string; weight?: number; italic?: boolean; color?: string; note?: string }[] }>(
    `Image 1 is a poster; image 2 is our rebuild of it, set in the same words. Compare their lettering closely, text by text. For each text of ours below whose font family, weight, italic or colour is visibly not the original's, give the fix: the free Google Font nearest the original's lettering (exact name), its weight 100–900, italic, its colour as hex, and a note of a few words. Leave out the texts that already match. Positions and sizes are corrected separately: don't mention them.

Our texts:
${list}`,
    [original, ours],
    { schema: REVIEW, temperature: 0 }
  )
  const fixes = new Map((answer.fixes ?? []).filter((f) => Number.isInteger(f.element)).map((f) => [f.element!, f]))
  if (!fixes.size) return data
  return {
    ...data,
    elements: data.elements.map((e, i) => {
      const f = fixes.get(i)
      if (!f || e.type !== "text") return e
      return {
        ...e,
        font: { family: typeof f.family === "string" && f.family.trim() ? f.family.trim() : e.font.family, weight: Math.round(Math.min(900, Math.max(100, Number(f.weight) || e.font.weight)) / 100) * 100, italic: f.italic === true },
        ...(typeof f.color === "string" && /^#?[0-9a-f]{6}$/i.test(f.color) && { color: { kind: "fixed" as const, hex: `#${f.color.replace("#", "").toUpperCase()}` } }),
      }
    }),
  }
}

// --- The template ---

/**
 * The words become placeholders (in the case they were printed in), so the
 * layout serves any place; a text led by the place's name in bold keeps
 * that lead-in ("**{city}** {story}").
 */
function template(data: CompositionData, labels: Map<string, Role>, cases: Map<string, TextCase>): CompositionData {
  const city = data.elements.find((e) => e.type === "text" && labels.get(e.id) === "city")
  const cityWords = city?.type === "text" ? (city.literal ?? city.text).replaceAll("\n", " ").trim().toLowerCase() : ""
  return {
    ...data,
    elements: data.elements.map((e) => {
      if (e.type !== "text") return e
      const role = labels.get(e.id)
      const token = role ? PLACEHOLDER[role] : null
      if (!token) return e
      const single = role !== "description" && role !== "story"
      const lead = !single && (e.literal ?? "").replaceAll(LINE_BREAK, " ").match(/^\*\*([^*]+)\*\*/)?.[1]?.trim().toLowerCase()
      const text = lead && cityWords && lead === cityWords ? `**{city}** ${token}` : token
      return { ...e, text, case: cases.get(e.id) ?? "none", ...(single && { fit: "shrink" as const }) }
    }),
  }
}

// --- The whole rebuild ---

const PASSES = 5

/**
 * Rebuilds composition `id` from a poster image (a design file or a photo
 * of the poster), in the background; `passes` the correcting rounds at most.
 */
export async function rebuildFromImage(id: string, image: Buffer, passes = PASSES) {
  await setBusy(id, "Taking the poster out of the photo")
  void (async () => {
    try {
      const flat = await flatPoster(image)
      await saveSource(id, flat.image, flat.width, flat.height)
      await run(id, flat.image, flat.fromPhoto, passes)
    } catch (error) {
      console.error(`Composition ${id}, rebuild:`, error)
      await setBusy(id, null, (error as Error).message).catch(() => {})
    }
  })()
}

/**
 * More correcting rounds on a composition already rebuilt (or built from an
 * image before); with no passes, only compared with the original again (after
 * changes by hand).
 */
export async function improveRebuild(id: string, passes = 3) {
  const c = await getComposition(id)
  if (!c.source) throw new Error("This composition wasn't built from an image")
  await setBusy(id, passes ? "Comparing with the original again" : "Comparing with the original")
  void (async () => {
    try {
      await run(id, await readCompositionFile(id, c.source!.file), c.rebuild?.fromPhoto ?? false, passes, c.rebuild ? c : null)
    } catch (error) {
      console.error(`Composition ${id}, improving:`, error)
      await setBusy(id, null, (error as Error).message).catch(() => {})
    }
  })()
}

async function run(id: string, poster: Buffer, fromPhoto: boolean, passes: number, from: CompositionData | null = null) {
  let original = await canvasPixels(poster)
  // Out of a photo, the paper is lit unevenly: made even first, as in the print file.
  if (fromPhoto) original = evenLight(original, measurePixels(original).photo)
  const posterJpeg = await sharp(Buffer.from(original.rgb), { raw: { width: original.width, height: original.height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer()
  await setBusy(id, "Measuring every mark")
  const frame = await photoFrame(posterJpeg, original.height).catch(() => null)
  const m = measurePixels(original, frame)
  const photo = m.photo
    ? await sharp(Buffer.from(original.rgb), { raw: { width: original.width, height: original.height, channels: 3 } })
        .extract({ left: m.photo.x0, top: m.photo.y0, width: m.photo.x1 - m.photo.x0, height: m.photo.y1 - m.photo.y0 })
        .jpeg({ quality: 92 })
        .toBuffer()
    : null

  let data: CompositionData
  let targets: Map<string, Box>
  const roles = new Map<string, Role>()
  const cases = new Map<string, TextCase>()
  if (from) {
    // Improving: the layout as it is, its texts' targets found again by their words' place.
    data = { ratio: from.ratio, background: from.background, elements: from.elements, sizes: from.sizes }
    targets = new Map()
    for (const e of data.elements) {
      if (e.type !== "text" || e.literal === undefined) continue
      const mark = m.marks.reduce<Mark | null>((best, k) => (overlap(k.box, boxOf(e)) > (best ? overlap(best.box, boxOf(e)) : 0) ? k : best), null)
      if (mark) targets.set(e.id, mark.box)
    }
  } else {
    await setBusy(id, `Reading ${m.marks.length} marks`)
    const labels = await readMarks(posterJpeg, m)
    await setBusy(id, "Setting the type")
    await setBusy(id, "Finding the fonts")
    const built = await build(m, labels, original)
    data = built.data
    targets = built.targets
    // Roles and cases by element, for the template at the end.
    for (const e of data.elements) {
      if (e.type !== "text") continue
      const target = targets.get(e.id)
      const label = target ? labels.find((l, i) => l.keep && sameBox(m.marks[i].box, target)) ?? labels.find((l, i) => l.keep && overlap(m.marks[i].box, target) > 0.5) : undefined
      if (label) {
        roles.set(e.id, label.role)
        cases.set(e.id, label.case)
      }
    }
  }

  const history: { score: number; note: string }[] = []
  const best = await refine(data, targets, original, m, photo, passes, history, from ? "As it was" : "Measured and set", {
    progress: (pass, s) => setBusy(id, `Pass ${pass} of ${passes}: ${s.toFixed(1)} % alike`),
    // Once, Gemini's eye on the lettering (fonts, weights, colours).
    look: async (b) => review(posterJpeg, await toJpeg(b.ours), b.data),
  })

  const finalData = from ? best.data : template(best.data, roles, cases)
  const stamp = Date.now().toString(36)
  const files = { original: `rebuild-original-${stamp}.jpg`, ours: `rebuild-ours-${stamp}.jpg`, diff: `rebuild-diff-${stamp}.jpg`, ...(photo && { photo: `rebuild-photo-${stamp}.jpg` }) }
  await putFile(compositionFileKey(id, files.original), posterJpeg)
  await putFile(compositionFileKey(id, files.ours), await toJpeg(best.ours))
  await putFile(compositionFileKey(id, files.diff), await diffImage(original, best.ours, m.paper))
  if (photo && files.photo) await putFile(compositionFileKey(id, files.photo), photo)
  const rebuild: Rebuild = { score: best.score, passes: history, ...files, fromPhoto, at: new Date().toISOString() }
  const note = !from ? "Rebuilt from the image" : passes ? "Improved" : "Checked"
  await changeComposition(id, (c) => ({
    ...withVersion(c, finalData, `${note}: ${best.score.toFixed(1)} % alike`),
    rebuild,
    busy: undefined,
    busyError: undefined,
  }))
}

type Best = { data: CompositionData; score: number; ours: Img }

/**
 * Pass after pass of corrections, kept while they bring the layout closer
 * to the original (the photo's frame aside); `look` (Gemini's eye on the
 * lettering) once, in the second pass. Each step's score goes into `history`.
 */
async function refine(
  data: CompositionData,
  targets: Map<string, Box>,
  original: Img,
  m: Measured,
  photo: Buffer | null,
  passes: number,
  history: { score: number; note: string }[],
  first: string,
  { progress, look }: { progress?: (pass: number, score: number) => Promise<unknown>; look?: (best: Best) => Promise<CompositionData> } = {}
): Promise<Best> {
  const ours = await drawLiteral(data, photo)
  let best: Best = { data, score: score(original, ours, m.photo, m.paper), ours }
  history.push({ score: best.score, note: first })
  for (let pass = 1; pass <= passes; pass++) {
    await progress?.(pass, best.score)
    if (pass === 2 && look) {
      const reviewed = await look(best).catch(() => best.data)
      if (reviewed !== best.data) {
        const drawn = await drawLiteral(reviewed, photo)
        const s = score(original, drawn, m.photo, m.paper)
        history.push({ score: s, note: "Lettering looked over" })
        if (s >= best.score - 0.3) best = { data: reviewed, score: s, ours: drawn }
      }
    }
    // Each element's correction on its own, kept when the whole comes closer.
    const before = best.score
    for (const fixed of await corrections(best.data, targets, best.ours, original, m.paper)) {
      const next = { ...best.data, elements: best.data.elements.map((e) => (e.id === fixed.id ? fixed : e)) }
      const drawn = await drawLiteral(next, photo)
      const s = score(original, drawn, m.photo, m.paper)
      if (s > best.score) best = { data: next, score: s, ours: drawn }
    }
    history.push({ score: best.score, note: `Pass ${pass}` })
    if (best.score <= before && pass > 2) break
  }
  return best
}

const toJpeg = (img: Img) => sharp(Buffer.from(img.rgb), { raw: { width: img.width, height: img.height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer()
const boxOf = (e: CompositionElement): Box => ({ x0: e.x, y0: e.y, x1: e.x + e.w, y1: e.y + e.h })
const sameBox = (a: Box, b: Box) => a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1
const overlap = (a: Box, b: Box) => {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
  const area = Math.max(1, (a.x1 - a.x0) * (a.y1 - a.y0))
  return (ix * iy) / area
}

export { heightOf }
