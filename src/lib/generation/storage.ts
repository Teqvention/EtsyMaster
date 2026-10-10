import { changeDoc, deleteDoc, readDoc, readDocs, writeDoc } from "@/lib/db/documents"
import { instanceId, isLive } from "@/lib/db/workers"
import { NotFoundError } from "@/lib/mockups/storage"
import { deleteFile, deleteFiles, getFile, putFile } from "@/lib/storage/files"

import {
  DEFAULT_OPTIONS,
  type Asset,
  type Batch,
  type GenerateOptions,
  type GenerationKind,
  type GenerationSet,
  type GenerationSource,
  type Output,
  SENDING,
} from "./types"

// A set is the document generations/<id>/set, its images files under
// generations/<id>/. Every server reads them from memory (see db/documents.ts),
// so the Generation page polling every couple of seconds costs nothing. The
// server that queued a set runs it and stamps itself on it (`runner`): when
// that server stops, the set reads as interrupted everywhere.

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const FILE = /^[a-z0-9][a-z0-9_-]{0,63}\.(png|jpg|jpeg|webp)$/i

const docKey = (id: string) => `generations/${id}/set`

type Stored = GenerationSet & { runner?: string }

const active = (set: GenerationSet) => set.status === "queued" || set.status === "running"

/** The set as the app sees it: in today's shape, and failed if the server running it is gone. */
async function view(raw: Stored & { steps?: LegacyStep[] }): Promise<GenerationSet> {
  const set = migrate(raw)
  return active(set) && !(await isLive(raw.runner)) ? interrupted(set) : set
}

/** A short id, sortable by time and unique within a batch. */
export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const pending = (): Asset => ({ status: "pending", file: null })

// Work in progress when its server stopped never finishes; say so, so it can be retried.
// Outputs in a batch job go on at Vertex: the set stays running, for the batch poller.
// Those still waiting to go out in one were that server's to send.
function interrupted(set: GenerationSet): GenerationSet {
  if (set.status !== "queued" && set.status !== "running") return set
  const stop = <T extends Asset & { job?: string }>(a: T): T =>
    (a.status === "pending" || a.status === "running") && (!a.job || a.job === SENDING)
      ? { ...a, status: "error", error: "Interrupted — the server running it stopped" }
      : a
  return {
    ...set,
    status: set.outputs.some((o) => o.job && o.job !== SENDING) ? "running" : "error",
    original: stop(set.original),
    extraction: set.extraction && stop(set.extraction),
    mockup: set.mockup && stop(set.mockup),
    posters: set.posters.map(stop),
    outputs: set.outputs.map(stop),
  }
}

type LegacyStep = Asset & { key: string }

// Sets from before batches: a fixed list of steps (source, poster, low,
// medium, high or mockup). Their images keep their names.
function migrate(raw: GenerationSet & { steps?: LegacyStep[] }): GenerationSet {
  if (!raw.steps) return raw
  const { steps, ...rest } = raw
  const step = (key: string) => {
    const { key: _key, ...asset } = steps.find((s) => s.key === key) ?? { key, ...pending() }
    void _key
    return asset as Asset
  }
  const set: GenerationSet = {
    ...rest,
    original: step("source"),
    posters: [],
    batches: [],
    outputs: [],
  }
  if (raw.kind === "mockup") return { ...set, mockup: step("mockup") }

  const poster = step("poster")
  const batch: Batch = { id: "first", options: DEFAULT_OPTIONS, createdAt: raw.createdAt, expanded: true }
  return {
    ...set,
    layout: "single",
    extraction: { ...poster, file: null },
    posters: poster.status === "done" ? [{ ...poster, index: 0 }] : [],
    batches: [batch],
    outputs: (["low", "medium", "high"] as const).map(
      (creativity): Output => ({
        ...step(creativity),
        id: creativity,
        poster: 0,
        batch: batch.id,
        mode: "variant",
        creativity,
        review: null,
        createdAt: raw.createdAt,
      })
    ),
  }
}

/** The storage key of one of the set's images. */
export function fileKey(id: string, file: string) {
  if (!ID.test(id) || !FILE.test(file)) throw new NotFoundError("Unknown file")
  return `generations/${id}/${file}`
}

/** One of the set's images. */
export const readSetFile = (id: string, file: string) => getFile(fileKey(id, file))

/** Newest first. */
export async function listSets() {
  const stored = await readDocs<Stored>("generations/", "/set")
  const sets = await Promise.all([...stored.values()].map(view))
  return sets.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getSet(id: string) {
  const stored = ID.test(id) ? await readDoc<Stored | null>(docKey(id), null) : null
  if (!stored) throw new NotFoundError("Unknown generation")
  return view(stored)
}

export async function createSet(
  kind: GenerationKind,
  folder: string,
  source: GenerationSource,
  options: GenerateOptions = DEFAULT_OPTIONS
): Promise<GenerationSet> {
  const now = new Date().toISOString()
  const id = newId()
  const set: GenerationSet = {
    id,
    kind,
    folder,
    source,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    original: pending(),
    posters: [],
    outputs: [],
    ...(kind === "poster"
      ? {
          extraction: pending(),
          batches: [{ id: newId(), options, createdAt: now, expanded: false }],
        }
      : { mockup: pending(), batches: [] }),
  }
  await writeDoc(docKey(id), { ...set, runner: instanceId })
  return set
}

/**
 * Applies `change` to the set and writes it, after every other change to it
 * on any server; throws NotFoundError once deleted. A set put in line (or
 * set running) here is this server's to run, unless a running server has it.
 */
export async function updateSet(id: string, change: (set: GenerationSet) => GenerationSet) {
  const saved = await changeDoc<Stored>(docKey(id), async (stored) => {
    const current = await view(stored)
    const next: Stored = { ...change(current), updatedAt: new Date().toISOString() }
    if (!active(next)) delete next.runner
    else if (!active(stored) || !(await isLive(stored.runner))) next.runner = instanceId
    else next.runner = stored.runner
    return next
  })
  if (!saved) throw new NotFoundError("Unknown generation")
  return view(saved)
}

export function updateOutput(id: string, outputId: string, patch: Partial<Output>) {
  return updateSet(id, (set) => ({
    ...set,
    outputs: set.outputs.map((o) => (o.id === outputId ? { ...o, ...patch } : o)),
  }))
}

export async function saveFile(id: string, file: string, data: Buffer) {
  await getSet(id)
  await putFile(fileKey(id, file), data)
}

export async function removeFile(id: string, file: string | null | undefined) {
  if (file) await deleteFile(fileKey(id, file))
}

export async function deleteSet(id: string) {
  await getSet(id)
  await deleteDoc(docKey(id))
  await deleteFiles(`generations/${id}/`)
}
