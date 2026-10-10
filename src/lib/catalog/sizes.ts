// The twelve poster sizes the shops know, as Gelato prints them: premium
// matte poster, 200 gsm uncoated. Dimensions are Gelato's own (product API),
// portrait. New listings offer nine of them (OFFERED); the price profile
// prices all twelve, for listings that have the other three.

export const SIZE_KEYS = [
  "13x18",
  "a4",
  "27x35",
  "a3",
  "30x40",
  "40x50",
  "a2",
  "45x60",
  "50x70",
  "a1",
  "60x90",
  "70x100",
] as const

export type SizeKey = (typeof SIZE_KEYS)[number]

export type PrintSize = {
  key: SizeKey
  /** The Etsy variation value existing listings use, e.g. `5 x 7″ / 13 x 18 cm`. */
  label: string
  /** For descriptions and tables: `13 x 18 cm`. */
  cm: string
  /** `5 x 7 in`, or null for A sizes without a common inch name. */
  inches: string | null
  widthMm: number
  heightMm: number
  /** Gelato product UID without orientation. */
  uid: string
}

export type Orientation = "ver" | "hor"

const PAPER = "200-gsm-80lb-uncoated_4-0"

export const SIZES: PrintSize[] = [
  { key: "13x18", label: "5 x 7″ / 13 x 18 cm", cm: "13 x 18 cm", inches: "5 x 7 in", widthMm: 130, heightMm: 180, uid: "flat_130x180-mm-5r" },
  { key: "a4", label: "8 x 12″ / 21 x 29,7 cm", cm: "21 x 29.7 cm (A4)", inches: "8 x 12 in", widthMm: 210, heightMm: 297, uid: "flat_a4-8x12-inch" },
  { key: "27x35", label: "11 x 14″ / 27 x 35 cm", cm: "27 x 35 cm", inches: "11 x 14 in", widthMm: 270, heightMm: 350, uid: "flat_270x350-mm-11x14-inch" },
  { key: "a3", label: "A3 · 29,7 x 42 cm", cm: "29.7 x 42 cm (A3)", inches: null, widthMm: 297, heightMm: 420, uid: "flat_a3" },
  { key: "30x40", label: "12 x 16″ / 30 x 40 cm", cm: "30 x 40 cm", inches: "12 x 16 in", widthMm: 300, heightMm: 400, uid: "flat_300x400-mm-12x16-inch" },
  { key: "40x50", label: "16 x 20″ / 40 x 50 cm", cm: "40 x 50 cm", inches: "16 x 20 in", widthMm: 400, heightMm: 500, uid: "flat_400x500-mm-16x20-inch" },
  { key: "a2", label: "A2 · 42 x 59,4 cm", cm: "42 x 59.4 cm (A2)", inches: null, widthMm: 420, heightMm: 594, uid: "flat_a2" },
  { key: "45x60", label: "18 x 24″ / 45 x 60 cm", cm: "45 x 60 cm", inches: "18 x 24 in", widthMm: 450, heightMm: 600, uid: "flat_450x600-mm-18x24-inch" },
  { key: "50x70", label: "20 x 28″ / 50 x 70 cm", cm: "50 x 70 cm", inches: "20 x 28 in", widthMm: 500, heightMm: 700, uid: "flat_500x700-mm-20x28-inch" },
  { key: "a1", label: "A1 · 59,4 x 84,1 cm", cm: "59.4 x 84.1 cm (A1)", inches: null, widthMm: 594, heightMm: 841, uid: "flat_a1" },
  { key: "60x90", label: "24 x 36″ / 60 x 90 cm", cm: "60 x 90 cm", inches: "24 x 36 in", widthMm: 600, heightMm: 900, uid: "flat_600x900-mm-24x36-inch" },
  { key: "70x100", label: "28 x 40″ / 70 x 100 cm", cm: "70 x 100 cm", inches: "28 x 40 in", widthMm: 700, heightMm: 1000, uid: "flat_700x1000-mm-28x40-inch" },
]

export const SIZE_BY_KEY = Object.fromEntries(SIZES.map((s) => [s.key, s])) as Record<SizeKey, PrintSize>

/**
 * The sizes a new listing offers: all but A3, A2 and A1, which sit within a
 * few centimetres of 30 x 40, 45 x 60 and 60 x 90 and only made the choice
 * longer. Every common frame keeps its size.
 */
export const OFFERED_KEYS: readonly SizeKey[] = SIZE_KEYS.filter((k) => k !== "a3" && k !== "a2" && k !== "a1")
export const OFFERED: PrintSize[] = SIZES.filter((s) => OFFERED_KEYS.includes(s.key))

export const productUid = (size: PrintSize, orientation: Orientation = "ver") =>
  `${size.uid}_${PAPER}_${orientation}`

/** The size a Gelato product UID prints, whatever its paper or orientation. */
export function sizeOfUid(uid: string | null | undefined): PrintSize | null {
  if (!uid) return null
  return SIZES.find((s) => uid.startsWith(`${s.uid}_`)) ?? null
}

/**
 * The size an Etsy variation value names: `A3 · 29,7 x 42 cm`, `50x70 cm / 20x28″`,
 * `8 x 12″ / 21 x 29,7 cm`. Centimetres decide; an A size by name otherwise.
 */
export function sizeOfLabel(label: string): PrintSize | null {
  const text = label.toLowerCase().replace(/,/g, ".")
  const cm = [...text.matchAll(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm/g)][0]
  const pairs = cm ? [cm] : [...text.matchAll(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/g)]
  for (const match of pairs) {
    const a = Number(match[1]) * 10
    const b = Number(match[2]) * 10
    const [w, h] = a < b ? [a, b] : [b, a]
    const hit = SIZES.find((s) => Math.abs(s.widthMm - w) <= 6 && Math.abs(s.heightMm - h) <= 6)
    if (hit) return hit
  }
  const named = text.match(/\ba([1-4])\b/)
  return named ? SIZE_BY_KEY[`a${named[1]}` as SizeKey] : null
}

// --- Print files ---
//
// A Gelato template's image placeholder for a size is the size plus BLEED_MM
// all round; Gelato scales a print file over it with `cover`, cuts what
// sticks out from the middle and trims the bleed off. So every size gets a
// file of exactly its placeholder's shape (pipeline/print.ts), and the
// template check holds templates to it (gelato/template.ts).

/** Gelato's bleed on posters, per side. */
export const BLEED_MM = 4

/** Gelato's minimum for posters, bleed included. */
export const PRINT_DPI = 150

/** Small sizes go up to this, as far as the art has the pixels. */
export const MAX_DPI = 300
