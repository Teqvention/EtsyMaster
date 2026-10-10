import sharp from "sharp"

import { changeDoc, deleteDoc, readDoc, readDocs, writeDoc } from "@/lib/db/documents"
import { instanceId, isLive } from "@/lib/db/workers"
import { fileKey as generationKey, readSetFile } from "@/lib/generation/storage"
import { NotFoundError } from "@/lib/mockups/storage"
import { deleteFile, deleteFiles, getFile, putFile } from "@/lib/storage/files"

import { MAX_IMAGES, type Style, type StyleGuide, type StyleImage, type StyleSource, type StyleSummary } from "./types"

// A style is the document styles/<id>/style plus its moodboard images, files
// under styles/<id>/, copied in (never pointing at a generation's files,
// which can be deleted). A guide being written is stamped with the server
// writing it: one stored as "running" by a server that has since stopped
// isn't running any more. Saved listings on their way onto the board are
// stamped the same way.

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const FILE = /^[a-z0-9][a-z0-9_-]{0,63}\.(png|jpg|jpeg|webp)$/i

/** Guides this server is writing now. */
const global = globalThis as typeof globalThis & { __styleReading?: Set<string> }
export const reading = (global.__styleReading ??= new Set())

type Stored = Style & { runner?: string; importer?: string }

function docKey(id: string) {
  if (!ID.test(id)) throw new NotFoundError("Unknown style")
  return `styles/${id}/style`
}

/** The storage key of one of the style's images. */
export function fileKey(id: string, file: string) {
  if (!ID.test(id) || !FILE.test(file)) throw new NotFoundError("Unknown file")
  return `styles/${id}/${file}`
}

export const fileUrl = (id: string, file: string) => `/api/styles/${id}/files/${file}`

async function view(style: Stored): Promise<Style> {
  const stopped = style.guideStatus === "running" && !reading.has(style.id) && !(await isLive(style.runner))
  const dropped = !!style.incoming && !(await isLive(style.importer))
  if (!stopped && !dropped) return style
  return { ...style, ...(stopped && { guideStatus: "idle" as const }), ...(dropped && { incoming: undefined }) }
}

async function read(id: string): Promise<Style> {
  const style = await readDoc<Stored | null>(docKey(id), null)
  if (!style) throw new NotFoundError("Unknown style")
  return view(style)
}

export async function getStyle(id: string): Promise<Style> {
  return read(id)
}

export async function listStyles(): Promise<StyleSummary[]> {
  const styles = await Promise.all([...(await readDocs<Stored>("styles/", "/style")).values()].map(view))
  return styles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summary)
}

export function summary(style: Style): StyleSummary {
  return {
    id: style.id,
    name: style.name,
    guide: style.guide,
    guideStatus: style.guideStatus,
    incoming: style.incoming,
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
  await writeDoc(docKey(id), style)
  return style
}

/** Applies `change` to the stored style and writes it, after every other change to it on any server. */
export async function updateStyle(id: string, change: (style: Style) => Style | Promise<Style>): Promise<Style> {
  const saved = await changeDoc<Stored>(docKey(id), async (stored) => {
    const next: Stored = { ...(await change(await view(stored))), updatedAt: new Date().toISOString() }
    if (next.guideStatus !== "running") delete next.runner
    else if (stored.guideStatus !== "running" || !(await isLive(stored.runner))) next.runner = instanceId
    if (!next.incoming) delete next.importer
    else if (!stored.incoming || !(await isLive(stored.importer))) next.importer = instanceId
    return next
  })
  if (!saved) throw new NotFoundError("Unknown style")
  return view(saved)
}

export async function deleteStyle(id: string) {
  await read(id)
  await deleteDoc(docKey(id))
  await deleteFiles(`styles/${id}/`)
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

/**
 * Adds images to the end of the board; ones already copied from the same
 * source are skipped. More than fit is refused, or with `trim` cut short.
 */
export async function addImages(id: string, items: { data: Buffer; from?: string }[], { trim = false } = {}) {
  const prepared = await Promise.all(
    items.map(async ({ data, from }) => ({ ...(await normalize(data)), from }))
  )
  return updateStyle(id, async (style) => {
    const known = new Set(style.images.map((i) => i.from).filter(Boolean))
    let fresh = prepared.filter((p) => !p.from || !known.has(p.from))
    if (style.images.length + fresh.length > MAX_IMAGES) {
      if (!trim) throw new Error(`A style holds up to ${MAX_IMAGES} images`)
      fresh = fresh.slice(0, Math.max(0, MAX_IMAGES - style.images.length))
    }
    const now = new Date().toISOString()
    const added: StyleImage[] = []
    for (const { data, info, from } of fresh) {
      const file = `img-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.jpg`
      await putFile(fileKey(id, file), data)
      added.push({ file, width: info.width, height: info.height, addedAt: now, ...(from && { from }) })
    }
    // Whatever didn't make it last time, the board has moved on.
    return { ...style, images: [...style.images, ...added], importError: undefined }
  })
}

/** The image of a generation set, as a moodboard source. */
export const readGenerationFile = readSetFile

export { generationKey }

export async function removeImage(id: string, file: string) {
  const style = await updateStyle(id, (s) => {
    if (!s.images.some((i) => i.file === file)) throw new NotFoundError("Unknown image")
    return { ...s, images: s.images.filter((i) => i.file !== file) }
  })
  await deleteFile(fileKey(id, file))
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
      getFile(fileKey(id, image.file)).then((data) =>
        sharp(data)
          .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 88 })
          .toBuffer()
      )
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
 * from the sets' documents, so it works whatever the Generation page is doing.
 */
export async function listSources(): Promise<StyleSource[]> {
  const sets = [...(await readDocs<StoredSet>("generations/", "/set")).values()]

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
