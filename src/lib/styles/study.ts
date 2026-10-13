import sharp from "sharp"

import { askJson } from "@/lib/mockups/gemini"
import { NotFoundError } from "@/lib/mockups/storage"
import { getFile } from "@/lib/storage/files"

import { fileKey, getStyle, updateStyle } from "./storage"
import type { Style, StyleStudy, StudyImage } from "./types"

// Autonomous scale paints new posters that could hang in the series, so it
// first looks at every image on the board, not the ten the guide reads:
// Gemini describes each poster on its own (subject, composition, emotion,
// paint handling, how strong a poster it is), a chunk at a time, and then
// reads the whole board again with those notes to say what the series is,
// which images share one hand (a family), what it makes you feel and never
// does, and what new posters keep and avoid. Each image carries its number
// drawn in, since Gemini miscounts images it's only told the order of.

/** Images described per call: a careful answer well inside a call's time limit (24 at once took over 3 minutes). */
const CHUNK = 6

const global = globalThis as typeof globalThis & { __styleStudyRuns?: Map<string, Promise<StyleStudy>> }
const studying = (global.__styleStudyRuns ??= new Map())

/** Whether `study` was read from the board as it is now. */
export const studyFits = (style: Style, study = style.study) =>
  !!study && study.files.length === style.images.length && study.files.every((f, i) => style.images[i]?.file === f)

/** The style's study, read again first when the board changed since (one read at a time per style). */
export async function ensureStudy(id: string): Promise<StyleStudy> {
  const style = await getStyle(id)
  if (style.study && studyFits(style)) return style.study
  let running = studying.get(id)
  if (!running) {
    running = study(id).finally(() => studying.delete(id))
    studying.set(id, running)
  }
  return running
}

async function study(id: string): Promise<StyleStudy> {
  const style = await updateStyle(id, (s) => ({
    ...s,
    studyStatus: "running",
    studyAt: new Date().toISOString(),
    studyError: undefined,
  }))
  if (!style.images.length) throw new Error("Add images to the board first")
  try {
    const files = style.images.map((i) => i.file)
    const originals = await Promise.all(files.map((file) => getFile(fileKey(id, file))))
    const detailed = await Promise.all(originals.map((data, i) => numbered(data, i + 1, 640)))
    const chunks: number[][] = []
    for (let at = 0; at < files.length; at += CHUNK) chunks.push(files.slice(at, at + CHUNK).map((_, i) => at + i + 1))
    const started = Date.now()
    const cards = (
      await Promise.all(
        chunks.map((numbers) =>
          askJson<{ images?: unknown[] }>(cardsPrompt(style.name, numbers, files.length), numbers.map((n) => detailed[n - 1]), {
            schema: CARDS_SCHEMA,
            temperature: 0.3,
          })
            .then((answer) => toCards(answer.images, numbers))
            // A chunk that fails leaves its images to the whole-board read below.
            .catch((error) => {
              console.error(`Style ${id}: describing images ${numbers.join(", ")}:`, error)
              return toCards([], numbers)
            })
        )
      )
    ).flat()
    console.log(`Style ${id}: ${files.length} images described in ${Math.round((Date.now() - started) / 1000)} s`)
    // The whole board at once, smaller, with the notes: what the series shares.
    const small = await Promise.all(originals.map((data, i) => numbered(data, i + 1, files.length > 16 ? 384 : 512)))
    const whole = await askJson<Record<string, unknown>>(seriesPrompt(style.name, cards), small, {
      schema: SERIES_SCHEMA,
      temperature: 0.3,
    })
    const result = toStudy(whole, cards, files)
    await updateStyle(id, (s) => ({ ...s, study: result, studyStatus: undefined, studyError: undefined }))
    return result
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      await updateStyle(id, (s) => ({
        ...s,
        studyStatus: "error",
        studyError: error instanceof Error ? error.message : "Couldn't study the board",
      })).catch(() => {})
    }
    throw error
  }
}

/** The image as a JPEG at most `size` px, its board number in a badge top left. */
export async function numbered(image: Buffer, n: number, size: number) {
  const resized = await sharp(image)
    .rotate()
    .resize(size, size, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true })
  const { width, height } = resized.info
  const badge = Math.round(Math.max(30, Math.min(width, height) * 0.1))
  const w = Math.round(badge * (n > 99 ? 2.4 : n > 9 ? 1.9 : 1.4))
  const h = Math.round(badge * 1.35)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${Math.round(badge * 0.22)}" fill="#111" fill-opacity="0.85"/><text x="${w / 2}" y="${Math.round(h * 0.72)}" font-family="Helvetica, Arial, sans-serif" font-size="${badge}" font-weight="700" fill="#fff" text-anchor="middle">${n}</text></svg>`
  const at = Math.round(badge * 0.3)
  return sharp(resized.data).composite([{ input: Buffer.from(svg), top: at, left: at }]).jpeg({ quality: 85 }).toBuffer()
}

// --- Prompts ---

function cardsPrompt(name: string, numbers: number[], total: number) {
  const range = numbers.length === 1 ? `image ${numbers[0]}` : `images ${numbers[0]}–${numbers[numbers.length - 1]}`
  return `You are the art director of a successful Etsy wall-art shop. These are ${range} of the ${total} images on the board of our style "${name}" — best-selling posters whose look and feeling we continue in new, original posters. Each image has its number in a dark badge in its top-left corner (the badge isn't part of the art).

Describe every image on its own, as precisely as a brief to a painter who must make the next poster of this series. Some are photos of a framed print on a wall or in someone's hands: describe only the artwork.

For each image, by its badge number:
- title: 2–5 words naming the picture.
- subject: who or what, what they do, how many.
- scene: where it happens, the props, the background.
- composition: the viewpoint (eye level, slightly from above, top-down…), the framing (close-up, half figure, full figure, wide), where the subject sits and how much of the canvas it fills, negative space, borders.
- emotion: what a viewer feels, and what makes it: the characters' expressions and body language (e.g. eyes closed in bliss, smug side-eye, lounging), the energy (calm, cheeky, exuberant), the warmth of the light, the humour.
- rendering: how it's painted — medium; stroke size relative to the canvas, thickness and looseness; edges and outlines (weight, colour, wobble); how much detail there is and where it goes; flat, shallow or deep space; texture. Exact enough to tell it apart from the other images.
- palette: 4–6 colours as hex, dominant first.
- text: the words on the poster and how they're lettered, or null.
- strength: 1–5, how strong it is as a poster on a wall (charm, clarity, instant read).

Never name artists, shops or brands.`
}

function seriesPrompt(name: string, cards: StudyImage[]) {
  return `You are the art director of a successful Etsy wall-art shop. These ${cards.length} images are the whole board of our style "${name}", each numbered in a dark badge top left. They are best sellers; we want many NEW, ORIGINAL posters that hang seamlessly next to them — same look, same feeling, new pictures.

Our notes on each image:
${cards.map(cardLine).join("\n")}

Study the board as one series and write:
- essence: 2–3 sentences — what this series is, the world it paints and why buyers love it.
- emotion: the feeling every poster shares, precisely (expressions, energy, humour, warmth of light), and what it never is (e.g. never moody, dark or melancholic; never slapstick).
- world: what recurs — subjects (kinds of characters or objects), settings, props, activities. 6–15 concrete items each, as observed.
- compositions: 4–8 recurring compositions (viewpoint, framing, where the subject sits), e.g. "one animal centred, full figure, in a clawfoot tub seen slightly from above".
- families: group the images by the hand that painted them — images sharing one rendering (medium, paint handling, edges, detail, space, palette, light). 1–5 families; every image in exactly one. For each: a short name, "look" (3–5 sentences, precise enough for a painter to match: medium, stroke size and looseness, edges and outlines, detail level, depth, palette with hex, light), and its image numbers.
- keep: 5–8 rules every new poster keeps to belong to the series.
- avoid: 5–8 things that would break it — first what image models do by default (glossy or realistic rendering, cinematic light, more detail than the board, darker or muted colours, smooth digital gradients), then what this series never does.

Never name artists, shops or brands.`
}

const cardLine = (c: StudyImage) =>
  `${c.n}. ${c.title} — ${c.subject}; ${c.scene}. Composition: ${c.composition}. Emotion: ${c.emotion}. Rendering: ${c.rendering}.${c.text ? ` Text: ${c.text}.` : ""} Strength ${c.strength}.`

// --- Answers ---

const STRING = { type: "STRING" }
const STRINGS = { type: "ARRAY", items: STRING }

const CARD_FIELDS = ["n", "title", "subject", "scene", "composition", "emotion", "rendering", "palette", "text", "strength"]
const CARDS_SCHEMA = {
  type: "OBJECT",
  properties: {
    images: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          n: { type: "INTEGER" },
          title: STRING,
          subject: STRING,
          scene: STRING,
          composition: STRING,
          emotion: STRING,
          rendering: STRING,
          palette: STRINGS,
          text: { type: "STRING", nullable: true },
          strength: { type: "INTEGER" },
        },
        required: CARD_FIELDS,
        propertyOrdering: CARD_FIELDS,
      },
    },
  },
  required: ["images"],
}

const SERIES_FIELDS = ["essence", "emotion", "world", "compositions", "families", "keep", "avoid"]
const SERIES_SCHEMA = {
  type: "OBJECT",
  properties: {
    essence: STRING,
    emotion: STRING,
    world: {
      type: "OBJECT",
      properties: { subjects: STRINGS, settings: STRINGS, props: STRINGS, activities: STRINGS },
      required: ["subjects", "settings", "props", "activities"],
    },
    compositions: STRINGS,
    families: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { name: STRING, look: STRING, images: { type: "ARRAY", items: { type: "INTEGER" } } },
        required: ["name", "look", "images"],
        propertyOrdering: ["name", "look", "images"],
      },
    },
    keep: STRINGS,
    avoid: STRINGS,
  },
  required: SERIES_FIELDS,
  propertyOrdering: SERIES_FIELDS,
}

const text = (value: unknown, max = 900) => (typeof value === "string" ? value.trim().slice(0, max) : "")
const texts = (value: unknown, max = 16) =>
  (Array.isArray(value) ? value : []).map((v) => text(v, 300)).filter(Boolean).slice(0, max)
const HEX = /^#?[0-9a-f]{6}$/i

function toCards(value: unknown, numbers: number[]): StudyImage[] {
  const got = (Array.isArray(value) ? value : []) as Record<string, unknown>[]
  return numbers.map((n, i) => {
    // By its badge number, else by its place in the answer.
    const v = got.find((c) => c?.n === n) ?? got[i] ?? {}
    return {
      n,
      title: text(v.title, 80) || `Image ${n}`,
      subject: text(v.subject),
      scene: text(v.scene),
      composition: text(v.composition),
      emotion: text(v.emotion),
      rendering: text(v.rendering),
      palette: texts(v.palette, 6).filter((h) => HEX.test(h)).map((h) => `#${h.replace("#", "").toUpperCase()}`),
      text: text(v.text, 300) || null,
      strength: Math.max(1, Math.min(5, Math.round(Number(v.strength) || 3))),
    }
  })
}

function toStudy(v: Record<string, unknown>, images: StudyImage[], files: string[]): StyleStudy {
  const world = (v.world ?? {}) as Record<string, unknown>
  const count = files.length
  const seen = new Set<number>()
  const families = (Array.isArray(v.families) ? v.families : [])
    .map((f: Record<string, unknown>) => ({
      name: text(f?.name, 80) || "Family",
      look: text(f?.look, 1400),
      images: (Array.isArray(f?.images) ? f.images : [])
        .map(Number)
        .filter((n: number) => Number.isInteger(n) && n >= 1 && n <= count && !seen.has(n) && seen.add(n)),
    }))
    .filter((f) => f.images.length)
  // An image left out of every family joins the first one.
  const missing = images.map((c) => c.n).filter((n) => !seen.has(n))
  if (missing.length) {
    if (families.length) families[0].images.push(...missing)
    else families.push({ name: "The board", look: "", images: missing })
  }
  return {
    essence: text(v.essence, 1200),
    emotion: text(v.emotion, 1200),
    world: {
      subjects: texts(world.subjects),
      settings: texts(world.settings),
      props: texts(world.props),
      activities: texts(world.activities),
    },
    compositions: texts(v.compositions, 10),
    families,
    images,
    keep: texts(v.keep, 10),
    avoid: texts(v.avoid, 10),
    files,
    at: new Date().toISOString(),
  }
}
