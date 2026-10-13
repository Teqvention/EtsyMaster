import sharp from "sharp"

import { askJson } from "@/lib/mockups/gemini"
import { getStyle } from "@/lib/styles/storage"

import {
  CANVAS,
  heightOf,
  ICONS,
  newElementId,
  SAMPLE_FACTS,
  textElement,
  type Color,
  type CompositionData,
  type CompositionElement,
  type Hold,
  type IconName,
  type PhotoRole,
  type TextCase,
} from "./model"
import { previewJpeg } from "./raster"
import { addCandidates, changeComposition, exampleCompositions, getComposition, readCompositionFile, saveSource, setBusy, withVersion } from "./store"

// Gemini as the layout designer. It rebuilds a poster's layout from an
// image (every text with its words, the nearest free Google Font, size,
// spacing and colour; boxes and rules, coloured from the photo where they
// echo it; the photo's frame), then compares its rebuild with the original
// once and corrects it. It suggests five remixes and makes them, and
// combines a layout with a style or another image. Layouts come back as a
// flat list of elements on the 1000-wide canvas and are checked before use.
// Remixes and combinations see the good examples (compositions marked as
// best-selling layouts, as the posters they were rebuilt from) and the
// shop's own rules for what sells.

const PHOTO_ROLE_VALUES: PhotoRole[] = ["dominant", "vibrant", "muted", "dark", "light"]

const STR = { type: "STRING" }
const NUM = { type: "NUMBER" }
const ELEMENT = {
  type: "OBJECT",
  properties: {
    type: { type: "STRING", enum: ["photo", "text", "rect", "line", "icon"] },
    name: STR,
    x: NUM,
    y: NUM,
    w: NUM,
    h: NUM,
    hold: { type: "STRING", enum: ["start", "center", "end", "stretch"] },
    text: STR,
    fontFamily: STR,
    fontWeight: NUM,
    italic: { type: "BOOLEAN" },
    size: NUM,
    tracking: NUM,
    leading: NUM,
    align: { type: "STRING", enum: ["left", "center", "right", "justify"] },
    vAlign: { type: "STRING", enum: ["top", "middle", "bottom"] },
    case: { type: "STRING", enum: ["none", "upper", "lower", "title"] },
    color: STR,
    colorFromPhoto: { type: "STRING", enum: ["none", ...PHOTO_ROLE_VALUES] },
    columns: NUM,
    gap: NUM,
    radius: NUM,
    thickness: NUM,
    icon: { type: "STRING", enum: [...ICONS] },
  },
  // Every field, for every element: left optional, the typography came back missing. Non-text elements fill the text fields with defaults.
  required: ["type", "name", "x", "y", "w", "h", "hold", "text", "fontFamily", "fontWeight", "italic", "size", "tracking", "leading", "align", "vAlign", "case", "color", "colorFromPhoto", "columns", "gap", "radius", "thickness", "icon"],
  propertyOrdering: ["type", "name", "x", "y", "w", "h", "hold", "text", "fontFamily", "fontWeight", "italic", "size", "tracking", "leading", "align", "vAlign", "case", "color", "colorFromPhoto", "columns", "gap", "radius", "thickness", "icon"],
}
const LAYOUT_SCHEMA = {
  type: "OBJECT",
  properties: { ratio: NUM, background: STR, backgroundFromPhoto: { type: "STRING", enum: ["none", ...PHOTO_ROLE_VALUES] }, elements: { type: "ARRAY", items: ELEMENT } },
  required: ["ratio", "background", "elements"],
}

type RawElement = Partial<Record<keyof typeof ELEMENT.properties, unknown>>
type RawLayout = { ratio?: number; background?: string; backgroundFromPhoto?: string; elements?: RawElement[] }

const HEX = /^#?[0-9a-f]{6}$/i
const hexOf = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? `#${v.replace("#", "").toUpperCase()}` : fallback)
const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback)
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback)

function colorOf(hex: unknown, role: unknown, fallback: string): Color {
  const fixed = hexOf(hex, fallback)
  return typeof role === "string" && PHOTO_ROLE_VALUES.includes(role as PhotoRole) ? { kind: "photo", role: role as PhotoRole, fallback: fixed } : { kind: "fixed", hex: fixed }
}

/** A layout from Gemini's answer, made safe: inside the canvas, a photo frame, known fonts and values. */
export function toLayout(raw: RawLayout, fallbackRatio = 3 / 4): CompositionData {
  const ratio = num(raw.ratio, fallbackRatio, 0.5, 1.5)
  const H = heightOf(ratio)
  const elements: CompositionElement[] = []
  for (const e of raw.elements ?? []) {
    const x = num(e.x, 0, -50, CANVAS)
    const y = num(e.y, 0, -50, H)
    const w = num(e.w, 100, 2, CANVAS + 100)
    const h = num(e.h, 40, 1, H + 100)
    const hold = (["start", "center", "end", "stretch"].includes(str(e.hold)) ? str(e.hold) : holdFor(y, h, H, str(e.type))) as Hold
    const base = { id: newElementId(), name: str(e.name) || str(e.type), x, y, w, h, hold }
    switch (e.type) {
      case "photo":
        elements.push({ ...base, name: str(e.name) || "Photo", type: "photo", focusX: 0.5, focusY: 0.5, radius: num(e.radius, 0, 0, 400) })
        break
      case "text":
        elements.push(
          textElement({
            ...base,
            name: str(e.name) || "Text",
            text: str(e.text, "{city}"),
            font: { family: str(e.fontFamily, "Inter") || "Inter", weight: Math.round(num(e.fontWeight, 400, 100, 900) / 100) * 100, italic: e.italic === true },
            size: num(e.size, 32, 4, 400),
            tracking: num(e.tracking, 0, -100, 800),
            leading: num(e.leading, 1.2, 0.7, 3),
            align: (["left", "center", "right", "justify"].includes(str(e.align)) ? str(e.align) : "left") as "left",
            vAlign: (["top", "middle", "bottom"].includes(str(e.vAlign)) ? str(e.vAlign) : "top") as "top",
            case: (["none", "upper", "lower", "title"].includes(str(e.case)) ? str(e.case) : "none") as TextCase,
            color: colorOf(e.color, e.colorFromPhoto, "#111111"),
            columns: Math.round(num(e.columns, 1, 1, 3)),
            gap: num(e.gap, 28, 0, 200),
            fit: "shrink",
          })
        )
        break
      case "rect":
        elements.push({ ...base, name: str(e.name) || "Box", type: "rect", fill: colorOf(e.color, e.colorFromPhoto, "#EEEEEE"), radius: num(e.radius, 0, 0, 400) })
        break
      case "line":
        elements.push({ ...base, name: str(e.name) || "Rule", type: "line", color: colorOf(e.color, e.colorFromPhoto, "#111111"), thickness: num(e.thickness, 2, 0.5, 40) })
        break
      case "icon":
        elements.push({ ...base, name: str(e.name) || "Icon", type: "icon", icon: (ICONS.includes(str(e.icon) as IconName) ? str(e.icon) : "dot") as IconName, color: colorOf(e.color, e.colorFromPhoto, "#111111"), stroke: 1.6 })
        break
    }
  }
  if (!elements.some((e) => e.type === "photo")) {
    elements.unshift({ id: newElementId(), name: "Photo", type: "photo", x: 70, y: 180, w: 860, h: H - 360, hold: "stretch", focusX: 0.5, focusY: 0.5, radius: 0 })
  }
  // The photo frame first, so boxes it should sit on top of stay on top.
  return { ratio, background: colorOf(raw.background, raw.backgroundFromPhoto, "#FFFFFF"), elements, sizes: {} }
}

/** What an element holds on to, by where it sits: near the top the top, near the bottom the bottom, a photo both. */
function holdFor(y: number, h: number, H: number, type: string): Hold {
  if (type === "photo") return "stretch"
  const centre = (y + h / 2) / H
  return centre < 0.4 ? "start" : centre > 0.6 ? "end" : "center"
}

const LAYOUT_RULES = `Units: the canvas is 1000 wide; its height is 1000 ÷ ratio. x, y are the top left corner of an element's box, w, h its size, all in these units.
Elements, back to front:
- photo: the frame the city photo goes in (exactly one).
- text: "text" is the words with placeholders where the place goes: {city}, {country}, {region}, {code} (three letters), {coords}, {lat}, {lng}, {tagline}, {description} (a paragraph about the place), {founded}, {landmark}; anything else literally. fontFamily is a free Google Font, named exactly as on Google Fonts (the nearest one to the lettering), fontWeight 100–900, italic. size is the font size in units; the box must be tall enough for its lines (size × leading × lines). tracking is letter spacing in thousandths of the size (0 normal, 100–300 widely spaced). case: how it is printed. columns: 1–3 for a paragraph set in columns. color hex; colorFromPhoto when the colour echoes the photo (a sky blue, a sunset orange): dominant, vibrant, muted, dark or light; else none.
- rect: a filled box (colour, radius), colorFromPhoto as for text.
- line: a rule; the longer side of the box is its length, thickness in units.
- icon: a small symbol: compass, pin, star, plane, sun, wave, mountain, anchor, heart, globe, camera or dot.
hold: what the element keeps its distance to when the poster is printed taller or shorter: start (top), end (bottom), center, stretch (both; for the photo).`

// --- From an image ---

const IMPORT_PROMPT = `You rebuild city and travel poster layouts as editable templates. The image is a poster. Measure it precisely and rebuild its layout so the template, filled with this poster's own place, would look the same: every text, rule, box and symbol in its exact place, size, weight and spacing, and the frame of the photo.

${LAYOUT_RULES}

Measure carefully: margins, the gap between photo and text, letter heights (a font's size is about 1.4 times its capital letters' height), how widely letters are spaced, line spacing of paragraphs. Report "ratio" as width ÷ height of the poster and "background" as its paper colour. Use placeholders for whatever names or describes the place (its name, country, coordinates, the paragraph), so the template works for any place.

For every text, decide each property from what you see, never from habit: serif or sans serif and which Google Font is closest (e.g. Playfair Display, Libre Baskerville, Lora, EB Garamond, Cormorant, Inter, Montserrat, Archivo, Oswald, Bebas Neue, DM Sans, Space Grotesk…), its weight (a heavy title is 700–900, body text 300–400), whether it's centred, its case, how widely spaced its letters are, and whether a paragraph runs in 2 or 3 justified columns like a newspaper. Elements that aren't text fill the text fields with defaults (text "", fontFamily "Inter", fontWeight 400, size 12…).`

/** Builds a composition's layout from a poster image, then compares and corrects it once. */
export async function importFromImage(id: string, image: Buffer) {
  const upright = await sharp(image).rotate().resize(1800, 1800, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true })
  await saveSource(id, upright.data, upright.info.width, upright.info.height)
  await setBusy(id, "Reading the layout")
  void (async () => {
    try {
      const raw = await askJson<RawLayout>(IMPORT_PROMPT, [upright.data], { schema: LAYOUT_SCHEMA, temperature: 0.2 })
      let data = toLayout({ ...raw, ratio: raw.ratio ?? upright.info.width / upright.info.height })
      await setBusy(id, "Comparing with the original")
      data = await refine(data, upright.data).catch((error) => {
        console.warn(`Composition ${id}: refine`, error)
        return data
      })
      await changeComposition(id, (c) => ({ ...withVersion(c, data, "Built from an image"), busy: undefined, busyError: undefined }))
    } catch (error) {
      console.error(`Composition ${id}, import:`, error)
      await setBusy(id, null, (error as Error).message).catch(() => {})
    }
  })()
}

/** The picture out of the original, to fill the rebuild's frame when the two are compared. */
async function pictureFrom(original: Buffer, data: CompositionData) {
  const frame = data.elements.find((e) => e.type === "photo")
  if (!frame) return null
  const { width, height } = await sharp(original).metadata()
  const H = heightOf(data.ratio)
  const left = Math.max(0, Math.round((frame.x / CANVAS) * width!))
  const top = Math.max(0, Math.round((frame.y / H) * height!))
  const w = Math.min(width! - left, Math.round((frame.w / CANVAS) * width!))
  const h = Math.min(height! - top, Math.round((frame.h / H) * height!))
  if (w < 16 || h < 16) return null
  return sharp(original).extract({ left, top, width: w, height: h }).jpeg({ quality: 90 }).toBuffer()
}

async function refine(data: CompositionData, original: Buffer): Promise<CompositionData> {
  const picture = await pictureFrom(original, data)
  const ours = await previewJpeg({ data, facts: SAMPLE_FACTS, photo: picture, width: 900 })
  const json = JSON.stringify(data.elements.map((e, i) => ({ i, ...flat(e) })))
  const answer = await askJson<RawLayout>(
    `Image 1 is a poster. Image 2 is our template rebuilt from it, filled with a sample place (so the words may differ; judge positions, sizes, fonts, weights, spacing and colours). Compare them closely and return the corrected layout: the same elements, moved and resized where ours is off, the font, size, weight, tracking or line spacing put right where the lettering differs, missing rules, boxes or symbols added, extra ones dropped.

${LAYOUT_RULES}

OUR LAYOUT NOW (ratio ${data.ratio.toFixed(4)}):
${json}`,
    [original, ours],
    { schema: LAYOUT_SCHEMA, temperature: 0.2 }
  )
  return toLayout({ ...answer, ratio: data.ratio })
}

/** An element in the flat shape Gemini reads and writes. */
function flat(e: CompositionElement): RawElement {
  const base = { type: e.type, name: e.name, x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.w), h: Math.round(e.h), hold: e.hold }
  const colour = (c: Color) => (c.kind === "fixed" ? { color: c.hex, colorFromPhoto: "none" } : { color: c.fallback, colorFromPhoto: c.role })
  switch (e.type) {
    case "text":
      return { ...base, text: e.text, fontFamily: e.font.family, fontWeight: e.font.weight, italic: e.font.italic, size: Math.round(e.size * 10) / 10, tracking: e.tracking, leading: e.leading, align: e.align, vAlign: e.vAlign, case: e.case, columns: e.columns, gap: e.gap, ...colour(e.color) }
    case "rect":
      return { ...base, radius: e.radius, ...colour(e.fill) }
    case "line":
      return { ...base, thickness: e.thickness, ...colour(e.color) }
    case "icon":
      return { ...base, icon: e.icon, ...colour(e.color) }
    case "photo":
      return { ...base, radius: e.radius }
  }
}

// --- Remixes ---

/**
 * What the shop has learnt makes its city posters sell (Robin, 7 Oct, after
 * measuring the best-selling layouts of other shops against our own).
 */
const PRINCIPLES = `What makes city posters like ours sell (the shop's own experience):
- Everything sits in one calm block, every gap measured: the space under the last line of text equals the space between the photo and the text, margins are equal left and right, the place's name has exactly the room it needs.
- A block of copy set justified fills its block exactly, edge to edge, often in 2 or 3 columns like a newspaper; no ragged holes, no orphaned last words.
- The place's name leads, large; small type around it can carry a bold code on the left and "EST. 1624", the country or the coordinates on the right.
- High quality and clean: one font pairing, generous margins, thin rules that align with the text, no heavy black areas.`

/** Up to three good examples (not `except`), as the posters they were rebuilt from or as drawn. */
async function examples(except: string): Promise<Buffer[]> {
  const list = (await exampleCompositions().catch(() => [])).filter((c) => c.id !== except).slice(0, 3)
  const images = await Promise.all(
    list.map(async (c) => {
      const original = c.rebuild ? await readCompositionFile(c.id, c.rebuild.original).catch(() => null) : null
      const image = original ?? (await previewJpeg({ data: c, facts: SAMPLE_FACTS, photo: null, width: 700 }).catch(() => null))
      return image ? sharp(image).resize(800, 800, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer() : null
    })
  )
  return images.flatMap((i) => (i ? [i] : []))
}

/** The prompt's lines that introduce the good examples, numbered after `before` images. */
const exampleNote = (before: number, count: number) =>
  count
    ? `\n\nImage${count > 1 ? `s ${before + 1}–${before + count} are` : ` ${before + 1} is`} good example${count > 1 ? "s" : ""}: best-selling city posters. Learn what makes them work (hierarchy, proportions, margins, how type sizes relate, spacing) and design to that standard, without copying one of them.`
    : ""

export async function remixIdeas(id: string) {
  const c = await getComposition(id)
  const preview = await previewJpeg({ data: c, facts: SAMPLE_FACTS, photo: null, width: 700 })
  const shown = await examples(id)
  const answer = await askJson<{ ideas?: string[] }>(
    `You are a poster designer with a sharp eye for typography and layout. Image 1 is a city poster layout (the grey area is where the photo goes). Suggest exactly 5 remixes of it, each one sentence of at most 16 words, each a clearly different, tasteful direction a buyer would love on a wall: other typography, another arrangement, another frame for the photo, a colour block, a rule system, a bolder or quieter version. Keep each one sellable as a city poster.${exampleNote(1, shown.length)}

${PRINCIPLES}`,
    [preview, ...shown],
    { schema: { type: "OBJECT", properties: { ideas: { type: "ARRAY", items: STR } }, required: ["ideas"] }, temperature: 0.9 }
  )
  const ideas = (answer.ideas ?? []).filter((t) => typeof t === "string" && t.trim()).slice(0, 5).map((text) => ({ id: newElementId(), text: text.trim() }))
  return changeComposition(id, (x) => ({ ...x, remixes: ideas }))
}

const CREATIVITY = [
  "Change only what the instruction names, as little as possible.",
  "Follow the instruction and tidy what it touches.",
  "Follow the instruction freely; adjust spacing and typography around it.",
  "Reinterpret the layout boldly in the instruction's direction.",
  "Make a new layout in the instruction's spirit; keep only the place's information and a photo frame.",
]

async function remake(data: CompositionData, instruction: string, creativity: number, images: Buffer[] = [], shown: Buffer[] = []) {
  const json = JSON.stringify(data.elements.map((e) => flat(e)))
  const answer = await askJson<RawLayout>(
    `You redesign a city poster layout. ${instruction}
${CREATIVITY[Math.min(4, Math.max(0, creativity - 1))]}

Design with real care for posters: generous, consistent margins (at least 50 units at the edges), one clear hierarchy (the place's name leads), type sizes that suit each other, letter spacing that suits the case, lines and boxes that align with the text, nothing crammed. Keep the placeholders. Keep exactly one photo frame.${exampleNote(images.length, shown.length)}

${PRINCIPLES}

${LAYOUT_RULES}

THE LAYOUT NOW (ratio ${data.ratio.toFixed(4)}, background ${data.background.kind === "fixed" ? data.background.hex : data.background.fallback}):
${json}`,
    [...images, ...shown],
    { schema: LAYOUT_SCHEMA, temperature: 0.7 + creativity * 0.05 }
  )
  return toLayout({ ...answer, ratio: data.ratio })
}

/** Turns remix ideas (ids) or a free instruction into variants (1–5 at the top). */
export async function remix(id: string, ideaIds: string[], free: string, creativity = 3) {
  const c = await getComposition(id)
  const asks = [...(c.remixes ?? []).filter((r) => ideaIds.includes(r.id)).map((r) => r.text), ...(free.trim() ? [free.trim()] : [])]
  if (!asks.length) throw new Error("Pick an idea")
  if (c.candidates.length + asks.length > 5) throw new Error("At most 5 variants at once: adopt or drop some first")
  await setBusy(id, `Remixing ${asks.length}`)
  void (async () => {
    try {
      const made = []
      const shown = await examples(id)
      for (const ask of asks) made.push({ label: ask, data: await remake(c, `Do this: ${ask}`, creativity, [], shown) })
      await addCandidates(id, made)
      await changeComposition(id, (x) => ({ ...x, busy: undefined, remixes: (x.remixes ?? []).filter((r) => !ideaIds.includes(r.id)) }))
    } catch (error) {
      console.error(`Composition ${id}, remix:`, error)
      await setBusy(id, null, (error as Error).message).catch(() => {})
    }
  })()
}

/** Variants that combine the layout with a style's look, or with another poster image. */
export async function combine(id: string, { styleId, image, count, creativity }: { styleId?: string; image?: Buffer; count: number; creativity: number }) {
  const c = await getComposition(id)
  const n = Math.max(1, Math.min(5 - c.candidates.length, count))
  if (n < 1) throw new Error("At most 5 variants at once: adopt or drop some first")
  const style = styleId ? await getStyle(styleId).catch(() => null) : null
  if (styleId && !style?.guide) throw new Error("That style has no guide yet")
  await setBusy(id, `Combining ${n}`)
  void (async () => {
    try {
      const images = image ? [await sharp(image).rotate().resize(1400, 1400, { fit: "inside" }).jpeg({ quality: 88 }).toBuffer()] : []
      const shown = await examples(id)
      const made = []
      for (let i = 0; i < n; i++) {
        const instruction = style
          ? `Bring it together with the style "${style.name}": its palette (${style.guide!.palette.map((p) => `${p.hex} ${p.role}`).join(", ")}), its mood (${style.guide!.mood}) and its lettering (${style.guide!.typography ?? "none"}): typography, colours and decorative elements that sit naturally with posters painted in it. Variant ${i + 1} of ${n}: make it different from the others.`
          : `Image 1 is another poster. Combine our layout with what makes that poster's layout good (its typography, arrangement, framing or colour use) into a new layout. Variant ${i + 1} of ${n}: make it different from the others.`
        made.push({ label: style ? `With ${style.name}${n > 1 ? ` (${i + 1})` : ""}` : `With the image${n > 1 ? ` (${i + 1})` : ""}`, data: await remake(c, instruction, creativity, images, shown) })
      }
      await addCandidates(id, made)
      await setBusy(id, null)
    } catch (error) {
      console.error(`Composition ${id}, combine:`, error)
      await setBusy(id, null, (error as Error).message).catch(() => {})
    }
  })()
}

export { readCompositionFile }
