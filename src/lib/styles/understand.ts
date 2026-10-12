import sharp from "sharp"

import { askJson } from "@/lib/mockups/gemini"
import { NotFoundError } from "@/lib/mockups/storage"
import { getFile } from "@/lib/storage/files"

import { readCityGuide, withVersion } from "@/lib/citys/styles"

import { fileKey, generationKey, getStyle, pick, reading, toGuide, updateStyle } from "./storage"
import { READ_IMAGES, type Style } from "./types"

// Gemini reads the whole moodboard once and writes the style guide every
// generation in this style follows. A new read starts by itself a moment
// after the board changes (so adding five images costs one read), unless the
// guide was edited by hand; then it only runs when asked.

const DEBOUNCE = 2500

const global = globalThis as typeof globalThis & {
  __styleTimers?: Map<string, ReturnType<typeof setTimeout>>
  __styleAgain?: Set<string>
}
const timers = (global.__styleTimers ??= new Map())
// Asked again while a read ran: read once more when it ends.
const again = (global.__styleAgain ??= new Set())

/** Reads the style soon, unless its guide was written by hand. */
export async function scheduleReading(id: string) {
  const style = await getStyle(id)
  if (style.guideEdited || style.images.length === 0) return
  clearTimeout(timers.get(id))
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id)
      readStyle(id)
    }, DEBOUNCE)
  )
}

/** Starts a read now and answers with the style marked as reading. */
export async function startReading(id: string): Promise<Style> {
  const style = await getStyle(id)
  if (style.images.length === 0) throw new Error("Add a few images first")
  clearTimeout(timers.get(id))
  timers.delete(id)
  readStyle(id)
  return { ...style, guideStatus: "running", guideError: undefined }
}

async function readStyle(id: string) {
  if (reading.has(id)) {
    again.add(id)
    return
  }
  reading.add(id)
  try {
    const style = await updateStyle(id, (s) => ({ ...s, guideStatus: "running", guideError: undefined }))
    if (style.images.length === 0) {
      await updateStyle(id, (s) => ({ ...s, guideStatus: "idle" }))
      return
    }
    const chosen = pick(style.images, READ_IMAGES)
    // Small enough that ten of them make a light request; plenty to see a style.
    const images = await Promise.all(
      chosen.map((image) =>
        getFile(fileKey(id, image.file)).then((data) =>
          sharp(data).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
        )
      )
    )
    // City styles are read for how they show a place too (citys/styles.ts).
    if (style.kind === "city") {
      const { guide, city, medium } = await readCityGuide(style, images)
      await updateStyle(id, (s) => ({
        ...withVersion(s, guide, city, s.city?.version ? "Read again from the board" : "First read of the board", undefined, medium),
        guideStatus: "idle",
        guideError: undefined,
        guideImages: style.images.map((i) => i.file),
        guideEdited: false,
      }))
      return
    }
    const answer = await askJson<unknown>(prompt(style.name, images.length), images, {
      schema: SCHEMA,
      temperature: 0.4,
    })
    const guide = toGuide(answer)
    if (!guide) throw new Error("Gemini sent back an empty guide — try again")
    await updateStyle(id, (s) => ({
      ...s,
      guide,
      guideStatus: "idle",
      guideError: undefined,
      guideImages: style.images.map((i) => i.file),
      guideEdited: false,
    }))
  } catch (error) {
    if (error instanceof NotFoundError) return // deleted while it was read
    console.error(`Reading style ${id}:`, error)
    await updateStyle(id, (s) => ({
      ...s,
      guideStatus: "error",
      guideError: error instanceof Error ? error.message : "Couldn't read the style",
    })).catch(() => {})
  } finally {
    reading.delete(id)
    if (again.delete(id)) readStyle(id)
  }
}

function prompt(name: string, count: number) {
  return `You are the art director of an Etsy wall-art shop. ${count === 1 ? "This image is" : `These ${count} images are`} a moodboard called "${name}": posters whose look we want to reuse. Study ${count === 1 ? "it" : "them together"} and write the style guide our illustrators — and an image model — follow to paint NEW posters on any subject in exactly this look.

Describe the shared visual language, not the subjects. Someone reading the guide should be able to paint a lighthouse, a cat or a bowl of lemons and have it hang seamlessly next to these posters. Where the images disagree, describe what they have in common and name the range.

Be concrete, like a brief to a professional illustrator: the medium and tools; how edges and outlines are drawn (weight, colour, wobble); brush, grain or print texture; how shapes are simplified; how colour is used (flat fills, gradients, limited palette, overprint, paper showing through…); where light comes from and how shadows are rendered; typical framing, scale of the subject, negative space, perspective and horizon; how much detail there is and where it goes; lettering (style, case, size, placement) if there is any.

Fields:
- medium, technique, lighting, composition, detail, mood: 1–3 precise sentences each.
- palette: 5–8 colours sampled from the images as hex, dominant first, each with its role (e.g. "background wash", "outline", "accent").
- typography: how lettering looks and sits on the poster, or null when the posters have no text.
- motifs: 3–8 recurring visual devices (e.g. "sun as a flat disc without rays", "thin off-white border"), not subjects.
- do: 4–7 concrete, checkable rules that keep a new poster in this style.
- dont: 4–7 concrete things that would break it — especially what image models do by default (e.g. "no glossy 3D shading", "no photographic depth of field").
- summary: 2–3 sentences, the look at a glance.
- prompt: one paragraph of 80–140 words of art direction for an image model: imperative, subject-free, covering medium, linework, texture, palette (with hex), light, composition, detail and lettering.

Never name artists, studios, brands or copyrighted characters. Write in English.`
}

const STRING = { type: "STRING" }
const STRINGS = { type: "ARRAY", items: STRING }

// Observations first and the summary and prompt last, so they're written from them.
const SCHEMA = {
  type: "OBJECT",
  properties: {
    medium: STRING,
    technique: STRING,
    palette: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { hex: STRING, role: STRING },
        required: ["hex", "role"],
        propertyOrdering: ["hex", "role"],
      },
    },
    lighting: STRING,
    composition: STRING,
    detail: STRING,
    typography: { type: "STRING", nullable: true },
    mood: STRING,
    motifs: STRINGS,
    do: STRINGS,
    dont: STRINGS,
    summary: STRING,
    prompt: STRING,
  },
  required: [
    "medium",
    "technique",
    "palette",
    "lighting",
    "composition",
    "detail",
    "typography",
    "mood",
    "motifs",
    "do",
    "dont",
    "summary",
    "prompt",
  ],
  propertyOrdering: [
    "medium",
    "technique",
    "palette",
    "lighting",
    "composition",
    "detail",
    "typography",
    "mood",
    "motifs",
    "do",
    "dont",
    "summary",
    "prompt",
  ],
}

// --- Name ---

/** A short name for a style made of these generated posters, unlike `taken`. */
export async function suggestName(items: { generation: string; file: string }[], taken: string[]) {
  const images = await Promise.all(
    pick(items, 6).map(({ generation, file }) =>
      getFile(generationKey(generation, file)).then((data) =>
        sharp(data).resize(512, 512, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
      )
    )
  )
  const answer = await askJson<{ name?: unknown }>(namePrompt(images.length, taken), images, {
    schema: { type: "OBJECT", properties: { name: STRING }, required: ["name"] },
    temperature: 0.9,
  })
  const name = typeof answer.name === "string" ? answer.name.trim().replace(/^["“]|["”]$/g, "").slice(0, 60) : ""
  if (!name) throw new Error("Gemini didn't suggest a name — try again")
  return { name }
}

function namePrompt(count: number, taken: string[]) {
  return `${count === 1 ? "This poster is" : `These ${count} posters are`} the moodboard of a new style for an Etsy wall-art shop. Name the style: 2–5 words in Title Case that capture the LOOK — medium, technique, palette, mood — not the subjects (e.g. "Retro Gouache Kitchen", "Chalky Pastel Riso", "Bold Flat Midcentury"). No quotes, no artist or brand names.${taken.length ? ` Don't reuse these existing names: ${taken.map((t) => `"${t}"`).join(", ")}.` : ""}`
}
