import { readDoc, updateDoc, watchDoc } from "@/lib/db/documents"
import { isLeader, whenLeader } from "@/lib/db/workers"
import { getSet, listSets, updateSet } from "@/lib/generation/storage"
import type { GenerationSet, Output } from "@/lib/generation/types"
import { keywordContext, libraryStats } from "@/lib/keywords/library"
import { getDefaultChain, listChains } from "@/lib/mockups/chains"
import { NotFoundError } from "@/lib/mockups/storage"

import { draftCopy, sourceDetails } from "./copy"
import { buildGroups, posterKey, thumbUrl } from "./groups"
import { cleanTag, cleanTags, cleanTitle, words } from "./text"
import type { Draft, DraftPatch, DraftView, RemovedPoster, UploadsState, WaitingPoster } from "./types"

// Upload drafts in one document ("uploads/drafts"), and the queue that
// writes their listing copy in the background, eight at a time, on the server
// doing the background work (see db/workers.ts): it hears of every draft
// queued, whichever server queued it. Drafts it finds "writing" without
// writing them were cut off (a restart, a server that stopped) and go again.

const FILE = "uploads/drafts"
// Gemini's gate (mockups/gemini.ts) backs off when Vertex is busy, so more at once costs nothing.
const PARALLEL = 8

/** Drafts whose copy this server is writing now. */
const global = globalThis as typeof globalThis & { __uploadsWriting?: Set<string> }
const running = (global.__uploadsWriting ??= new Set())

whenLeader(() => {
  watchDoc(FILE, () => void pump())
  void pump()
})

/** Every draft, newest first. Shared: never change what this answers. */
async function readDrafts(): Promise<Draft[]> {
  const drafts = await readDoc<unknown>(FILE, [])
  return Array.isArray(drafts) ? drafts : []
}

/** Applies `change` to the list and writes it, after every other change on any server. */
function update(change: (drafts: Draft[]) => Draft[]) {
  return updateDoc<Draft[]>(FILE, [], (drafts) => change(Array.isArray(drafts) ? drafts : []))
}

function patchDraft(id: string, patch: Partial<Draft>) {
  return update((drafts) =>
    drafts.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: new Date().toISOString() } : d))
  )
}

export async function getDraft(id: string) {
  const draft = (await readDrafts()).find((d) => d.id === id)
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
  const drafts = await readDrafts()
  const have = new Set(drafts.map((d) => `${d.generationId}/${d.outputId}`))
  const chainId = (await getDefaultChain())?.id ?? null

  const made: Draft[] = []
  if ("all" in request) {
    // City posters get their drafts from Citys → Upload, with the city copywriter.
    for (const set of (await listSets()).filter((s) => !s.city)) {
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

  // Newest first, like the list; the queue works through them oldest first.
  made.reverse()
  let added: Draft[] = []
  await update((list) => {
    // Made meanwhile on another server: not twice.
    const now = new Set(list.map((d) => `${d.generationId}/${d.outputId}`))
    added = made.filter((d) => !now.has(`${d.generationId}/${d.outputId}`))
    return [...added, ...list]
  })
  void pump()
  return added
}

export async function updateDraft(id: string, patch: DraftPatch) {
  await getDraft(id)
  const clean: Partial<Draft> = { ...patch }
  if (patch.title !== undefined) clean.title = cleanTitle(patch.title)
  if (patch.tags !== undefined) clean.tags = cleanTags(patch.tags)
  if (patch.description !== undefined) clean.description = patch.description.trim()
  await patchDraft(id, clean)
}

/** Deletes the draft's poster from the uploads (see `removePosters`). */
export async function deleteDraft(id: string) {
  const draft = await getDraft(id)
  await removePosters([posterKey(draft.generationId, draft.outputId)])
}

// --- Deleted posters ---

const REMOVED = "uploads/removed"
/** The deleted list keeps this many, newest first. */
const KEEP = 300

const readRemoved = async () => {
  const list = await readDoc<unknown>(REMOVED, [])
  return (Array.isArray(list) ? list : []) as RemovedPoster[]
}

/** Poster keys ("<set id>/<output id>") by set. */
function bySet(keys: Iterable<string>) {
  const sets = new Map<string, Set<string>>()
  for (const key of keys) {
    const [setId, outputId] = key.split("/")
    if (!setId || !outputId) continue
    sets.set(setId, (sets.get(setId) ?? new Set()).add(outputId))
  }
  return sets
}

/** Changes a set's outputs; null when the set is gone. */
function changeOutputs(setId: string, change: (output: Output) => Output) {
  return updateSet(setId, (set) => ({ ...set, outputs: set.outputs.map(change) })).catch((error) => {
    if (error instanceof NotFoundError) return null
    throw error
  })
}

/**
 * Takes posters (by key) out of the uploads: no longer approved on
 * Generation, their drafts deleted, and each put on the deleted list with
 * its draft.
 */
export async function removePosters(keys: string[]) {
  const wanted = new Set(keys)
  const removedAt = new Date().toISOString()
  const entries = new Map<string, RemovedPoster>()
  // The approval goes first: a draft deleted while its poster is still
  // approved would be written again by the next "Write listings".
  for (const [setId, ids] of bySet(wanted)) {
    const approved = new Set<string>()
    const set = await changeOutputs(setId, (o) => {
      if (!ids.has(o.id) || o.review !== "approved") return o
      approved.add(o.id)
      return { ...o, review: null, reviewedAt: removedAt }
    })
    if (!set) continue
    for (const output of set.outputs) {
      if (!ids.has(output.id) || !output.file) continue
      entries.set(posterKey(set.id, output.id), {
        generationId: set.id,
        outputId: output.id,
        thumb: thumbUrl(set.id, output.file),
        posterWidth: output.width,
        posterHeight: output.height,
        title: output.title || set.source.title,
        folder: set.folder,
        approved: approved.has(output.id),
        removedAt,
      })
    }
  }

  let taken: Draft[] = []
  await update((drafts) => {
    taken = drafts.filter((d) => wanted.has(posterKey(d.generationId, d.outputId)))
    return drafts.filter((d) => !wanted.has(posterKey(d.generationId, d.outputId)))
  })
  for (const draft of taken) {
    const entry = entries.get(posterKey(draft.generationId, draft.outputId))
    if (!entry) continue
    entry.draft = draft
    if (draft.title) entry.title = draft.title
  }

  if (!entries.size) return
  await updateDoc<RemovedPoster[]>(REMOVED, [], (list) => {
    const before = (Array.isArray(list) ? list : []).filter((e) => !entries.has(posterKey(e.generationId, e.outputId)))
    return [...entries.values(), ...before].slice(0, KEEP)
  })
}

/** Brings deleted posters back: approved again, with the draft they had (unless one was made meanwhile). */
export async function restorePosters(keys: string[]) {
  const wanted = new Set(keys)
  const entries = (await readRemoved()).filter((e) => wanted.has(posterKey(e.generationId, e.outputId)))
  if (!entries.length) throw new NotFoundError("Not on the deleted list")

  const reviewedAt = new Date().toISOString()
  const toApprove = new Set(entries.filter((e) => e.approved).map((e) => posterKey(e.generationId, e.outputId)))
  // Posters whose image is still there: only they get their drafts back.
  const alive = new Set<string>()
  for (const [setId, ids] of bySet(wanted)) {
    const set = await changeOutputs(setId, (o) =>
      toApprove.has(posterKey(setId, o.id)) && o.status === "done" && o.file ? { ...o, review: "approved", reviewedAt } : o
    )
    for (const o of set?.outputs ?? []) if (ids.has(o.id) && o.file) alive.add(posterKey(setId, o.id))
  }

  await update((drafts) => {
    const have = new Set(drafts.map((d) => posterKey(d.generationId, d.outputId)))
    const back = entries.flatMap((e) => {
      const key = posterKey(e.generationId, e.outputId)
      if (!e.draft || !alive.has(key) || have.has(key)) return []
      // Cut off mid-write: written again.
      return [{ ...e.draft, copy: e.draft.copy === "writing" ? ("queued" as const) : e.draft.copy }]
    })
    if (!back.length) return drafts
    // Back in their place: the list is newest first.
    return [...back, ...drafts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  })
  await updateDoc<RemovedPoster[]>(REMOVED, [], (list) =>
    (Array.isArray(list) ? list : []).filter((e) => !wanted.has(posterKey(e.generationId, e.outputId)))
  )
  void pump()
}

/** Writes the copy again, optionally steered (e.g. "more gift-focused"). */
export async function rewriteDraft(id: string, hint?: string) {
  const draft = await getDraft(id)
  if (draft.copy === "queued" || draft.copy === "writing") return
  await patchDraft(id, { copy: "queued", hint: hint?.trim() || undefined, error: undefined })
  void pump()
}

// --- Queue ---

/** Starts writing the oldest drafts waiting for copy, up to PARALLEL at once; only on the server leading. */
async function pump() {
  if (!(await isLeader())) return
  for (const draft of (await readDrafts()).toReversed()) {
    if (running.size >= PARALLEL) return
    // "writing" here but not by this server: cut off, so again.
    if (running.has(draft.id) || (draft.copy !== "queued" && draft.copy !== "writing")) continue
    running.add(draft.id)
    write(draft.id).finally(() => {
      running.delete(draft.id)
      void pump()
    })
  }
}

async function write(id: string) {
  try {
    const draft = await getDraft(id).catch(() => null)
    if (!draft) return
    await patchDraft(id, { copy: "writing" })

    const source = await withSourceTags(draft)
    // The latest listings, to keep this one's title, tags and story apart from.
    const recent = (await readDrafts())
      .filter((d) => d.id !== id && d.title)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 20)
      .map((d) => ({ title: d.title!, tags: d.tags, strategy: d.strategy, form: d.form, description: d.description }))

    const copy = await draftCopy({ ...draft, source }, recent)
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
 * The source listing with its tags and description. Steals from before tags
 * were kept only have the title, and none has the description: what's
 * missing is read from Etsy once (or taken from a draft of the same steal
 * that has it) and kept.
 */
async function withSourceTags(draft: Draft) {
  if (draft.source.tags.length && draft.source.description !== undefined) return draft.source
  const sibling = (await readDrafts()).find(
    (d) => d.source.listingId === draft.source.listingId && d.source.description !== undefined && d.source.tags.length
  )
  try {
    const details = sibling?.source ?? (await sourceDetails(draft.source.listingId))
    // Etsy's tags when it has more: a steal may have kept only some.
    const source = {
      ...draft.source,
      tags: details.tags.length > draft.source.tags.length ? details.tags : draft.source.tags,
      description: details.description,
    }
    await patchDraft(draft.id, { source })
    return source
  } catch (error) {
    console.warn(`Upload draft ${draft.id}: no source details`, error)
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
  const [allDrafts, allSets, chains, library, removedList] = await Promise.all([
    readDrafts(),
    listSets(),
    listChains().catch(() => []),
    libraryStats().catch(() => ({ shops: 0, listings: 0, keywords: 0 })),
    readRemoved(),
  ])

  // City posters go up from Citys → Upload: neither their sets nor their drafts show here.
  const sets = allSets.filter((s) => !s.city)
  const drafts = allDrafts.filter((d) => d.folder !== "citys")
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
  // Only what could come back: its image still there, and not back in the
  // uploads some other way (approved again on Generation).
  const outputs = new Map(sets.flatMap((set) => (set.outputs ?? []).map((o) => [posterKey(set.id, o.id), o] as const)))
  const removed = removedList
    .filter((e) => {
      const key = posterKey(e.generationId, e.outputId)
      const output = outputs.get(key)
      return !!output?.file && !have.has(key) && !isApproved(output)
    })
    .map(({ draft, ...entry }) => {
      void draft
      return entry
    })

  return { drafts: views, waiting, chains, library, groups: buildGroups(sets, drafts), removed }
}
