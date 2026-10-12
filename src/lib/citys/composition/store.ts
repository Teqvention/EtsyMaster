import { changeDoc, deleteDoc, newId, readDoc, readDocs, writeDoc } from "@/lib/db/documents"
import { NotFoundError } from "@/lib/mockups/storage"
import { deleteFiles, getFile, putFile } from "@/lib/storage/files"

import { previewJpeg } from "./raster"
import {
  SAMPLE_FACTS,
  starterData,
  type Composition,
  type CompositionCandidate,
  type CompositionData,
  type CompositionSummary,
  type CompositionVersion,
} from "./model"

// Compositions in the shared database: citys/compositions/<id>, the
// inspiration image and previews as files beside it. The editor saves the
// layout as it goes; a version is kept when asked for and whenever Gemini
// changes the layout (built from an image, a remix adopted), so every
// earlier state is one click away. Variants being tried sit apart as
// candidates, like a city style's.

const DOC = (id: string) => `citys/compositions/${id}`
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/
export const compositionFileKey = (id: string, file: string) => {
  if (!ID.test(id) || !/^[a-z0-9-]+\.(jpg|png)$/.test(file)) throw new NotFoundError("Unknown file")
  return `citys/compositions/${id}/${file}`
}
export const compositionFileUrl = (id: string, file: string, width?: number) => `/api/citys/compositions/${id}/files/${file}${width ? `?w=${width}` : ""}`

const previewFile = (c: Pick<Composition, "updatedAt">) => `preview-${Date.parse(c.updatedAt).toString(36)}.jpg`

export async function getComposition(id: string): Promise<Composition> {
  if (!ID.test(id)) throw new NotFoundError("Unknown composition")
  const held = await readDoc<Composition | null>(DOC(id), null)
  if (!held) throw new NotFoundError("Unknown composition")
  return held
}

export async function listCompositions(): Promise<CompositionSummary[]> {
  const all = await readDocs<Composition>("citys/compositions/")
  return [...all.values()]
    .filter((c) => c?.id && Array.isArray(c.elements))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((c) => ({
      id: c.id,
      name: c.name,
      ratio: c.ratio,
      version: c.version,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      ...(c.busy && { busy: c.busy }),
      elements: c.elements.length,
      preview: `/api/citys/compositions/${c.id}/preview?v=${Date.parse(c.updatedAt).toString(36)}`,
    }))
}

export async function createComposition(name: string, data: CompositionData = starterData()): Promise<Composition> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 60) || "Composition"
  const now = new Date().toISOString()
  const composition: Composition = { id: newId(), name: clean, ...data, version: 0, history: [], candidates: [], createdAt: now, updatedAt: now }
  await writeDoc(DOC(composition.id), composition)
  return composition
}

export async function changeComposition(id: string, change: (c: Composition) => Composition | Promise<Composition>) {
  const saved = await changeDoc<Composition>(DOC(id), async (c) => ({ ...(await change(c)), updatedAt: new Date().toISOString() }))
  if (!saved) throw new NotFoundError("Unknown composition")
  return saved
}

const dataOf = (c: CompositionData): CompositionData => ({ ratio: c.ratio, background: c.background, elements: c.elements, sizes: c.sizes ?? {} })

/** Keeps the layout as it is now as the next version. */
export function withVersion(c: Composition, data: CompositionData, note: string): Composition {
  const version: CompositionVersion = { id: newId(), number: c.version + 1, data: dataOf(data), note, at: new Date().toISOString() }
  return { ...c, ...dataOf(data), version: version.number, history: [...c.history, version].slice(-40) }
}

/** The editor's save: the layout, and a version when asked for. */
export function saveLayout(id: string, data: CompositionData, version?: string) {
  return changeComposition(id, (c) => (version ? withVersion(c, data, version) : { ...c, ...dataOf(data) }))
}

export function renameComposition(id: string, name: string) {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 60)
  if (!clean) throw new Error("Name the composition")
  return changeComposition(id, (c) => ({ ...c, name: clean }))
}

export async function deleteComposition(id: string) {
  await getComposition(id)
  await deleteDoc(DOC(id))
  await deleteFiles(`citys/compositions/${id}/`)
}

export async function duplicateComposition(id: string) {
  const c = await getComposition(id)
  return createComposition(`${c.name} copy`, dataOf(c))
}

export function restoreVersion(id: string, versionId: string) {
  return changeComposition(id, (c) => {
    const v = c.history.find((h) => h.id === versionId)
    if (!v) throw new NotFoundError("Unknown version")
    return withVersion(c, v.data, `Back to version ${v.number}`)
  })
}

export function addCandidates(id: string, made: Omit<CompositionCandidate, "id" | "at">[]) {
  return changeComposition(id, (c) => ({
    ...c,
    candidates: [...c.candidates, ...made.map((m) => ({ ...m, id: newId(), at: new Date().toISOString() }))].slice(-5),
  }))
}

export function adoptCandidate(id: string, candidateId: string) {
  return changeComposition(id, (c) => {
    const k = c.candidates.find((x) => x.id === candidateId)
    if (!k) throw new NotFoundError("That variant is gone")
    return { ...withVersion(c, k.data, `Adopted: ${k.label}`), candidates: [] }
  })
}

export function dropCandidate(id: string, candidateId: string) {
  return changeComposition(id, (c) => ({ ...c, candidates: c.candidates.filter((x) => x.id !== candidateId) }))
}

export async function candidateAsComposition(id: string, candidateId: string, name: string) {
  const c = await getComposition(id)
  const k = c.candidates.find((x) => x.id === candidateId)
  if (!k) throw new NotFoundError("That variant is gone")
  const made = await createComposition(name, k.data)
  await dropCandidate(id, candidateId)
  return made
}

export async function setBusy(id: string, busy: string | null, error?: string) {
  await changeComposition(id, (c) => ({ ...c, busy: busy ?? undefined, busyError: error }))
}

// --- Files ---

export async function saveSource(id: string, image: Buffer, width: number, height: number) {
  await putFile(compositionFileKey(id, "source.jpg"), image)
  return changeComposition(id, (c) => ({ ...c, source: { file: "source.jpg", width, height } }))
}

export const readCompositionFile = (id: string, file: string) => getFile(compositionFileKey(id, file))

/** The composition's preview with the sample place, made once per change and kept. */
export async function compositionPreview(id: string, sample?: Buffer | null) {
  const c = await getComposition(id)
  const file = previewFile(c)
  try {
    return await getFile(compositionFileKey(id, file))
  } catch {
    const jpeg = await previewJpeg({ data: c, facts: SAMPLE_FACTS, photo: sample ?? null, width: 720 })
    await putFile(compositionFileKey(id, file), jpeg)
    return jpeg
  }
}
