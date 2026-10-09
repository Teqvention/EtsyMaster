import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import sharp from "sharp"

import { NotFoundError } from "@/lib/mockups/storage"

import { MAX_IMAGES, type Style, type StyleGuide, type StyleImage, type StyleSource, type StyleSummary } from "./types"

// Styles on disk: data/styles/<id>/style.json plus the moodboard images,
// copied in (never pointing at a generation's files, which can be deleted).
const ROOT = path.join(process.cwd(), "data", "styles")
const GENERATIONS = path.join(process.cwd(), "data", "generations")

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const FILE = /^[a-z0-9][a-z0-9_-]{0,63}\.(png|jpg|jpeg|webp)$/i

// Writes to one style go one after another, so two quick changes (an upload
// and a reorder) never interleave reading and writing style.json. Guides
// being written are tracked here too: a style stored as "running" by a
// server that has since stopped isn't running any more.
const global = globalThis as typeof globalThis & {
  __styleWrites?: Map<string, Promise<unknown>>
  __styleReading?: Set<string>
}
const writes = (global.__styleWrites ??= new Map())
export const reading = (global.__styleReading ??= new Set())

function folder(id: string) {
  if (!ID.test(id)) throw new NotFoundError("Unknown style")
  return path.join(ROOT, id)
}

export function filePath(id: string, file: string) {
  if (!FILE.test(file)) throw new NotFoundError("Unknown file")
  return path.join(folder(id), file)
}

export const fileUrl = (id: string, file: string) => `/api/styles/${id}/files/${file}`

async function read(id: string): Promise<Style> {
  try {
    const style: Style = JSON.parse(await readFile(path.join(folder(id), "style.json"), "utf8"))
    return style.guideStatus === "running" && !reading.has(id) ? { ...style, guideStatus: "idle" } : style
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new NotFoundError("Unknown style")
    throw error
  }
}

export async function getStyle(id: string): Promise<Style> {
  return read(id)
}

export async function listStyles(): Promise<StyleSummary[]> {
  await mkdir(ROOT, { recursive: true })
  const styles = await Promise.all(
    (await readdir(ROOT)).filter((id) => ID.test(id)).map((id) => read(id).catch(() => null))
  )
  return styles
    .filter((s): s is Style => s !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(summary)
}

export function summary(style: Style): StyleSummary {
  return {
    id: style.id,
    name: style.name,
    guide: style.guide,
    guideStatus: style.guideStatus,
    createdAt: style.createdAt,
    updatedAt: style.updatedAt,
    count: style.images.length,
    covers: style.images.slice(0, 4).map((i) => fileUrl(style.id, i.file)),
  }
}

export function cleanName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, 60)
}

export async function createStyle(name: string): Promise<Style> {
  const clean = cleanName(name)
  if (!clean) throw new Error("Name the style")
  const now = new Date().toISOString()
  // Sortable by time, unique within a burst.
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const style: Style = {
    id,
    name: clean,
    images: [],
    guide: null,
    guideStatus: "idle",
    createdAt: now,
    updatedAt: now,
  }
  await mkdir(folder(id), { recursive: true })
  await writeFile(path.join(folder(id), "style.json"), JSON.stringify(style, null, 1))
  return style
}

/** Applies `change` to the stored style and writes it, one change at a time per style. */
export function updateStyle(id: string, change: (style: Style) => Style | Promise<Style>): Promise<Style> {
  const run = (writes.get(id) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const next = { ...(await change(await read(id))), updatedAt: new Date().toISOString() }
      await writeFile(path.join(folder(id), "style.json"), JSON.stringify(next, null, 1))
      return next
    })
  writes.set(id, run)
  return run
}

export async function deleteStyle(id: string) {
  await read(id)
  await writes.get(id)?.catch(() => {})
  await rm(folder(id), { recursive: true, force: true })
}

// --- Images ---

/** Upright JPEG, at most 2048 px on the long edge, transparency on white. */
async function normalize(data: Buffer) {
  try {
    return await sharp(data)
      .rotate()
      .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90 })
      .toBuffer({ resolveWithObject: true })
  } catch {
    throw new Error("That file isn't an image")
  }
}

/** Adds images to the end of the board; ones already copied from the same generation file are skipped. */
export async function addImages(id: string, items: { data: Buffer; from?: string }[]) {
  const prepared = await Promise.all(
    items.map(async ({ data, from }) => ({ ...(await normalize(data)), from }))
  )
  return updateStyle(id, async (style) => {
    const known = new Set(style.images.map((i) => i.from).filter(Boolean))
    const fresh = prepared.filter((p) => !p.from || !known.has(p.from))
    if (style.images.length + fresh.length > MAX_IMAGES) {
      throw new Error(`A style holds up to ${MAX_IMAGES} images`)
    }
    const now = new Date().toISOString()
    const added: StyleImage[] = []
    for (const { data, info, from } of fresh) {
      const file = `img-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.jpg`
      await writeFile(filePath(id, file), data)
      added.push({ file, width: info.width, height: info.height, addedAt: now, ...(from && { from }) })
    }
    return { ...style, images: [...style.images, ...added] }
  })
}

/** The image of a generation set, as a moodboard source. */
export async function readGenerationFile(generation: string, file: string) {
  return readFile(generationPath(generation, file))
}

export function generationPath(generation: string, file: string) {
  if (!ID.test(generation) || !FILE.test(file)) throw new NotFoundError("Unknown file")
  return path.join(GENERATIONS, generation, file)
}

export async function removeImage(id: string, file: string) {
  const style = await updateStyle(id, (s) => {
    if (!s.images.some((i) => i.file === file)) throw new NotFoundError("Unknown image")
    return { ...s, images: s.images.filter((i) => i.file !== file) }
  })
  await rm(filePath(id, file), { force: true })
  return style
}

export function reorderImages(id: string, order: string[]) {
  return updateStyle(id, (s) => {
    const rank = new Map(order.map((file, i) => [file, i]))
    // Files the order doesn't mention (added meanwhile) keep their place at the end.
    const images = s.images.toSorted(
      (a, b) => (rank.get(a.file) ?? Infinity) - (rank.get(b.file) ?? Infinity)
    )
    return { ...s, images }
  })
}

/** Moodboard images for a prompt: `limit` of them spread evenly over the board, 1280 px JPEGs. */
export async function styleImages(id: string, limit = 6): Promise<Buffer[]> {
  const style = await read(id)
  return Promise.all(
    pick(style.images, limit).map((image) =>
      sharp(filePath(id, image.file))
        .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer()
    )
  )
}

/** `limit` items spread evenly over `list`, first and last included. */
export function pick<T>(list: T[], limit: number): T[] {
  if (list.length <= limit) return list
  if (limit <= 1) return list.slice(0, Math.max(limit, 0))
  return Array.from({ length: limit }, (_, i) => list[Math.round((i * (list.length - 1)) / (limit - 1))])
}

// --- Guide ---

const text = (value: unknown, max = 600) => (typeof value === "string" ? value.trim().slice(0, max) : "")
const list = (value: unknown, max = 12) =>
  (Array.isArray(value) ? value : []).map((v) => text(v, 240)).filter(Boolean).slice(0, max)
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** A guide in the stored shape from whatever Gemini or the editor sent; null when there's nothing usable. */
export function toGuide(value: unknown): StyleGuide | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const palette = (Array.isArray(v.palette) ? v.palette : [])
    .map((c) => {
      const hex = text((c as { hex?: unknown })?.hex, 9)
      if (!HEX.test(hex)) return null
      const digits = hex.replace("#", "")
      const full = digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits
      return { hex: `#${full.toUpperCase()}`, role: text((c as { role?: unknown })?.role, 80) }
    })
    .filter((c): c is { hex: string; role: string } => c !== null)
    .slice(0, 10)
  const guide: StyleGuide = {
    summary: text(v.summary),
    medium: text(v.medium),
    technique: text(v.technique),
    palette,
    lighting: text(v.lighting),
    composition: text(v.composition),
    detail: text(v.detail),
    typography: text(v.typography) || null,
    mood: text(v.mood),
    motifs: list(v.motifs),
    do: list(v.do),
    dont: list(v.dont),
    prompt: text(v.prompt, 2000),
  }
  return guide.summary || guide.prompt ? guide : null
}

// --- Sources ---

type StoredSet = {
  id: string
  kind?: string
  folder?: string
  createdAt?: string
  source?: { title?: string }
  posters?: { index: number; status: string; file: string | null; label?: string }[]
  outputs?: {
    id: string
    status: string
    file: string | null
    title?: string
    mode?: string
    creativity?: string
    review?: string | null
  }[]
  steps?: { key: string; status: string; file: string | null }[]
}

const STEP_LABEL: Record<string, string> = {
  poster: "Extracted",
  low: "Variant · Low",
  medium: "Variant · Medium",
  high: "Variant · High",
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Posters on the Generation page, newest set first: every extracted poster and
 * every result that wasn't turned down (approved ones first). Read straight
 * from the sets' files, so it works whatever the Generation page is doing.
 */
export async function listSources(): Promise<StyleSource[]> {
  let ids: string[] = []
  try {
    ids = (await readdir(GENERATIONS)).filter((id) => ID.test(id))
  } catch {
    return []
  }
  const sets = await Promise.all(
    ids.map(async (id) => {
      try {
        return JSON.parse(await readFile(path.join(GENERATIONS, id, "set.json"), "utf8")) as StoredSet
      } catch {
        return null
      }
    })
  )

  const sources: StyleSource[] = []
  for (const set of sets) {
    if (!set || set.kind === "mockup") continue
    const images: StyleSource["images"] = []
    const many = (set.posters?.length ?? 0) > 1
    for (const p of set.posters ?? []) {
      if (p.status === "done" && p.file) {
        images.push({ file: p.file, label: p.label ?? (many ? `Poster ${p.index + 1}` : "Extracted"), approved: false })
      }
    }
    const outputs = (set.outputs ?? []).filter((o) => o.status === "done" && o.file && o.review !== "rejected")
    for (const o of outputs.toSorted((a, b) => Number(b.review === "approved") - Number(a.review === "approved"))) {
      const label = o.title ?? `${o.mode === "idea" ? "Idea" : "Variant"}${o.creativity ? ` · ${capital(o.creativity)}` : ""}`
      images.push({ file: o.file!, label, approved: o.review === "approved" })
    }
    for (const s of set.steps ?? []) {
      if (s.status === "done" && s.file && STEP_LABEL[s.key]) {
        images.push({ file: s.file, label: STEP_LABEL[s.key], approved: false })
      }
    }
    if (images.length === 0) continue
    sources.push({
      id: set.id,
      title: set.source?.title ?? "Untitled",
      folder: set.folder ?? null,
      createdAt: set.createdAt ?? "",
      images,
    })
  }
  return sources.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
