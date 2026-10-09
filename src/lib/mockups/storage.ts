import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import sharp from "sharp"

import { isTemplate } from "./motion"
import type { CategorySummary, Scene, SceneSummary, Template } from "./types"

// Scenes live on disk next to the app: data/mockups/<id>/scene.json plus one
// image per layer. This is a local tool, so the file system is the database.
const ROOT = path.join(process.cwd(), "data", "mockups")

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const FILE = /^[a-z0-9][a-z0-9_-]{0,63}\.(png|jpg|jpeg|webp|mp4)$/i

export class NotFoundError extends Error {}

function folder(id: string) {
  if (!ID.test(id)) throw new NotFoundError("Unknown scene")
  return path.join(ROOT, id)
}

export function filePath(id: string, file: string) {
  if (!FILE.test(file)) throw new NotFoundError("Unknown file")
  return path.join(folder(id), file)
}

export async function listScenes(): Promise<SceneSummary[]> {
  await mkdir(ROOT, { recursive: true })
  const ids = (await readdir(ROOT)).filter((id) => ID.test(id))
  const scenes = await Promise.all(
    ids.map(async (id) => {
      try {
        const scene = await getScene(id)
        // Written with the poster by the editor's save, or by the grid when missing.
        const thumb = await stat(filePath(id, "thumb.jpg"))
          .then((s) => `thumb.jpg?v=${s.mtimeMs | 0}`)
          .catch(() => null)
        return {
          id,
          name: scene.name,
          order: scene.order,
          category: scene.category,
          width: scene.width,
          height: scene.height,
          thumb,
          clips: (scene.clips ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            duration: c.duration,
            listing: c.listing,
            preview: c.preview ?? null,
          })),
        }
      } catch {
        return null
      }
    })
  )
  return scenes
    .filter((s) => s !== null)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

export async function getScene(id: string): Promise<Scene> {
  try {
    return JSON.parse(await readFile(path.join(folder(id), "scene.json"), "utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError("Unknown scene")
    }
    throw error
  }
}

export async function saveScene(scene: Scene) {
  await getScene(scene.id)
  await writeFile(
    path.join(folder(scene.id), "scene.json"),
    JSON.stringify(scene, null, 1)
  )
  // Images no layer points at any more (replaced by edits) go too, and
  // previews of clips that changed or went.
  const used = new Set(["thumb.jpg"])
  for (const layer of scene.layers) {
    if (layer.kind === "image") used.add(layer.src)
    else for (const child of layer.children) used.add(child.src)
  }
  for (const clip of scene.clips ?? []) if (clip.preview) used.add(clip.preview)
  const files = await readdir(folder(scene.id))
  await Promise.all(
    files
      .filter((f) => FILE.test(f) && !used.has(f))
      .map((f) => rm(path.join(folder(scene.id), f)))
  )
}

export async function saveFile(id: string, file: string, data: Buffer) {
  await getScene(id)
  await writeFile(filePath(id, file), data)
}

export async function deleteScene(id: string) {
  await getScene(id)
  await rm(folder(id), { recursive: true })
}

function slug(name: string) {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "mockup"
  return base
}

/** Smallest edge a room is worked at; AI renders come in at 1024 px. */
const MIN_WORK_EDGE = 2048
const MAX_WORK_EDGE = 4096

// A new scene from a room photo with an empty sheet in the frame: the photo
// becomes the background, the poster starts as a centred 5:7 rectangle.
export async function createScene(
  name: string,
  image: Buffer,
  about: Pick<Scene, "category" | "source"> = {}
): Promise<Scene> {
  await mkdir(ROOT, { recursive: true })
  const existing = new Set(await readdir(ROOT))
  // Taken by the export, reference, templates, categories and chains routes.
  existing.add("export").add("reference").add("templates").add("categories").add("chains")
  const category = about.category ? await addCategory(about.category) : undefined
  let id = slug(name)
  for (let n = 2; existing.has(id); n++) id = `${slug(name)}-${n}`

  const meta = await sharp(image).metadata()
  if (!meta.width || !meta.height) throw new Error("Not an image")
  const short = Math.min(meta.width, meta.height)
  const long = Math.max(meta.width, meta.height)
  const scale =
    short < MIN_WORK_EDGE
      ? Math.min(MIN_WORK_EDGE / short, MAX_WORK_EDGE / long)
      : Math.min(1, MAX_WORK_EDGE / long)
  const width = Math.round(meta.width * scale)
  const height = Math.round(meta.height * scale)

  await mkdir(path.join(ROOT, id))
  await sharp(image)
    .rotate()
    .resize(width, height, { kernel: "lanczos3" })
    .removeAlpha()
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toFile(path.join(ROOT, id, "background.jpg"))

  const ph = height * 0.5
  const pw = ph / 1.4
  const x0 = (width - pw) / 2
  const y0 = (height - ph) / 2
  const order = (await listScenes()).reduce((m, s) => Math.max(m, s.order), 0) + 1
  const scene: Scene = {
    version: 1,
    id,
    name,
    order,
    ...(category && { category }),
    ...(about.source && { source: about.source }),
    width,
    height,
    layers: [
      {
        id: "background",
        kind: "image",
        name: "Room",
        src: "background.jpg",
        x: 0,
        y: 0,
        width,
        height,
        blend: "normal",
        opacity: 1,
        visible: true,
        role: "background",
      },
      {
        id: "poster",
        kind: "poster",
        name: "Poster",
        quad: [
          [x0, y0],
          [x0 + pw, y0],
          [x0 + pw, y0 + ph],
          [x0, y0 + ph],
        ],
        overscan: 0.008,
        fit: "cover",
        aspect: 1.4,
        tone: true,
        blend: "normal",
        opacity: 1,
        visible: true,
        sheet: { source: "background", shine: 0.45, flat: 0.7 },
        children: [],
      },
    ],
  }
  await writeFile(path.join(ROOT, id, "scene.json"), JSON.stringify(scene, null, 1))
  return scene
}

/** Raw RGBA, shortest edge to `edge` px (Lanczos, never upscaled), JPEG quality 92. */
export async function toListingJpeg(
  rgba: Buffer,
  { width, height }: { width: number; height: number },
  edge: number
) {
  const img = sharp(rgba, { raw: { width, height, channels: 4 } })
  const f = Math.min(1, edge / Math.min(width, height))
  return img
    .resize(Math.round(width * f), Math.round(height * f), { kernel: "lanczos3" })
    .removeAlpha()
    .jpeg({ quality: 92 })
    .toBuffer()
}

// Categories mockups are filed under. One exists from the moment it's named,
// before any scene is in it (a mockup from a reference takes a minute), so
// the names are kept here as well as on the scenes.
const CATEGORIES = path.join(ROOT, "categories.json")

async function savedCategories(): Promise<string[]> {
  try {
    const list = JSON.parse(await readFile(CATEGORIES, "utf8"))
    return Array.isArray(list) ? list.filter((c) => typeof c === "string") : []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

/** Every category, A–Z, with how many scenes are in it. */
export async function listCategories(): Promise<CategorySummary[]> {
  const [saved, scenes] = await Promise.all([savedCategories(), listScenes()])
  const names = new Map<string, string>()
  const counts = new Map<string, number>()
  for (const name of saved) names.set(name.toLowerCase(), name)
  for (const { category } of scenes) {
    if (!category) continue
    const key = category.toLowerCase()
    if (!names.has(key)) names.set(key, category)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...names]
    .map(([key, name]) => ({ name, count: counts.get(key) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Adds go one after another (two at once would each drop the other's name),
// and the file is replaced whole, so a read never sees half of it.
const global = globalThis as typeof globalThis & { __categoryWrites?: Promise<unknown> }

/** Adds a category unless one by that name exists; returns the name as stored. */
export function addCategory(name: string) {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40)
  if (!clean) return Promise.reject(new Error("Category name is empty"))
  const add = (global.__categoryWrites ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const saved = await savedCategories()
      const existing = saved.find((c) => c.toLowerCase() === clean.toLowerCase())
      if (existing) return existing
      await mkdir(ROOT, { recursive: true })
      const temp = `${CATEGORIES}.${process.pid}-${Date.now()}.tmp`
      await writeFile(temp, JSON.stringify([...saved, clean], null, 1))
      await rename(temp, CATEGORIES)
      return clean
    })
  global.__categoryWrites = add
  return add
}

// Animation templates the user saved; the built-in ones live in code.
const TEMPLATES = path.join(ROOT, "templates.json")

export async function listTemplates(): Promise<Template[]> {
  try {
    const list = JSON.parse(await readFile(TEMPLATES, "utf8"))
    return Array.isArray(list) ? list.filter(isTemplate) : []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

async function writeTemplates(list: Template[]) {
  await mkdir(ROOT, { recursive: true })
  await writeFile(TEMPLATES, JSON.stringify(list, null, 1))
}

export async function addTemplate(template: Template) {
  const list = await listTemplates()
  const saved: Template = {
    id: `t-${Date.now().toString(36)}`,
    name: template.name.trim().slice(0, 80) || "Untitled",
    duration: template.duration,
    shake: template.shake ?? 0,
    keys: template.keys,
  }
  await writeTemplates([...list, saved])
  return saved
}

export async function updateTemplate(id: string, patch: Partial<Template>) {
  const list = await listTemplates()
  const i = list.findIndex((t) => t.id === id)
  if (i < 0) throw new NotFoundError("Unknown template")
  const next = { ...list[i], ...patch, id, builtIn: undefined }
  if (!isTemplate(next)) throw new Error("Invalid template")
  list[i] = next
  await writeTemplates(list)
  return next
}

export async function deleteTemplate(id: string) {
  const list = await listTemplates()
  if (!list.some((t) => t.id === id)) throw new NotFoundError("Unknown template")
  await writeTemplates(list.filter((t) => t.id !== id))
}
