import sharp from "sharp"

import { askJson } from "@/lib/mockups/gemini"
import { quadAspect } from "@/lib/mockups/geometry"
import { refineArtwork } from "@/lib/mockups/locate"
import { unwarp } from "@/lib/mockups/sheet"
import type { Point, Quad } from "@/lib/mockups/types"

import type { PosterAnalysis, PosterLayout } from "./types"

// The posters out of someone's listing photo, flat and front-on. Gemini says
// what the photo holds (one framed print, a set of N, or the flat design
// itself) and boxes each print; their edges are then found in the pixels (as
// the steal mockups find a blank sheet's) and each is unwarped upright.

// Print sizes as height / width (5:4, 14:11, 4:3, 7:5, A-series, 3:2) and
// their landscape turns. A measured ratio this close to one is snapped to it:
// perspective and JPEG edges leave a percent or two of noise.
const PRINT_RATIOS = [1, 5 / 4, 14 / 11, 4 / 3, 7 / 5, Math.SQRT2, 3 / 2].flatMap((r) => [r, 1 / r])
const SNAP = 0.03

/** A print smaller than this share of the biggest one is decor, not the product. */
const MIN_SHARE = 0.18

function printRatio(measured: number) {
  const nearest = PRINT_RATIOS.reduce((best, r) =>
    Math.abs(Math.log(r / measured)) < Math.abs(Math.log(best / measured)) ? r : best
  )
  return Math.abs(Math.log(nearest / measured)) < SNAP ? nearest : measured
}

type Found = { layout: PosterLayout; prints: { box_2d: number[]; label: string }[] }

const LAYOUT_SCHEMA = {
  type: "OBJECT",
  properties: {
    layout: { type: "STRING", enum: ["single", "set", "flat"] },
    prints: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          box_2d: { type: "ARRAY", items: { type: "INTEGER" } },
          label: { type: "STRING" },
        },
        required: ["box_2d", "label"],
      },
    },
  },
  required: ["layout", "prints"],
}

const LAYOUT_PROMPT = (title: string) => `This is the main photo of an Etsy listing titled "${title}". The listing sells printable wall art.
Decide what the photo shows:
- "single": one poster/print is the product, shown framed or in a room. Other small prints in the background are decor, not the product.
- "set": the product is a set of several posters (e.g. "set of 3", a gallery wall sold together) — every print that belongs to the set.
- "flat": the photo IS the artwork itself, flat and edge to edge, with no frame or room around it.
For "single" and "set", list each print of the product with its 2D bounding box in "box_2d" as [ymin, xmin, ymax, xmax] normalized to 0-1000 — the printed image only, inside any frame moulding and mat — and a 2–4 word "label" naming what it shows. For "flat", list nothing, unless the image is several separate designs placed side by side (then use "set" and box each one).`

export type ExtractedPrint = { image: Buffer; label: string; width: number; height: number }

/** Every poster of the product in `photo`, in reading order. */
export async function extractPosters(
  photo: Buffer,
  title: string
): Promise<{ layout: PosterLayout; prints: ExtractedPrint[]; note?: string }> {
  const upright = await sharp(photo).rotate().jpeg({ quality: 95 }).toBuffer()
  const { width: W, height: H } = await sharp(upright).metadata()
  const found = await askJson<Found>(LAYOUT_PROMPT(title), [upright], { schema: LAYOUT_SCHEMA, temperature: 0 })

  const boxes = found.prints
    .filter((p) => Array.isArray(p.box_2d) && p.box_2d.length === 4 && p.box_2d.every(Number.isFinite))
    .map((p) => {
      const [ymin, xmin, ymax, xmax] = p.box_2d
      const [x0, x1] = [(xmin / 1000) * W!, (xmax / 1000) * W!]
      const [y0, y1] = [(ymin / 1000) * H!, (ymax / 1000) * H!]
      return { quad: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Quad, label: p.label?.trim() || "" }
    })
    .filter(({ quad }) => quad[1][0] - quad[0][0] > 24 && quad[3][1] - quad[0][1] > 24)

  if (found.layout === "flat" || boxes.length === 0) {
    const flat = await toJpeg(upright)
    return {
      layout: "flat",
      prints: [{ ...flat, label: "" }],
      note: found.layout === "flat" ? undefined : "No frame found — the whole photo is the poster",
    }
  }

  const area = ({ quad }: { quad: Quad }) => (quad[1][0] - quad[0][0]) * (quad[3][1] - quad[0][1])
  const biggest = Math.max(...boxes.map(area))
  let kept = boxes.filter((b) => area(b) >= biggest * MIN_SHARE)
  if (found.layout === "single") kept = [kept.sort((a, b) => area(b) - area(a))[0]]

  const { data, info } = await sharp(upright).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const room = { data: new Uint8ClampedArray(data), width: info.width, height: info.height }
  const prints: ExtractedPrint[] = []
  for (const box of readingOrder(kept)) {
    prints.push({ ...(await unwarpPrint(room, refineArtwork(room, box.quad))), label: box.label })
  }
  return { layout: kept.length > 1 ? "set" : "single", prints }
}

async function unwarpPrint(room: Parameters<typeof unwarp>[0], quad: Quad) {
  const length = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const width = Math.round(Math.max(length(quad[0], quad[1]), length(quad[3], quad[2])))
  const height = Math.round(width * printRatio(quadAspect(quad)))
  const [r, g, b] = unwarp(room, quad, width, height)
  const rgb = Buffer.alloc(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = r[i]
    rgb[i * 3 + 1] = g[i]
    rgb[i * 3 + 2] = b[i]
  }
  return toJpeg(await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer())
}

async function toJpeg(image: Buffer) {
  const { data, info } = await sharp(image).jpeg({ quality: 95 }).toBuffer({ resolveWithObject: true })
  return { image: data, width: info.width, height: info.height }
}

function readingOrder<T extends { quad: Quad }>(boxes: T[]) {
  // Rows top to bottom (centres within half a print's height), then left to right.
  const centre = (q: Quad) => [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[3][1]) / 2]
  const tall = (q: Quad) => q[3][1] - q[0][1]
  return [...boxes].sort((a, b) => {
    const [ax, ay] = centre(a.quad)
    const [bx, by] = centre(b.quad)
    return Math.abs(ay - by) < Math.min(tall(a.quad), tall(b.quad)) / 2 ? ax - bx : ay - by
  })
}

// --- Understanding ---

const ANALYSIS_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    subject: { type: "STRING" },
    setting: { type: "STRING" },
    action: { type: "STRING" },
    style: { type: "STRING" },
    palette: { type: "ARRAY", items: { type: "STRING" } },
    composition: { type: "STRING" },
    typography: { type: "STRING", nullable: true },
    mood: { type: "STRING" },
    audience: { type: "STRING" },
    hook: { type: "STRING" },
    swaps: {
      type: "OBJECT",
      properties: {
        subjects: { type: "ARRAY", items: { type: "STRING" } },
        settings: { type: "ARRAY", items: { type: "STRING" } },
        props: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["subjects", "settings", "props"],
    },
  },
  required: [
    "summary", "subject", "setting", "action", "style", "palette", "composition",
    "typography", "mood", "audience", "hook", "swaps",
  ],
}

const ANALYSIS_PROMPT = (title: string) => `You are an art director for a successful Etsy wall-art shop. This poster sells very well in another shop (listing title: "${title}"). Study it closely so new, original posters can be designed from what makes it work.
Return:
- summary: one vivid line of what the poster shows.
- subject, setting, action: the main character/object, where it is, what it's doing (empty string if not applicable).
- style: medium and rendering in precise art terms — how loose or tight, how thick the paint, how much detail and where, how sharply the subject stands out or melts into its surroundings, how realistic or dreamy it is (e.g. "gouache illustration, loose visible brush strokes, flat shading, slightly naive proportions, few details", "dreamy oil, the tiger half dissolved in hazy jungle colour, drips", "Japanese woodblock print, bold outlines, flat colour, washi texture").
- palette: 4–7 dominant colours as hex, most dominant first, as they are — soft, hazy, muted or pastel colours aren't neon.
- composition: framing, viewpoint, placement, negative space, borders.
- typography: the exact words on the poster and how they're lettered, or null if there is no text.
- mood: the feeling it gives, precisely: the characters' expressions and body language (e.g. eyes closed in bliss, smug side-eye), the energy (calm, cheeky, exuberant), the warmth of the light, the humour.
- audience: who buys it and which room it's for.
- hook: why it sells — the concept, joke, contrast or feeling that makes people buy it.
Describe what you see, without exaggerating: a soft, dreamy, hazy painting is no "neon-drenched", "electric" or "wild" one, and a softly painted animal isn't a realistic one.
- swaps: ideas for new posters on the same hook. subjects: 6 other characters/objects that would work just as well; settings: 6 other places; props: 6 other props/activities. Make them specific, funny or charming where the original is, and commercially appealing.`

/**
 * 2 (13 Oct): mood, style and palette read precisely (dreaminess, how the
 * subject sits in the paint, colours as they are). Version 1 called Robin's
 * dreamy jungle tiger "neon-drenched, wild, electric" with a "realistic gaze",
 * and every idea from it came out dark and realistic.
 */
export const ANALYSIS_VERSION = 2

/** What a poster is, for every prompt drawn from it. */
export async function analysePoster(poster: Buffer, title: string): Promise<PosterAnalysis> {
  const analysis = await askJson<PosterAnalysis>(ANALYSIS_PROMPT(title), [poster], { schema: ANALYSIS_SCHEMA, temperature: 0.4 })
  return { ...analysis, version: ANALYSIS_VERSION }
}
