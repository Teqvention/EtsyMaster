import sharp from "sharp"

import { deleteDoc, readDocs, writeDoc } from "@/lib/db/documents"
import { askJson } from "@/lib/mockups/gemini"
import { NotFoundError } from "@/lib/mockups/storage"
import { deleteFiles, getFile, putFile } from "@/lib/storage/files"

import { setCustomSkies, SKY_RULES, type Sky } from "./skies"

// Skies of the shop's own, made from one or more reference photos: Gemini
// reads the sky off them (its colours bottom to top, its light, its
// clouds) and writes it the way the built-in skies are written, kept bright
// and inviting. Stored as citys/skies/<id> with the photos beside it; a
// painting asked for one also gets its first photo to look at.

const DOC = (id: string) => `citys/skies/${id}`
const ID = /^[a-z0-9]{6,40}$/
const FILE = /^sky-[a-z0-9]+\.jpg$/

export const skyFileKey = (id: string, file: string) => {
  if (!ID.test(id) || !FILE.test(file)) throw new NotFoundError("Unknown file")
  return `citys/skies/${id}/${file}`
}

export type CustomSky = Sky & {
  /** Its id without the "c-" every custom sky's request id starts with. */
  key: string
  images: string[]
  /** The photos showed a dark or stormy sky: it was written as its brightest version. */
  dark?: boolean
  createdAt: string
}

/** Every custom sky, newest first; also handed to skies.ts so prompts know them. */
export async function listCustomSkies(): Promise<CustomSky[]> {
  const docs = await readDocs<CustomSky>("citys/skies/")
  const list = [...docs.values()].filter((s) => s?.id && s.prompt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  setCustomSkies(list)
  return list
}

const SKY_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    hint: { type: "STRING" },
    swatch: { type: "ARRAY", items: { type: "STRING" } },
    prompt: { type: "STRING" },
    dark: { type: "BOOLEAN" },
  },
  required: ["name", "hint", "swatch", "prompt", "dark"],
  propertyOrdering: ["dark", "swatch", "prompt", "hint", "name"],
}

/** A new sky from photos: read, written, kept. */
export async function createSky(photos: Buffer[], name?: string): Promise<CustomSky> {
  if (!photos.length) throw new Error("Add a photo of the sky")
  const images = await Promise.all(photos.slice(0, 5).map((p) => sharp(p).rotate().resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer()))
  const a = await askJson<{ name?: string; hint?: string; swatch?: string[]; prompt?: string; dark?: boolean }>(
    `${images.length === 1 ? "This photo shows" : `These ${images.length} photos show`} a sky the shop owner loves for city and travel posters. Read only the sky and its light, never the place, and write it so an image model can give any city photo exactly this sky.
- dark: true if the sky is dark, stormy, night or heavy.
- swatch: three hex colours of the sky, from the horizon up.
- prompt: one sentence, 25–45 words, like "a soft pastel sky fading from blush pink at the horizon to white above, at most a few faint wisps, calm and airy; even, gentle light...". The colours, gradient, clouds (or none), light and how it falls on the scene.${"\n"}The shop's taste rules: ${SKY_RULES} If the photos are darker than that, describe the brightest, prettiest version of the same colours.
- hint: 3–6 words for a picker ("Peach haze over turquoise").
- name: 1–3 words${name ? ` (the shop owner calls it "${name}": keep that unless it's empty)` : ""}.`,
    images,
    { schema: SKY_SCHEMA, temperature: 0.3 }
  )
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")
  const hex = (Array.isArray(a.swatch) ? a.swatch : []).filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 3)
  const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const files: string[] = []
  for (const [i, image] of images.entries()) {
    const file = `sky-${key}${i}.jpg`
    await putFile(skyFileKey(key, file), image)
    files.push(file)
  }
  const sky: CustomSky = {
    id: `c-${key}` as Sky["id"],
    key,
    name: name?.trim().slice(0, 40) || text(a.name, 40) || "My sky",
    hint: text(a.hint, 60) || "From your photos",
    swatch: hex.length === 3 ? hex : ["#f3d9c8", "#f1e6e0", "#d9e6f0"],
    prompt: text(a.prompt, 400) || "a soft, luminous sky in the colours of the shop owner's photos",
    images: files,
    ...(a.dark && { dark: true }),
    createdAt: new Date().toISOString(),
  }
  await writeDoc(DOC(key), sky)
  await listCustomSkies()
  return sky
}

export async function deleteSky(key: string) {
  if (!ID.test(key)) throw new NotFoundError("Unknown sky")
  const sky = (await listCustomSkies()).find((s) => s.key === key)
  if (!sky) throw new NotFoundError("Unknown sky")
  await deleteFiles(`citys/skies/${key}/`).catch(() => {})
  await deleteDoc(DOC(key))
  await listCustomSkies()
}

/** A custom sky's first photo, small, for the painter to look at; null for the built-in ones. */
export async function skyPhoto(id: string | undefined): Promise<Buffer | null> {
  if (!id?.startsWith("c-")) return null
  const sky = (await listCustomSkies()).find((s) => s.id === id)
  if (!sky?.images[0]) return null
  return getFile(skyFileKey(sky.key, sky.images[0]))
    .then((data) => sharp(data).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer())
    .catch(() => null)
}
