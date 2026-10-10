import sharp from "sharp"

import { addName, listNames } from "@/lib/categories"
import { changeDoc, deleteDoc, readDoc, readDocs, updateDoc, writeDoc } from "@/lib/db/documents"
import { deleteFile, deleteFiles, fileInfo, getFile, listFiles, putFile } from "@/lib/storage/files"

import { isTemplate } from "./motion"
import type { CategorySummary, Scene, SceneSummary, Template } from "./types"

// A scene is the document mockups/<id>/scene plus one image per layer, files
// under mockups/<id>/ (see storage/files.ts), shared by every server.

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const FILE = /^[a-z0-9][a-z0-9_-]{0,63}\.(png|jpg|jpeg|webp|mp4)$/i

export class NotFoundError extends Error {}

function docKey(id: string) {
  if (!ID.test(id)) throw new NotFoundError("Unknown scene")
  return `mockups/${id}/scene`
}

/** The storage key of one of the scene's files. */
export function fileKey(id: string, file: string) {
  if (!ID.test(id)) throw new NotFoundError("Unknown scene")
  if (!FILE.test(file)) throw new NotFoundError("Unknown file")
  return `mockups/${id}/${file}`
}

/** One of the scene's files. */
export const readSceneFile = (id: string, file: string) => getFile(fileKey(id, file))

export async function listScenes(): Promise<SceneSummary[]> {
  const stored = await readDocs<Scene>("mockups/", "/scene")
  const scenes = await Promise.all(
    [...stored.values()].map(async (scene) => {
      try {
        const id = scene.id
        // Written with the poster by the editor's save, or by the grid when missing.
        const thumb = await fileInfo(fileKey(id, "thumb.jpg"))
          .then((f) => (f ? `thumb.jpg?v=${f.hash.slice(0, 8)}` : null))
          .catch(() => null)
        return {
          id,
          name: scene.name,
          order: scene.order,
          category: scene.category,
          shop: scene.shop,
          width: scene.width,
          height: scene.height,
          thumb,
          clips: (scene.clips ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            duration: c.duration,
            video: !!c.video,
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
  const scene = await readDoc<Scene | null>(docKey(id), null)
  if (!scene) throw new NotFoundError("Unknown scene")
  return scene
}

export async function saveScene(scene: Scene) {
  if (!(await changeDoc(docKey(scene.id), () => scene))) throw new NotFoundError("Unknown scene")
  // Images no layer points at any more (replaced by edits) go too, and
  // previews of clips that changed or went.
  const used = new Set(["thumb.jpg"])
  for (const layer of scene.layers) {
    if (layer.kind === "image") used.add(layer.src)
    else for (const child of layer.children) used.add(child.src)
  }
  for (const clip of scene.clips ?? []) if (clip.preview) used.add(clip.preview)
  const prefix = `mockups/${scene.id}/`
  const files = (await listFiles(prefix)).map((f) => f.key.slice(prefix.length))
  await Promise.all(
    files.filter((f) => FILE.test(f) && !used.has(f)).map((f) => deleteFile(fileKey(scene.id, f)))
  )
}

export async function saveFile(id: string, file: string, data: Buffer) {
  await getScene(id)
  await putFile(fileKey(id, file), data)
}

export async function deleteScene(id: string) {
  await getScene(id)
  await deleteDoc(docKey(id))
  await deleteFiles(`mockups/${id}/`)
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
  about: Pick<Scene, "category" | "source" | "shop"> = {}
): Promise<Scene> {
  const existing = new Set([...(await readDocs<Scene>("mockups/", "/scene")).values()].map((s) => s.id))
  // Taken by the export, reference, templates, categories and chains routes.
  existing.add("export").add("reference").add("templates").add("categories").add("chains")
  const category = about.category ? await addCategory(about.category) : undefined
  let id = slug(name)
  for (let n = 2; existing.has(id); n++) id = `${slug(name)}-${n}`

  const { background, width, height } = await workingRoom(image)
  await putFile(fileKey(id, "background.jpg"), background)

  const order = (await listScenes()).reduce((m, s) => Math.max(m, s.order), 0) + 1
  const scene: Scene = {
    version: 1,
    id,
    name,
    order,
    ...(category && { category }),
    ...(about.source && { source: about.source }),
    ...(about.shop && { shop: about.shop }),
    width,
    height,
    layers: firstLayers(width, height, "background.jpg"),
  }
  await writeDoc(docKey(id), scene)
  return scene
}

/**
 * A new room photo under a scene that's there: its name, place, category and
 * clips stay, its layers start over like a new scene's.
 */
export async function replaceRoom(id: string, image: Buffer): Promise<Scene> {
  const scene = await getScene(id)
  const { background, width, height } = await workingRoom(image)
  // Under a new name, so nothing cached shows the old room.
  const src = `background-${Date.now().toString(36)}.jpg`
  await putFile(fileKey(id, src), background)
  // The grid draws it again with the new room.
  await deleteFile(fileKey(id, "thumb.jpg")).catch(() => {})
  const next: Scene = {
    ...scene,
    width,
    height,
    layers: firstLayers(width, height, src),
    // Previews show the old room.
    clips: scene.clips?.map((clip) => ({ ...clip, preview: undefined })),
  }
  await saveScene(next)
  return next
}

/** The photo at the size a room is worked at, as the background's JPEG. */
async function workingRoom(image: Buffer) {
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

  const background = await sharp(image)
    .rotate()
    .resize(width, height, { kernel: "lanczos3" })
    .removeAlpha()
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer()
  return { background, width, height }
}

/** The room from `src`, and the poster as a centred 5:7 rectangle over it. */
function firstLayers(width: number, height: number, src: string): Scene["layers"] {
  const ph = height * 0.5
  const pw = ph / 1.4
  const x0 = (width - pw) / 2
  const y0 = (height - ph) / 2
  return [
    {
      id: "background",
      kind: "image",
      name: "Room",
      src,
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
  ]
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

// Categories mockups are filed under (the Saved page's folders are a list of
// their own).
const CATEGORIES = "mockups/categories"

/** Every category, A–Z, with how many scenes are in it. */
export async function listCategories(): Promise<CategorySummary[]> {
  return listNames(CATEGORIES, (await listScenes()).map((s) => s.category))
}

/** Adds a category unless one by that name exists; returns the name as stored. */
export const addCategory = (name: string) => addName(CATEGORIES, name)

// Animation templates the user saved; the built-in ones live in code.
const TEMPLATES = "mockups/templates"

export async function listTemplates(): Promise<Template[]> {
  const list = await readDoc<unknown>(TEMPLATES, [])
  return Array.isArray(list) ? list.filter(isTemplate) : []
}

/** Changes the saved templates, after every other change to them on any server. */
function changeTemplates<T>(change: (list: Template[]) => { list: Template[]; result: T }) {
  let result: T
  return updateDoc<unknown>(TEMPLATES, [], (stored) => {
    const done = change(Array.isArray(stored) ? stored.filter(isTemplate) : [])
    result = done.result
    return done.list
  }).then(() => result)
}

export function addTemplate(template: Template) {
  const saved: Template = {
    id: `t-${Date.now().toString(36)}`,
    name: template.name.trim().slice(0, 80) || "Untitled",
    duration: template.duration,
    shake: template.shake ?? 0,
    keys: template.keys,
  }
  return changeTemplates((list) => ({ list: [...list, saved], result: saved }))
}

export function updateTemplate(id: string, patch: Partial<Template>) {
  return changeTemplates((list) => {
    const i = list.findIndex((t) => t.id === id)
    if (i < 0) throw new NotFoundError("Unknown template")
    const next = { ...list[i], ...patch, id, builtIn: undefined }
    if (!isTemplate(next)) throw new Error("Invalid template")
    list[i] = next
    return { list, result: next }
  })
}

export async function deleteTemplate(id: string) {
  await changeTemplates((list) => {
    if (!list.some((t) => t.id === id)) throw new NotFoundError("Unknown template")
    return { list: list.filter((t) => t.id !== id), result: undefined }
  })
}
