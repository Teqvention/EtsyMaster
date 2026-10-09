import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { NotFoundError } from "@/lib/mockups/storage"

import {
  DEFAULT_OPTIONS,
  type Asset,
  type Batch,
  type GenerateOptions,
  type GenerationKind,
  type GenerationSet,
  type GenerationSource,
  type Output,
} from "./types"

// Sets live on disk as data/generations/<id>/set.json plus their images, and
// in memory while the server runs: the Generation page polls every couple of
// seconds while anything is in progress, and that shouldn't touch the disk.
const ROOT = path.join(process.cwd(), "data", "generations")

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const FILE = /^[a-z0-9][a-z0-9_-]{0,63}\.(png|jpg|jpeg|webp)$/i

type Store = { sets: Map<string, GenerationSet>; writes: Map<string, Promise<void>> }

// On globalThis, so every route (and a dev reload) shares the one copy.
const global = globalThis as typeof globalThis & { __generationStore?: Promise<Store> }

function store() {
  global.__generationStore ??= load()
  return global.__generationStore
}

async function load(): Promise<Store> {
  await mkdir(ROOT, { recursive: true })
  const sets = new Map<string, GenerationSet>()
  for (const id of await readdir(ROOT)) {
    if (!ID.test(id)) continue
    try {
      const raw = JSON.parse(await readFile(path.join(ROOT, id, "set.json"), "utf8"))
      sets.set(id, interrupted(migrate(raw)))
    } catch {
      // A folder without a readable set is skipped, not fatal.
    }
  }
  return { sets, writes: new Map() }
}

/** A short id, sortable by time and unique within a batch. */
export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const pending = (): Asset => ({ status: "pending", file: null })

// Work in progress when the server stopped never finishes; say so, so it can be retried.
function interrupted(set: GenerationSet): GenerationSet {
  if (set.status !== "queued" && set.status !== "running") return set
  const stop = <T extends Asset>(a: T): T =>
    a.status === "pending" || a.status === "running"
      ? { ...a, status: "error", error: "Interrupted — the server restarted" }
      : a
  return {
    ...set,
    status: "error",
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

export function filePath(id: string, file: string) {
  if (!ID.test(id) || !FILE.test(file)) throw new NotFoundError("Unknown file")
  return path.join(ROOT, id, file)
}

/** Newest first. */
export async function listSets() {
  const { sets } = await store()
  return [...sets.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getSet(id: string) {
  const set = (await store()).sets.get(id)
  if (!set) throw new NotFoundError("Unknown generation")
  return set
}

export async function createSet(
  kind: GenerationKind,
  folder: string,
  source: GenerationSource,
  options: GenerateOptions = DEFAULT_OPTIONS
): Promise<GenerationSet> {
  const { sets } = await store()
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
  await mkdir(path.join(ROOT, id), { recursive: true })
  sets.set(id, set)
  await persist(set)
  return set
}

/** Applies `change` to the set and writes it; throws NotFoundError once deleted. */
export async function updateSet(id: string, change: (set: GenerationSet) => GenerationSet) {
  const { sets } = await store()
  const current = sets.get(id)
  if (!current) throw new NotFoundError("Unknown generation")
  const next = { ...change(current), updatedAt: new Date().toISOString() }
  sets.set(id, next)
  await persist(next)
  return next
}

export function updateOutput(id: string, outputId: string, patch: Partial<Output>) {
  return updateSet(id, (set) => ({
    ...set,
    outputs: set.outputs.map((o) => (o.id === outputId ? { ...o, ...patch } : o)),
  }))
}

export async function saveFile(id: string, file: string, data: Buffer) {
  await getSet(id)
  await writeFile(filePath(id, file), data)
}

export async function removeFile(id: string, file: string | null | undefined) {
  if (file) await rm(filePath(id, file), { force: true })
}

export async function deleteSet(id: string) {
  const { sets, writes } = await store()
  await getSet(id)
  sets.delete(id)
  await writes.get(id)
  await rm(path.join(ROOT, id), { recursive: true, force: true })
}

// Parts of one set finish in parallel; their writes go one after another so
// the file never holds half of two versions.
async function persist(set: GenerationSet) {
  const { writes } = await store()
  const write = (writes.get(set.id) ?? Promise.resolve())
    .catch(() => {})
    .then(() => writeFile(path.join(ROOT, set.id, "set.json"), JSON.stringify(set, null, 1)))
  writes.set(set.id, write)
  await write
}
