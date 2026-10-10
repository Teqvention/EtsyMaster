import type { GenerationSet, Output } from "@/lib/generation/types"
import type { JobItem, PipelineState, UploadJob } from "@/lib/pipeline/types"

import type { Draft, GroupPoster, PosterState, UploadGroup } from "./types"

// Groups: the approved posters drawn from one reference photo, the unit
// Uploads spreads over the accounts. Built on the server from the generation
// sets and the drafts; read against the pipeline's jobs in the browser, to
// know which posters are live, on their way or free to go. Pure.

/** A poster's key across sets: "<set id>/<output id>". */
export const posterKey = (groupId: string, outputId: string) => `${groupId}/${outputId}`

export const isApproved = (o: Output) => o.review === "approved" && o.status === "done" && !!o.file

const posterUrl = (setId: string, file: string) => `/api/generations/${setId}/files/${file}`

/** A generation image, small. */
export const thumbUrl = (setId: string, file: string, width = 160) =>
  `/api/uploads/posters/${setId}/${file}?w=${width}`

/** The first sentence of an art direction, without its hex colours: enough to know the motif. */
function firstSentence(text: string) {
  const plain = text.replace(/\s*\(#[0-9a-f]{3,8}\)/gi, "").trim()
  return plain.split(/(?<=[.!?])\s/)[0]?.slice(0, 220) ?? ""
}

function stateOf(draft: Draft | undefined): PosterState {
  if (!draft) return "waiting"
  if (draft.status === "uploaded") return "uploaded"
  if (draft.copy === "queued" || draft.copy === "writing") return "writing"
  if (draft.copy === "error" && !draft.title) return "error"
  return draft.status === "ready" ? "ready" : "draft"
}

/**
 * Every set with approved posters (or drafts) as a group, newest steal first
 * like `sets`. Drafts of a deleted set have no poster file left to upload, so
 * they're no group's.
 */
export function buildGroups(sets: GenerationSet[], drafts: Draft[]): UploadGroup[] {
  const draftOf = new Map(drafts.map((d) => [posterKey(d.generationId, d.outputId), d]))
  const groups: UploadGroup[] = []
  for (const set of sets) {
    const posters: GroupPoster[] = []
    for (const output of set.outputs ?? []) {
      const draft = draftOf.get(posterKey(set.id, output.id))
      if (!output.file || (!draft && !isApproved(output))) continue
      const analysis = set.posters.find((p) => p.index === output.poster)?.analysis
      posters.push({
        outputId: output.id,
        draftId: draft?.id ?? null,
        poster: posterUrl(set.id, output.file),
        thumb: thumbUrl(set.id, output.file),
        posterWidth: output.width,
        posterHeight: output.height,
        title: draft?.title || output.title || set.source.title,
        motif: [output.title, firstSentence(output.brief ?? analysis?.summary ?? "")].filter(Boolean).join(". "),
        state: stateOf(draft),
        approved: isApproved(output),
      })
    }
    if (!posters.length) continue
    groups.push({
      id: set.id,
      folder: set.folder,
      source: { title: set.source.title, url: set.source.url, shop: set.source.shop, tags: set.source.tags ?? [] },
      image: set.original.file ? thumbUrl(set.id, set.original.file) : null,
      posters,
      createdAt: set.createdAt,
    })
  }
  return groups
}

// --- Against the pipeline ---

/** A poster's run through the pipeline: the item and its job. */
export type PosterUpload = { item: JobItem; job: UploadJob }

/** Where a poster stands, the pipeline included. */
export type PosterStatus = PosterState | "uploading" | "failed" | "live"

/** Gone through the "live" stage: on Etsy (inactive when its job said so). */
export const isOnEtsy = (item: JobItem) => item.status === "done" || !!item.done.live

export const isFinished = (item: JobItem) =>
  item.status === "done" || item.status === "failed" || item.status === "cancelled"

/** Still at work: not finished, and its job neither cancelled nor done. */
export const isUnderway = ({ item, job }: PosterUpload) =>
  !isFinished(item) && job.status !== "cancelled" && job.status !== "done"

/**
 * Whether a real upload of a poster leaves it free to go again: only one
 * stopped before anything of it reached Gelato.
 */
export function leavesFree(item: JobItem, job: UploadJob | undefined) {
  const stopped = item.status === "cancelled" || (job?.status === "cancelled" && !isOnEtsy(item))
  return stopped && !item.steps?.gelatoSent && !item.gelatoProductId && !item.etsyListingId
}

export type PosterUploads = {
  /** Per poster key, its newest item in a real upload. */
  real: Map<string, PosterUpload>
  /** Per poster key, its newest item in a test run. */
  test: Map<string, PosterUpload>
  /** Poster keys a real upload holds, any of them (not only the newest): on Etsy, on its way or failed. */
  taken: Set<string>
}

export function uploadsByPoster(pipeline: PipelineState | null): PosterUploads {
  const real = new Map<string, PosterUpload>()
  const test = new Map<string, PosterUpload>()
  const taken = new Set<string>()
  if (!pipeline) return { real, test, taken }
  const jobs = new Map(pipeline.jobs.map((j) => [j.id, j]))
  for (const item of pipeline.items) {
    const job = jobs.get(item.jobId)
    if (!job) continue
    const into = job.dryRun ? test : real
    const key = posterKey(item.groupId, item.outputId)
    const before = into.get(key)
    if (!before || item.createdAt >= before.item.createdAt) into.set(key, { item, job })
    if (!job.dryRun && !leavesFree(item, job)) taken.add(key)
  }
  return { real, test, taken }
}

export function statusOf(uploads: PosterUploads, key: string, state: PosterState): PosterStatus {
  const real = uploads.real.get(key)
  if (state === "uploaded" || (real && isOnEtsy(real.item))) return "live"
  if (real && isUnderway(real)) return "uploading"
  if (real?.item.status === "failed") return "failed"
  return state
}

/**
 * Whether a poster may go into a new job: never twice to Etsy, and not while
 * a real upload of it is underway or failed (that one is retried instead, so
 * a half made listing never gets a twin). An upload cancelled before Gelato
 * got anything doesn't count. The same rule as the server's (createJob); and
 * only an approved poster whose set is still there.
 */
export function canUpload(uploads: PosterUploads, key: string, poster: GroupPoster | undefined) {
  return !!poster?.approved && poster.state !== "uploaded" && !uploads.taken.has(key)
}
