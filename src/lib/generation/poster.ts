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
// the steal mockups find a blank sheet's), each is unwarped upright, and any
// strip of frame still at its edges is cut away.

// Print sizes as height / width (5:4, 14:11, 4:3, 7:5, A-series, 3:2) and
// their landscape turns. A measured ratio this close to one is snapped to it:
// one photo can't tell a print's true proportions, and a print shot at an
// angle measured a tenth longer than it is (a 2:3 Bauhaus print as 1:1.67,
// its circles drawn as eggs; 14 Oct).
const PRINT_RATIOS = [1, 5 / 4, 14 / 11, 4 / 3, 7 / 5, Math.SQRT2, 3 / 2].flatMap((r) => [r, 1 / r])
const SNAP = 0.12

/**
 * The shape a new poster is painted at (width / height): its reference's,
 * within the shapes prints are sold in — never longer than 2:3 either way,
 * whatever the reference measured. A long crop was painted 9:16 (14 Oct).
 */
export function printAspect(width: number, height: number) {
  return Math.min(3 / 2, Math.max(2 / 3, width / height))
}

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
  const unwarped = readingOrder(kept).map((box) => ({ print: unwarpPrint(room, refineArtwork(room, box.quad)), label: box.label }))
  const prints = await Promise.all(
    unwarped.map(async ({ print, label }) => ({ ...(await withoutFrame((await print).image)), label }))
  )
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

// --- Out of its frame ---

// A print sits deep in its frame: the box around it, snapped to the strongest
// edge, mostly took in a strip of the moulding (a dark line, an oak band), the
// mat or the wall. Nano Banana painted that strip as a frame of its own
// (Robin, 14 Oct: Brush Your Teeth, Wild West, Cheers). So every print is
// looked at once more on its own: Gemini says how far in the artwork starts
// at each side, and the cut is snapped to the step in colour where it meets
// the frame.

/**
 * 2: cut out of its frame, in a print's shape, its ground evened (14 Oct).
 * 3: its ground as photographed (15 Oct): evened, a photo's greige paper read
 * as grey paper, and the paintings kept it grey; with its glare left on,
 * Nano Banana painted cream paper (Robin preferred those). A poster cut
 * before is cut again before it's painted from.
 */
export const CUT_VERSION = 3

/** A strip deeper than this share of its side is no frame: Gemini took a printed margin or title for one (Bauhaus, 14 Oct). */
const FRAME_MAX = 0.035
/** How far either side of Gemini's line the edge is looked for, as a share of the side. */
const FRAME_SNAP = 0.012
/** A side Gemini saw nothing at is still cut at a step this strong (0–441) all along it near the border: a thin moulding line. */
const FRAME_LINE = 40
/** Taken off beyond the edge found, so not a sliver of frame is left. */
const FRAME_SAFETY = 0.004

const FRAME_SCHEMA = {
  type: "OBJECT",
  properties: { box_2d: { type: "ARRAY", items: { type: "INTEGER" } } },
  required: ["box_2d"],
}

const FRAME_PROMPT = `This image was cut out of a photo of a printed poster. It should show only the print, but its edges may still show a strip of what surrounds the print: the frame moulding, a mat (passe-partout), the wall or a shadow.
Return "box_2d" as [ymin, xmin, ymax, xmax] normalized to 0-1000: the printed artwork itself, the sheet with the design on it, tight to where it meets the frame, mat or wall. A white or coloured margin printed as part of the design belongs to the artwork. Where the print runs to the image's edge, use that edge (0 or 1000).`

/** The print without the strip of frame, mat or wall its cut still shows at any edge, in a print's shape. */
export async function withoutFrame(image: Buffer): Promise<{ image: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(image).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info
  const box = await askJson<{ box_2d?: number[] }>(FRAME_PROMPT, [image], { schema: FRAME_SCHEMA, temperature: 0 })
    .then((a) => (Array.isArray(a.box_2d) && a.box_2d.length === 4 && a.box_2d.every(Number.isFinite) ? a.box_2d : null))
    .catch(() => null)
  const [ymin, xmin, ymax, xmax] = (box ?? [0, 0, 1000, 1000]).map((v) => Math.min(1000, Math.max(0, v)) / 1000)

  const colour = (x: number, y: number) => {
    const i = (y * W + x) * 3
    return [data[i], data[i + 1], data[i + 2]]
  }
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  /** How many pixels to take off one side; `at(t, d)` is the pixel `d` in from it at `t` along it, `seen` what Gemini saw. */
  const side = (along: number, across: number, seen: number, at: (t: number, d: number) => [number, number]) => {
    const safety = Math.max(2, Math.round(across * FRAME_SAFETY))
    // A moulding line Gemini cut short (a strip a touch askew) still counts.
    const line = mouldingLine(along, across, at)
    if (seen < 1 || seen > across * FRAME_MAX) return line && line + safety
    // Snapped to the strongest step in the side's mean colour near Gemini's line,
    // over four pixels (a moulding a touch askew spreads its edge over a few).
    const reach = Math.round(seen + across * FRAME_SNAP)
    const profile: number[][] = []
    for (let d = 0; d <= reach + 2; d++) {
      const sum = [0, 0, 0]
      let n = 0
      for (let t = Math.floor(along * 0.1); t < along * 0.9; t += 2, n++) {
        const c = colour(...at(t, d))
        sum[0] += c[0]
        sum[1] += c[1]
        sum[2] += c[2]
      }
      profile.push(sum.map((v) => v / n))
    }
    let edge = -1
    let size = 0
    for (let d = Math.max(2, Math.round(seen - across * FRAME_SNAP)); d <= reach; d++) {
      const step = dist(profile[d + 2], profile[d - 2])
      if (step > size) {
        size = step
        edge = d
      }
    }
    return Math.max(size >= 10 ? edge + 2 : Math.round(seen), line) + safety
  }
  /**
   * Where a moulding line Gemini didn't see ends: a strong step in colour
   * near the border, unbroken along a long run of the side (straight, or a
   * touch askew as a wedge), cut at its deepest: Gemini missed some or cut
   * them short. Lettering near the border steps as strongly but breaks
   * between letters (Bauhaus, 14 Oct). 0: none.
   */
  const mouldingLine = (along: number, across: number, at: (t: number, d: number) => [number, number]) => {
    const reach = Math.ceil(across * 0.02)
    const local = (t: number, d: number) => {
      const [a, b, c] = [colour(...at(t - 1, d)), colour(...at(t, d)), colour(...at(t + 1, d))]
      return [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3)
    }
    let run: number[] = []
    let longest: number[] = []
    let misses = 0
    let samples = 0
    for (let t = 1; t < along - 1; t += 3, samples++) {
      let best = -1
      let size = 0
      for (let d = 2; d <= reach; d++) {
        const step = dist(local(t, d + 2), local(t, d - 2))
        if (step > size) {
          size = step
          best = d
        }
      }
      // Where the line runs here: the middle of its last few depths, so one odd step doesn't lead it astray.
      const here = run.slice(-5).toSorted((a, b) => a - b)[Math.min(run.length, 5) >> 1]
      if (size >= FRAME_LINE && (!run.length || Math.abs(best - here) <= 3)) {
        run.push(best)
        misses = 0
      } else if (!run.length || ++misses > 4) {
        // A stroke of the design crossing the line is bridged; a longer break ends it.
        run = size >= FRAME_LINE ? [best] : []
        misses = 0
      }
      if (run.length > longest.length) longest = run
    }
    if (longest.length < samples * 0.35) return 0
    // Its deepest, but for the odd stroke that stepped deeper.
    return longest.toSorted((a, b) => a - b)[Math.floor(longest.length * 0.95)] + 2
  }
  const top = side(W, H, ymin * H, (t, d) => [t, d])
  const bottom = side(W, H, H - ymax * H, (t, d) => [t, H - 1 - d])
  const left = side(H, W, xmin * W, (t, d) => [d, t])
  const right = side(H, W, W - xmax * W, (t, d) => [W - 1 - d, t])
  const width = W - left - right
  const height = H - top - bottom
  const cut = (!top && !bottom && !left && !right) || width < W * 0.85 || height < H * 0.85 ? null : { left, top, width, height }
  // In a print's shape once out of its frame, as when it was unwarped (`printRatio`).
  const w = cut?.width ?? W
  const h = Math.round(w * printRatio((cut?.height ?? H) / w))
  let out = sharp(data, { raw: { width: W, height: H, channels: 3 } })
  if (cut) out = sharp(await out.extract(cut).png().toBuffer())
  return toJpeg(await out.resize(w, h, { fit: "fill" }).png().toBuffer())
}

// --- Its ground ---

/** The colour that covers much of an image (paper behind a drawing), or null for a picture that fills it. */
async function groundColour(image: Buffer): Promise<number[] | null> {
  const { data } = await sharp(image).resize(160, 160, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const bins = new Map<number, { n: number; rgb: [number, number, number] }>()
  for (let i = 0; i < data.length; i += 3) {
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
    const bin = bins.get(key) ?? { n: 0, rgb: [0, 0, 0] }
    bin.n++
    bin.rgb[0] += data[i]
    bin.rgb[1] += data[i + 1]
    bin.rgb[2] += data[i + 2]
    bins.set(key, bin)
  }
  const top = [...bins.values()].reduce((a, b) => (b.n > a.n ? b : a))
  const mean = top.rgb.map((v) => v / top.n)
  let near = 0
  for (let i = 0; i < data.length; i += 3) {
    if (Math.hypot(data[i] - mean[0], data[i + 1] - mean[1], data[i + 2] - mean[2]) < 24) near++
  }
  return near >= (data.length / 3) * 0.45 ? mean : null
}

/**
 * The reference's ground in words, e.g. "warm beige (#eee0c9)"; null without
 * one. Nano Banana tidied a photo's beige paper into white or grey (Robin,
 * 14 Oct). A pale ground is lifted to paper brightness: a print photographed
 * in a room reads darker than it is. Lifted evenly, so a greige paper stays
 * greige rather than turning peach.
 */
export async function groundOf(image: Buffer): Promise<string | null> {
  const mean = await groundColour(image)
  if (!mean) return null
  const max = Math.max(...mean)
  const paper = max >= 150 && (max - Math.min(...mean)) / max < 0.3
  const rgb = paper ? mean.map((v) => Math.min(255, v + 238 - max)) : mean
  const hex = `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`
  return `${colourName(rgb)} (${hex})`
}

/** A plain name for a colour, as a painter would say it. */
function colourName([r, g, b]: number[]) {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const light = (max + min) / 2
  const chroma = max - min
  if (chroma < 0.05) return light > 0.92 ? "white" : light > 0.8 ? "off-white" : light < 0.15 ? "black" : light > 0.6 ? "light grey" : "grey"
  const hue = (() => {
    const [R, G, B] = [r / 255, g / 255, b / 255]
    const h = max === R ? ((G - B) / chroma) % 6 : max === G ? (B - R) / chroma + 2 : (R - G) / chroma + 4
    return (h * 60 + 360) % 360
  })()
  if (hue >= 20 && hue < 65 && chroma < 0.3 && light > 0.55) return light > 0.9 || chroma < 0.08 ? "cream" : "warm beige"
  const name =
    hue < 15 || hue >= 345 ? (light > 0.65 ? "pink" : "red")
    : hue < 45 ? (light > 0.7 ? "peach" : "orange")
    : hue < 70 ? "yellow"
    : hue < 170 ? (chroma < 0.25 ? "sage green" : "green")
    : hue < 200 ? "teal"
    : hue < 255 ? "blue"
    : hue < 290 ? "lilac"
    : "pink"
  const shade = light > 0.8 ? "pale " : light < 0.3 ? "dark " : chroma < 0.2 ? "muted " : ""
  return shade + name
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
