import type { SizeKey } from "@/lib/catalog/sizes"

// A composition is the layout a city photo is set in: where the photo sits
// and how big, the place's name, country, coordinates, a paragraph about it,
// rules, colour boxes and small icons. Positions are in units of a canvas
// 1000 wide; its height follows the shape (1000 ÷ ratio). Shared by the
// editor in the browser and the print files on the server, so both render
// the same thing.
//
// One layout serves every print size. The width stays 1000, so a size of
// another shape changes only the height, and each element says what it
// holds on to, like constraints in Figma: the top, the bottom, the middle,
// or both (it stretches). A photo held top and bottom grows and shrinks
// with the shape while the text below it keeps its distance to the edge:
// the margins, and so the air around everything, stay the same at every
// size. Single sizes can still be nudged by hand.

export type PhotoRole = "dominant" | "vibrant" | "muted" | "dark" | "light"

export const PHOTO_ROLES: { value: PhotoRole; label: string }[] = [
  { value: "dominant", label: "Main colour" },
  { value: "vibrant", label: "Brightest colour" },
  { value: "muted", label: "Soft colour" },
  { value: "dark", label: "Darkest colour" },
  { value: "light", label: "Lightest colour" },
]

/** A fixed colour, or one taken from the photo (with a colour for when there's none). */
export type Color = { kind: "fixed"; hex: string } | { kind: "photo"; role: PhotoRole; fallback: string }

export type Hold = "start" | "center" | "end" | "stretch"

export type ElementBase = {
  id: string
  name: string
  /** Units on a canvas 1000 wide. */
  x: number
  y: number
  w: number
  h: number
  /** What it holds on to when the shape changes: vertical only, the width never changes. */
  hold: Hold
  hidden?: boolean
  locked?: boolean
}

export type PhotoElement = ElementBase & {
  type: "photo"
  /** Where the crop centres, 0–1 across and down. */
  focusX: number
  focusY: number
  radius: number
  stroke?: { width: number; color: Color }
}

export type TextCase = "none" | "upper" | "lower" | "title"

export type TextElement = ElementBase & {
  type: "text"
  /** May hold placeholders: {city}, {country}, {coords}… */
  text: string
  font: { family: string; weight: number; italic: boolean }
  /** Font size in units. */
  size: number
  /** Letter spacing in thousandths of the font size, like Figma's %. */
  tracking: number
  /** Line height as a multiple of the font size. */
  leading: number
  align: "left" | "center" | "right" | "justify"
  vAlign: "top" | "middle" | "bottom"
  case: TextCase
  color: Color
  /** Columns the text flows through, 1–3. */
  columns: number
  gap: number
  /** Shrinks the font until the text fits its box (a long city name on one line). */
  fit: "none" | "shrink"
  opacity?: number
  /** The words as printed on the poster it was rebuilt from: what a comparison with it is set in. */
  literal?: string
}

export type RectElement = ElementBase & { type: "rect"; fill: Color; radius: number; stroke?: { width: number; color: Color }; opacity?: number }

export type LineElement = ElementBase & { type: "line"; color: Color; thickness: number }

export const ICONS = ["compass", "pin", "star", "plane", "sun", "wave", "mountain", "anchor", "heart", "globe", "camera", "dot"] as const
export type IconName = (typeof ICONS)[number]

export type IconElement = ElementBase & { type: "icon"; icon: IconName; color: Color; stroke: number }

export type CompositionElement = PhotoElement | TextElement | RectElement | LineElement | IconElement

/** One print size's own nudges, on top of the shared layout. */
export type SizeTweak = Record<string, Partial<Pick<ElementBase, "x" | "y" | "w" | "h">> & { size?: number }>

export type CompositionData = {
  /** Width ÷ height the layout was made at. */
  ratio: number
  background: Color
  elements: CompositionElement[]
  sizes: Partial<Record<SizeKey, SizeTweak>>
}

export type CompositionVersion = { id: string; number: number; data: CompositionData; note: string; at: string }

/**
 * How closely the layout matches the poster it was rebuilt from: the
 * score (0–100: its ink where the original's is, and its pixels like the
 * original's, the photo aside), each pass's, and the images compared
 * (the flat original, ours set in the original's words, where they differ).
 */
export type Rebuild = {
  score: number
  passes: { score: number; note: string }[]
  original: string
  ours: string
  diff: string
  /** The original's photo, out of its frame: what the photo frame shows when the two are laid over each other. */
  photo?: string
  /** The poster came out of a photo of it (a mockup), not a design file. */
  fromPhoto: boolean
  at: string
}
export type CompositionCandidate = { id: string; label: string; data: CompositionData; at: string }

export type Composition = CompositionData & {
  id: string
  name: string
  /** The inspiration image it was built from, if any. */
  source?: { file: string; width: number; height: number }
  version: number
  history: CompositionVersion[]
  candidates: CompositionCandidate[]
  /** Five ways to remix it, from the last time it was asked. */
  remixes?: { id: string; text: string }[]
  /** Rebuilt from an image: how closely it matches it. */
  rebuild?: Rebuild
  /** A good example of a best-selling layout: remixes and new layouts learn from these. */
  example?: boolean
  /** Building it from an image, remixing it…: what's going on, while it is. */
  busy?: string
  busyError?: string
  createdAt: string
  updatedAt: string
}

export type CompositionSummary = Pick<Composition, "id" | "name" | "ratio" | "version" | "createdAt" | "updatedAt" | "busy" | "example"> & {
  elements: number
  preview: string
  /** Rebuilt from an image: how alike it came out (0–100). */
  score?: number
}

// --- What a place puts into the placeholders ---

export type PlaceFacts = {
  city: string
  country: string
  region: string
  /** Three letters, as an airport code or the common short form ("NYC", "PRG"). */
  code: string
  lat: number | null
  lng: number | null
  /** One short line about the place. */
  tagline: string
  /** A paragraph about the place, 60 to 110 words. */
  description: string
  /** A longer text about the place, 220 to 300 words, for posters with columns of copy. */
  story?: string
  /** When it was founded, as a year or century ("1837", "c. 880"), or "". */
  founded: string
  /** Its best known sight. */
  landmark: string
}

export const PLACEHOLDERS: { token: string; label: string }[] = [
  { token: "{city}", label: "Place" },
  { token: "{country}", label: "Country" },
  { token: "{region}", label: "Region or state" },
  { token: "{code}", label: "Three-letter code" },
  { token: "{coords}", label: "Coordinates" },
  { token: "{lat}", label: "Latitude" },
  { token: "{lng}", label: "Longitude" },
  { token: "{tagline}", label: "Tagline" },
  { token: "{description}", label: "Paragraph" },
  { token: "{story}", label: "Long text (columns)" },
  { token: "{founded}", label: "Founded" },
  { token: "{landmark}", label: "Landmark" },
]

const degrees = (value: number | null, positive: string, negative: string) =>
  value === null ? "" : `${Math.abs(value).toFixed(4)}° ${value >= 0 ? positive : negative}`

/** The text with its placeholders filled from the place. */
export function fillText(text: string, facts: PlaceFacts) {
  const coords = facts.lat !== null && facts.lng !== null ? `${degrees(facts.lat, "N", "S")}, ${degrees(facts.lng, "E", "W")}` : ""
  // A text led by the place's name in bold ("**{city}** {story}") doesn't say the name twice.
  const led = (copy: string) => (/\*\*\{city\}\*\*\s*\{(story|description)\}/.test(text) ? withoutLead(copy, facts.city) : copy)
  const values: Record<string, string> = {
    city: facts.city,
    country: facts.country,
    region: facts.region,
    code: facts.code,
    coords,
    lat: degrees(facts.lat, "N", "S"),
    lng: degrees(facts.lng, "E", "W"),
    tagline: facts.tagline,
    description: led(facts.description),
    story: led(facts.story || facts.description),
    founded: facts.founded,
    landmark: facts.landmark,
  }
  return text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}

/** Copy without the place's name it starts with: "Chicago rises from…" after a bold "Chicago" reads "rises from…". */
function withoutLead(copy: string, name: string) {
  if (!name || !copy.toLowerCase().startsWith(name.toLowerCase())) return copy
  return copy.slice(name.length).replace(/^[\s,]+/, "")
}

export function applyCase(text: string, c: TextCase) {
  if (c === "upper") return text.toUpperCase()
  if (c === "lower") return text.toLowerCase()
  if (c === "title") return text.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  return text
}

/** A place to try layouts on before a real one is picked. */
export const SAMPLE_FACTS: PlaceFacts = {
  city: "Chicago",
  country: "United States",
  region: "Illinois",
  code: "CHI",
  lat: 41.8781,
  lng: -87.6298,
  tagline: "The windy city on the lake",
  description:
    "Chicago rises from the shore of Lake Michigan, a city of bold architecture and big shoulders. Its skyline grew from the ashes of the Great Fire of 1871 into one of the most admired in the world, from the steel and glass of the Loop to the bridges over the river. Summer brings festivals to the lakefront, winter brings the wind that gave the city its name.",
  story:
    "Chicago rises from the shore of Lake Michigan, a city of bold architecture and big shoulders. After the Great Fire of 1871 it rebuilt itself with a daring that gave the world the skyscraper, and its skyline still reads like a history of modern building, from the terracotta towers of the Loop to the steel and glass that crowd the river. The river itself is part of the story: engineers reversed its flow in 1900, and today architecture boats glide past the old bridges every summer evening. Neighbourhoods each keep their own character, from the brownstones of Lincoln Park to the murals of Pilsen and the jazz and blues clubs of the South Side. Millennium Park draws crowds to its gleaming sculpture and open air concerts, while the lakefront trail runs for eighteen miles beside beaches that feel far from the city. Winters are long and the wind lives up to the city's nickname, but the first warm days fill every terrace and ball park. Deep dish pizza, the Art Institute's great collections and the view from a hundred floors up all belong to a visit, and so does a walk along the lake at dawn.",
  founded: "1837",
  landmark: "Willis Tower",
}

// --- Layout ---

export const CANVAS = 1000

/** The canvas height for a shape (width ÷ height). */
export const heightOf = (ratio: number) => CANVAS / ratio

/**
 * Where each element lands at `ratio`, from the layout made at `data.ratio`:
 * held to the top it stays, to the bottom it moves with the bottom edge,
 * centred it moves half as far, stretched it grows with the canvas. A
 * size's own nudges come on top.
 */
export function layoutAt(data: CompositionData, ratio: number, size?: SizeKey): CompositionElement[] {
  const delta = heightOf(ratio) - heightOf(data.ratio)
  const tweak = size ? data.sizes[size] : undefined
  return data.elements.map((el) => {
    let { y, h } = el
    if (el.hold === "end") y += delta
    else if (el.hold === "center") y += delta / 2
    else if (el.hold === "stretch") h = Math.max(10, h + delta)
    const own = tweak?.[el.id]
    const placed = { ...el, y, h, ...(own && { x: own.x ?? el.x, y: own.y ?? y, w: own.w ?? el.w, h: own.h ?? h }) }
    if (own?.size !== undefined && placed.type === "text") (placed as TextElement).size = own.size
    return placed as CompositionElement
  })
}

// --- Defaults ---

export const newElementId = () => `el-${Math.random().toString(36).slice(2, 9)}`

export const fixed = (hex: string): Color => ({ kind: "fixed", hex })

export function textElement(patch: Partial<TextElement> = {}): TextElement {
  return {
    id: newElementId(),
    name: "Text",
    type: "text",
    x: 80,
    y: 80,
    w: 840,
    h: 90,
    hold: "start",
    text: "{city}",
    font: { family: "Inter", weight: 700, italic: false },
    size: 64,
    tracking: 0,
    leading: 1.15,
    align: "left",
    vAlign: "top",
    case: "upper",
    color: fixed("#111111"),
    columns: 1,
    gap: 28,
    fit: "shrink",
    ...patch,
  }
}

/** The layout a new composition starts with: a photo with an even white margin, the place's name and country above it. */
export function starterData(ratio = 3 / 4): CompositionData {
  const H = heightOf(ratio)
  return {
    ratio,
    background: fixed("#FFFFFF"),
    elements: [
      { id: newElementId(), name: "Photo", type: "photo", x: 70, y: 190, w: 860, h: H - 190 - 160, hold: "stretch", focusX: 0.5, focusY: 0.5, radius: 0 },
      textElement({ name: "Place", y: 80, h: 80, size: 60 }),
      textElement({ name: "Country", text: "{country}", x: 500, y: 100, w: 430, h: 40, size: 24, align: "right", font: { family: "Inter", weight: 500, italic: false }, tracking: 80, color: fixed("#3B7A8C") }),
      { id: newElementId(), name: "Rule", type: "line", x: 70, y: H - 130, w: 860, h: 4, hold: "end", color: fixed("#111111"), thickness: 2 },
      textElement({ name: "Coordinates", text: "{coords}", y: H - 115, h: 36, size: 20, align: "right", case: "none", tracking: 20, font: { family: "Inter", weight: 500, italic: false }, hold: "end", fit: "none" }),
    ],
    sizes: {},
  }
}
