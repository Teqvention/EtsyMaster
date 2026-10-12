import sharp from "sharp"

import { deleteDoc, readDoc, readDocs, updateDoc, writeDoc } from "@/lib/db/documents"
import { askJson } from "@/lib/mockups/gemini"
import { NotFoundError } from "@/lib/mockups/storage"
import { deleteFiles, getFile, putFile } from "@/lib/storage/files"

import type { Inspiration, InspirationGuide } from "./studio-types"

// Inspirations: looks a real city photo can take on without the place
// changing (a sunset, a pink sky, seen from above). One is a name and a few
// photos; Gemini reads the photos for what makes the look (sky, light,
// colour, moment, vantage) and writes it so it applies to any city. The
// first six come written already, so they work before any photo is added.
// Stored as citys/inspirations/<id>, photos under the same folder.

const DOC = (id: string) => `citys/inspirations/${id}`
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const FILE = /^img-[a-z0-9]+\.jpg$/

export const inspirationFileKey = (id: string, file: string) => {
  if (!ID.test(id) || !FILE.test(file)) throw new NotFoundError("Unknown file")
  return `citys/inspirations/${id}/${file}`
}
export const inspirationFileUrl = (id: string, file: string, width?: number) =>
  `/api/citys/inspirations/${id}/files/${file}${width ? `?w=${width}` : ""}`

const guide = (g: Omit<InspirationGuide, "avoid"> & { avoid?: string[] }): InspirationGuide => ({ avoid: [], ...g })

/** Looks every shop starts with: written by hand, refined once photos are added. */
const SEEDS: { id: string; name: string; guide: InspirationGuide }[] = [
  {
    id: "sunset-glow",
    name: "Sunset glow",
    guide: guide({
      summary: "Low, warm sunset light over the city, the sky glowing from gold to soft coral.",
      sky: "a clear to lightly clouded sky shading from warm gold near the horizon to soft coral and peach above, clouds lit from below",
      light: "low golden sunlight raking across facades from the side, long soft shadows, warm highlights on stone and glass",
      colour: "warm golds, apricot and coral, with deep but not black shadows; water picks up the sky's warmth",
      moment: "the last half hour before sunset, clear weather",
      vantage: "",
      prompt: "Bathe the scene in low golden sunset light: facades glow warm, shadows stretch long and soft, the sky shades from gold at the horizon to coral and peach above with a few clouds lit from below. Keep it natural, like a real evening photograph.",
      avoid: ["a sun disc pasted into the frame", "orange oversaturation", "neon colours"],
    }),
  },
  {
    id: "pink-sky",
    name: "Pink pastel sky",
    guide: guide({
      summary: "A soft pink and white pastel sky with gentle, even light: calm, airy and romantic.",
      sky: "a smooth gradient from pale pink and blush to white and the faintest lilac, hardly any clouds or only thin wisps",
      light: "soft, even light just after sunset or before sunrise, no hard shadows, gentle glow on light facades",
      colour: "pastel pinks, cream, soft blue-grey; whites stay clean, nothing heavy or dark",
      moment: "blue-pink dusk or dawn, still air",
      vantage: "",
      prompt: "Give the photo a calm pastel sky that fades from blush pink near the horizon to white above, with soft, even dusk light, gentle highlights on facades and calm reflections. Airy and romantic, never sugary.",
      avoid: ["magenta or hot pink", "heavy clouds", "dark, muddy shadows"],
    }),
  },
  {
    id: "from-above",
    name: "From above",
    guide: guide({
      summary: "The city seen from high above, like a drone photo: rooftops, streets and coastline as a pattern.",
      sky: "little or no sky, a thin horizon band at most",
      light: "clear daylight from high up, crisp shadows that show the shapes of buildings",
      colour: "true, clear colours; water turquoise to deep blue where there is any",
      moment: "a bright clear day",
      vantage: "a high aerial or drone viewpoint looking down at 45 to 90 degrees over the same area and landmarks",
      prompt: "Show the same area and its landmarks from high above, as a drone photographer would: streets, rooftops and shoreline become a pattern, every landmark where it really is, crisp daylight shadows describing the shapes.",
      avoid: ["inventing streets or buildings to fill the view", "tilt-shift miniature blur"],
    }),
  },
  {
    id: "blue-hour",
    name: "Blue hour",
    guide: guide({
      summary: "Deep blue twilight with city lights coming on: windows, streetlights and bridges glowing warm.",
      sky: "a clear deep cobalt to indigo sky, slightly lighter at the horizon",
      light: "warm artificial light from windows, streetlights and illuminated landmarks against the blue ambient light",
      colour: "cool blues against warm amber lights, clean and balanced",
      moment: "twenty minutes after sunset",
      vantage: "",
      prompt: "Turn the moment to blue hour: a deep cobalt sky, the city's lights warm in windows, streets and on illuminated landmarks, reflections glowing in any water. Balanced and clean like a long exposure.",
      avoid: ["pitch black night", "light trails everywhere", "blown-out lights"],
    }),
  },
  {
    id: "turquoise-water",
    name: "Turquoise water",
    guide: guide({
      summary: "Bright summer light with water in clear turquoise and teal, a fresh holiday feel.",
      sky: "a clean, bright blue sky with a few white clouds",
      light: "high, bright summer sun, clear shadows",
      colour: "turquoise and teal water, white highlights, warm sand and stone; fresh but natural",
      moment: "midday to early afternoon in summer",
      vantage: "",
      prompt: "Give the scene bright summer light with water glowing clear turquoise and teal where it is shallow and deeper blue further out, a clean blue sky with a few white clouds, crisp natural colour.",
      avoid: ["neon green-blue water", "water where there is none"],
    }),
  },
  {
    id: "bright-blue",
    name: "Bright blue sky",
    guide: guide({
      summary: "A vivid, cloudless or lightly clouded deep blue sky over sunlit buildings.",
      sky: "a deep, vivid blue sky, clear or with a few crisp white cumulus clouds",
      light: "strong clear sunlight, facades bright, shadows clean",
      colour: "saturated but natural blues and whites, true colours on buildings",
      moment: "a clear day",
      vantage: "",
      prompt: "Give the photo a vivid deep blue sky with a few crisp white clouds and strong clear sunlight on the buildings, colours rich and true.",
      avoid: ["cyan or electric skies", "flat grey haze"],
    }),
  },
]

async function seed() {
  const held = await readDocs<Inspiration>("citys/inspirations/")
  if (held.size) return
  const start = Date.now()
  for (const [i, s] of SEEDS.entries()) {
    // A millisecond apart, so they list in this order.
    const at = new Date(start + i).toISOString()
    await writeDoc(DOC(s.id), { id: s.id, name: s.name, images: [], guide: s.guide, guideStatus: "idle", createdAt: at, updatedAt: at } satisfies Inspiration)
  }
}

export async function listInspirations(): Promise<Inspiration[]> {
  await seed()
  const held = await readDocs<Inspiration>("citys/inspirations/")
  return [...held.values()].filter((i) => i?.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name))
}

export async function inspiration(id: string): Promise<Inspiration> {
  if (!ID.test(id)) throw new Error("Unknown inspiration")
  const held = await readDoc<Inspiration | null>(DOC(id), null)
  if (!held) throw new Error("Unknown inspiration")
  return held
}

function change(id: string, edit: (i: Inspiration) => Inspiration) {
  return updateDoc<Inspiration | null>(DOC(id), null, (current) => {
    if (!current) throw new Error("Unknown inspiration")
    return { ...edit(current), updatedAt: new Date().toISOString() }
  }) as Promise<Inspiration>
}

export async function createInspiration(name: string) {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 48)
  if (!clean) throw new Error("Name the inspiration")
  const id = `${clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "look"}-${Math.random().toString(36).slice(2, 6)}`
  const now = new Date().toISOString()
  const fresh: Inspiration = { id, name: clean, images: [], guide: null, guideStatus: "idle", createdAt: now, updatedAt: now }
  await writeDoc(DOC(id), fresh)
  return fresh
}

export async function renameInspiration(id: string, name: string) {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 48)
  if (!clean) throw new Error("Name the inspiration")
  return change(id, (i) => ({ ...i, name: clean }))
}

export async function deleteInspiration(id: string) {
  await inspiration(id)
  await deleteDoc(DOC(id))
  await deleteFiles(`citys/inspirations/${id}/`)
}

/** Adds photos and reads the look again from all of them. */
export async function addInspirationImages(id: string, images: Buffer[]) {
  const added: Inspiration["images"] = []
  for (const data of images.slice(0, 8)) {
    const { data: jpeg, info } = await sharp(data).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true })
    const file = `img-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.jpg`
    await putFile(inspirationFileKey(id, file), jpeg)
    added.push({ file, width: info.width, height: info.height, addedAt: new Date().toISOString() })
  }
  const next = await change(id, (i) => ({ ...i, images: [...i.images, ...added].slice(-8), guideStatus: "running", guideError: undefined }))
  void readLook(id)
  return next
}

export async function removeInspirationImage(id: string, file: string) {
  return change(id, (i) => ({ ...i, images: i.images.filter((img) => img.file !== file) }))
}

/** Up to `limit` of its photos, small, for a prompt. */
export async function inspirationImages(id: string, limit = 2) {
  const found = await inspiration(id)
  return Promise.all(
    found.images.slice(0, limit).map((img) =>
      getFile(inspirationFileKey(id, img.file)).then((d) => sharp(d).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer())
    )
  )
}

const STRING = { type: "STRING" }
const SCHEMA = {
  type: "OBJECT",
  properties: {
    sky: STRING,
    light: STRING,
    colour: STRING,
    moment: STRING,
    vantage: STRING,
    avoid: { type: "ARRAY", items: STRING },
    summary: STRING,
    prompt: STRING,
  },
  required: ["sky", "light", "colour", "moment", "vantage", "avoid", "summary", "prompt"],
  propertyOrdering: ["sky", "light", "colour", "moment", "vantage", "avoid", "summary", "prompt"],
}

/** Reads the look off its photos (or writes it from the name when there are none). */
export async function readLook(id: string) {
  try {
    const found = await inspiration(id)
    const images = await inspirationImages(id, 6)
    const answer = await askJson<Record<string, unknown>>(
      `You are the photo editor of a shop selling real city photo posters. ${images.length ? `These ${images.length} photos show a look called "${found.name}".` : `A look is called "${found.name}".`} Describe the look so it can be applied to ANY real city photo without changing the place: what the sky is like, the light, the colours and grading, the moment (time of day, season, weather) and, only if the look is about it, the vantage point and lens. Never describe the places, buildings or subjects in the photos.

Fields:
- sky, light, colour, moment: one precise sentence each.
- vantage: one sentence if the look is about where the camera is (aerial, waterline, from a rooftop), else "".
- avoid: 2 to 4 things that would overdo the look or make it look fake.
- summary: one sentence, the look at a glance.
- prompt: 40 to 80 words for an image model, imperative: how to give a city photo this look while every building stays exactly as it is.`,
      images,
      { schema: SCHEMA, temperature: 0.4 }
    )
    const text = (k: string) => (typeof answer[k] === "string" ? (answer[k] as string).trim() : "")
    const look: InspirationGuide = {
      summary: text("summary"),
      sky: text("sky"),
      light: text("light"),
      colour: text("colour"),
      moment: text("moment"),
      vantage: text("vantage"),
      prompt: text("prompt"),
      avoid: Array.isArray(answer.avoid) ? (answer.avoid as unknown[]).filter((a): a is string => typeof a === "string").slice(0, 6) : [],
    }
    if (!look.prompt) throw new Error("Gemini sent back an empty look")
    await change(id, (i) => ({ ...i, guide: look, guideStatus: "idle", guideError: undefined }))
  } catch (error) {
    console.error(`Inspiration ${id}:`, error)
    await change(id, (i) => ({ ...i, guideStatus: "error", guideError: (error as Error).message })).catch(() => {})
  }
}
