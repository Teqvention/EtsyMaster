import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import { getListing } from "@/lib/etsy/listings"
import { filePath, getSet, listSets } from "@/lib/generation/storage"
import type { GenerationSet, Output } from "@/lib/generation/types"
import { keywordContext, libraryInsights, libraryStats } from "@/lib/keywords/library"
import { getDefaultChain, listChains } from "@/lib/mockups/chains"
import { NotFoundError } from "@/lib/mockups/storage"

import { writeListing } from "./copy"
import { cleanTag, cleanTags, cleanTitle, words } from "./text"
import type { Draft, DraftPatch, DraftView, UploadsState, WaitingPoster } from "./types"

// Upload drafts on disk (data/uploads/drafts.json) and in memory, and the
// queue that writes their listing copy in the background, two at a time.
// Drafts still waiting for copy when the server stopped are picked up again
// the next time the list is read.

const ROOT = path.join(process.cwd(), "data", "uploads")
const FILE = path.join(ROOT, "drafts.json")
const PARALLEL = 2

type Store = {
  drafts: Draft[]
  write: Promise<void>
  queue: string[]
  running: Set<string>
}

const global = globalThis as typeof globalThis & { __uploads?: Promise<Store> }

function store() {
  global.__uploads ??= load()
  return global.__uploads
}

async function load(): Promise<Store> {
  let drafts: Draft[] = []
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8"))
    if (Array.isArray(parsed)) drafts = parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const unfinished = drafts.filter((d) => d.copy === "queued" || d.copy === "writing").map((d) => d.id)
  drafts = drafts.map((d) => (unfinished.includes(d.id) ? { ...d, copy: "queued" } : d))
  const loaded: Store = { drafts, write: Promise.resolve(), queue: unfinished, running: new Set() }
  setTimeout(pump, 0)
  return loaded
}

/** Applies `change` to the list and writes it; writes queue one after another. */
async function update(change: (drafts: Draft[]) => Draft[]) {
  const current = await store()
  current.drafts = change(current.drafts)
  const snapshot = JSON.stringify(current.drafts, null, 1)
  const run = current.write.catch(() => {}).then(async () => {
    await mkdir(ROOT, { recursive: true })
    const temporary = `${FILE}.${process.pid}-${Date.now()}.tmp`
    await writeFile(temporary, snapshot)
    await rename(temporary, FILE)
  })
  current.write = run
  await run
  return current.drafts
}

function patchDraft(id: string, patch: Partial<Draft>) {
  return update((drafts) =>
    drafts.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: new Date().toISOString() } : d))
  )
}

export async function getDraft(id: string) {
  const draft = (await store()).drafts.find((d) => d.id === id)
  if (!draft) throw new NotFoundError("Unknown draft")
  return draft
}

// --- Posters ---

const posterUrl = (setId: string, file: string) => `/api/generations/${setId}/files/${file}`

const isApproved = (o: Output) => o.review === "approved" && o.status === "done" && !!o.file

function newDraft(set: GenerationSet, output: Output, chainId: string | null): Draft {
  const now = new Date().toISOString()
  const poster = set.posters.find((p) => p.index === output.poster)
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    generationId: set.id,
    outputId: output.id,
    poster: posterUrl(set.id, output.file!),
    posterIndex: output.poster,
    posterWidth: output.width,
    posterHeight: output.height,
    folder: set.folder,
    chainId,
    source: {
      listingId: set.source.listingId,
      title: set.source.title,
      tags: set.source.tags ?? [],
      url: set.source.url,
      shop: set.source.shop,
    },
    design: {
      mode: output.mode,
      title: output.title,
      summary: output.brief ?? poster?.analysis?.summary,
    },
    copy: "queued",
    status: "draft",
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Drafts for one poster (any finished one — the Generation page may ask for
 * it directly) or for every approved poster that has none yet. Their copy is
 * written in the background.
 */
export async function createDrafts(
  request: { generationId: string; outputId: string } | { all: true }
) {
  const { drafts } = await store()
  const have = new Set(drafts.map((d) => `${d.generationId}/${d.outputId}`))
  const chainId = (await getDefaultChain())?.id ?? null

  const made: Draft[] = []
  if ("all" in request) {
    for (const set of await listSets()) {
      for (const output of set.outputs ?? []) {
        if (isApproved(output) && !have.has(`${set.id}/${output.id}`)) made.push(newDraft(set, output, chainId))
      }
    }
  } else {
    const set = await getSet(request.generationId)
    const output = set.outputs.find((o) => o.id === request.outputId)
    if (!output) throw new NotFoundError("Unknown poster")
    if (output.status !== "done" || !output.file) throw new Error("That poster isn't finished yet")
    if (!have.has(`${set.id}/${output.id}`)) made.push(newDraft(set, output, chainId))
  }
  if (!made.length) return []

  // Oldest steals first, so the queue works through them in order.
  made.reverse()
  await update((list) => [...made, ...list])
  enqueue(made.map((d) => d.id))
  return made
}

export async function updateDraft(id: string, patch: DraftPatch) {
  await getDraft(id)
  const clean: Partial<Draft> = { ...patch }
  if (patch.title !== undefined) clean.title = cleanTitle(patch.title)
  if (patch.tags !== undefined) clean.tags = cleanTags(patch.tags)
  if (patch.description !== undefined) clean.description = patch.description.trim()
  await patchDraft(id, clean)
}

export async function deleteDraft(id: string) {
  await getDraft(id)
  const current = await store()
  current.queue = current.queue.filter((q) => q !== id)
  await update((drafts) => drafts.filter((d) => d.id !== id))
}

/** Writes the copy again, optionally steered (e.g. "more gift-focused"). */
export async function rewriteDraft(id: string, hint?: string) {
  const draft = await getDraft(id)
  if (draft.copy === "queued" || draft.copy === "writing") return
  await patchDraft(id, { copy: "queued", hint: hint?.trim() || undefined, error: undefined })
  enqueue([id])
}

// --- Queue ---

function enqueue(ids: string[]) {
  store().then((current) => {
    for (const id of ids) if (!current.queue.includes(id)) current.queue.push(id)
    pump()
  })
}

async function pump() {
  const current = await store()
  while (current.running.size < PARALLEL && current.queue.length) {
    const id = current.queue.shift()!
    current.running.add(id)
    write(id).finally(() => {
      current.running.delete(id)
      pump()
    })
  }
}

async function write(id: string) {
  try {
    const draft = await getDraft(id).catch(() => null)
    if (!draft) return
    await patchDraft(id, { copy: "writing" })

    const set = await getSet(draft.generationId)
    const output = set.outputs.find((o) => o.id === draft.outputId)
    const analysis = set.posters.find((p) => p.index === output?.poster)?.analysis
    const image = output?.file ? await readFile(filePath(set.id, output.file)).catch(() => undefined) : undefined

    const source = await withSourceTags(draft)
    const query = {
      title: [source.title, draft.design.title, analysis?.subject].filter(Boolean).join(" | "),
      tags: source.tags,
    }
    const [keywords, insights] = await Promise.all([keywordContext(query, 40), libraryInsights()])
    const recent = (await store()).drafts
      .filter((d) => d.id !== id && d.title)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 15)
      .map((d) => ({ title: d.title!, strategy: d.strategy }))

    const copy = await writeListing({
      source,
      design: draft.design,
      analysis,
      folder: draft.folder,
      image,
      keywords,
      insights,
      recent,
      hint: draft.hint,
    })
    await patchDraft(id, { ...copy, copy: "done", error: undefined })
  } catch (error) {
    console.error(`Upload draft ${id}:`, error)
    await patchDraft(id, {
      copy: "error",
      error: error instanceof Error ? error.message : "Couldn't write the listing",
    }).catch(() => {})
  }
}

/**
 * The source listing with its tags. Steals from before tags were kept only
 * have the title; their tags are looked up on Etsy once and kept.
 */
async function withSourceTags(draft: Draft) {
  if (draft.source.tags.length) return draft.source
  try {
    const listing = await getListing(draft.source.listingId)
    if (!listing?.tags.length) return draft.source
    const source = { ...draft.source, tags: listing.tags }
    await patchDraft(draft.id, { source })
    return source
  } catch (error) {
    console.warn(`Upload draft ${draft.id}: no source tags`, error)
    return draft.source
  }
}

// --- The page ---

const GENERIC = new Set([
  "poster", "print", "wall", "decor", "gift", "printable", "digital", "download", "home", "artwork", "picture", "sign", "room",
])

/** How strong a draft's keywords are in the library, and strong ones it could add. */
async function withKeywords(draft: Draft): Promise<DraftView> {
  if (!draft.tags?.length) return { ...draft, strength: {}, suggestions: [] }
  const context = await keywordContext({ title: draft.title ?? "", tags: draft.tags }, 200)
  const byKeyword = new Map(context.map((k) => [`${k.kind}:${k.keyword}`, k]))
  const strength: Record<string, number> = {}
  for (const tag of draft.tags) {
    const known = byKeyword.get(`tag:${cleanTag(tag)}`) ?? byKeyword.get(`phrase:${cleanTag(tag)}`)
    if (known) strength[cleanTag(tag)] = Math.round(known.score)
  }
  const used = new Set(draft.tags.map(cleanTag))
  // Only keywords about this poster: sharing a word beyond "print", "wall art"…
  const own = new Set(
    [draft.title ?? "", draft.source.title, ...draft.tags, ...draft.source.tags].flatMap(words)
  )
  const fits = (keyword: string) => words(keyword).some((w) => !GENERIC.has(w) && own.has(w))
  const suggestions = context
    .filter((k) => k.kind === "tag" && k.keyword.length <= 20 && !used.has(k.keyword) && k.score >= 20 && fits(k.keyword))
    .slice(0, 6)
    .map(({ keyword, score, shops, avgSalesPerMonth }) => ({ keyword, score, shops, avgSalesPerMonth }))
  return { ...draft, strength, suggestions }
}

/** Everything the Uploads page shows. */
export async function uploadsState(): Promise<UploadsState> {
  const [{ drafts }, sets, chains, library] = await Promise.all([
    store(),
    listSets(),
    listChains().catch(() => []),
    libraryStats().catch(() => ({ shops: 0, listings: 0, keywords: 0 })),
  ])

  const have = new Set(drafts.map((d) => `${d.generationId}/${d.outputId}`))
  const waiting: WaitingPoster[] = []
  for (const set of sets) {
    for (const output of set.outputs ?? []) {
      if (!isApproved(output) || have.has(`${set.id}/${output.id}`)) continue
      waiting.push({
        generationId: set.id,
        outputId: output.id,
        poster: posterUrl(set.id, output.file!),
        posterWidth: output.width,
        posterHeight: output.height,
        folder: set.folder,
        sourceTitle: set.source.title,
        designTitle: output.title,
      })
    }
  }

  // Drop drafts whose chain was deleted back to the default.
  const chainIds = new Set(chains.map((c) => c.id))
  const fallback = chains.find((c) => c.isDefault)?.id ?? null
  const views = await Promise.all(
    drafts.map((d) => withKeywords(d.chainId && !chainIds.has(d.chainId) ? { ...d, chainId: fallback } : d))
  )
  return { drafts: views, waiting, chains, library }
}
