import type { SizeKey } from "@/lib/catalog/sizes"

// The upload pipeline: approved posters become live Etsy listings, printed by
// Gelato, without anyone watching. One click on Uploads makes a job: the
// posters of the chosen groups, each assigned to an upload account. Every
// poster is a job item that walks through the stages below on its own; each
// stage is repeatable and every id it gets (Gelato product, Etsy listing,
// image ids) is saved the moment it exists, so a restart or a failure picks
// up where it stopped instead of making a second listing.
//
// Stored as the document "pipeline/jobs" (jobs and items); the print files
// and listing media they make are files under pipeline/items/<itemId>/.

/** A group: the posters drawn from one reference photo (a generation set). */
export type GroupId = string

/** How one group's posters are spread over the upload accounts. */
export type Distribution =
  /** Every poster of the group to one account. */
  | { mode: "account"; account: string }
  /** Spread evenly over these accounts (round robin, siblings apart). */
  | { mode: "split"; accounts: string[] }
  /** Each poster to the account picked for it: output id → account. */
  | { mode: "each"; accounts: Record<string, string> }

export type PlanGroup = {
  groupId: GroupId
  /** Approved posters of the group to upload: generation output ids. */
  outputs: string[]
  distribution: Distribution
}

/** What the Upload dialog sends: POST /api/pipeline/jobs. */
export type UploadPlan = {
  groups: PlanGroup[]
  /**
   * Mockup chain per account for this job. Key absent: the account's own
   * chain, else the default chain. A chain id: that chain. Explicit null:
   * "Poster only", no mockups and no video; the listing's one photo is the
   * poster itself as a clean listing-size JPEG.
   */
  chains?: Record<string, string | null>
  /** Put the listings live once they're proven printable; otherwise they wait inactive for a look. */
  activate: boolean
  /** Everything local (copy, print files, mockups, payloads) but nothing sent to Gelato or Etsy. */
  dryRun?: boolean
}

/**
 * The stages, in order:
 * - copy: title, tags and the story part of the description (the draft's copy).
 * - print: one print file per size, uploaded where Gelato can fetch it.
 * - media: the listing photos and video from the mockup chain, rendered headless.
 * - gelato: the product made from the account's Gelato template; Gelato
 *   publishes it to Etsy and the listing id comes back.
 * - listing: Etsy listing put right: hidden, our text/tags/shipping/section,
 *   prices from the price profile (only where they differ), photos and video.
 * - verify: printable proven on the live objects: every Etsy product id has a
 *   Gelato variant with a product UID and a design.
 * - live: activated with our photo order (or left inactive when the job says so).
 * - postcheck: ~90 minutes later, whatever Gelato wrote over again is put back.
 */
export const STAGES = ["copy", "print", "media", "gelato", "listing", "verify", "live", "postcheck"] as const
export type Stage = (typeof STAGES)[number]

export const STAGE_LABEL: Record<Stage, string> = {
  copy: "Writing copy",
  print: "Print files",
  media: "Mockups",
  gelato: "Gelato",
  listing: "Etsy listing",
  verify: "Checking print route",
  live: "Going live",
  postcheck: "Final check",
}

/**
 * queued: not started · running: a stage is at work · waiting: parked until a
 * time (Gelato publishing, the post-check) · done · failed: stopped with an
 * error, retryable · cancelled.
 */
export type ItemStatus = "queued" | "running" | "waiting" | "done" | "failed" | "cancelled"

export type PrintFile = {
  /** The size key it's for; on items from before one file per size, an aspect band several sizes shared (r1400). */
  bandId: string
  sizes: SizeKey[]
  /** Path under pipeline/ in storage. */
  file: string
  /** Public URL Gelato fetches it from. */
  url: string | null
  /** sha256 of the file, first 16 hex characters. */
  sha: string
  /** Pixels, bleed included. */
  width: number
  height: number
  /** How the poster was fitted: cropped, or extended with its own border colour. */
  fit: "exact" | "crop" | "extend"
}

export type JobItem = {
  id: string
  jobId: string
  /** The poster: generation set (= group) and output. */
  groupId: GroupId
  outputId: string
  /** The upload draft holding its copy. */
  draftId: string | null
  account: string
  /** The mockup chain its photos and video come from (settled when the job is made); null: poster only. */
  chainId: string | null
  status: ItemStatus
  /** The stage at work, waiting or failed; the last one once done. */
  stage: Stage
  /** Stages finished, with when and anything worth knowing. */
  done: Partial<Record<Stage, { at: string; note?: string }>>
  error?: string
  /** Why a waiting item waits, in words (Gelato publishing, quota, a shop not connected yet…). */
  note?: string
  /** Failed tries of the current stage. */
  attempts: number
  /** The server running it, while it runs. */
  runner?: string
  /** ISO time a waiting item is looked at again. */
  wakeAt?: string
  /**
   * Steps inside a stage that happened already, with when (ISO): what makes a
   * stage safe to run again, e.g. `gelatoSent` before the create request goes out.
   */
  steps?: Record<string, string>
  printFiles?: PrintFile[]
  /** Paths under pipeline/ in storage: listing photos in order, and the video; the mockup scene of each photo. */
  media?: { photos: string[]; video: string | null; scenes?: string[] }
  gelatoProductId?: string
  etsyListingId?: number
  /** Our photos on the Etsy listing, in order. */
  imageIds?: number[]
  videoId?: number
  /** Listing title as uploaded, for lists. */
  title?: string
  /** Dry runs: what would have been sent (Gelato body, Etsy fields, inventory). */
  payloads?: Record<string, unknown>
  /** ISO 8601 */
  createdAt: string
  updatedAt: string
}

export type JobStatus = "running" | "paused" | "done" | "cancelled"

export type UploadJob = {
  id: string
  status: JobStatus
  activate: boolean
  dryRun: boolean
  /** Item ids in upload order (groups interleaved, so one shop never gets a run of one motif). */
  items: string[]
  /** ISO 8601 */
  createdAt: string
  updatedAt: string
  finishedAt?: string
}

/** One upload account's share of the running jobs, for the sidebar. */
export type AccountProgress = {
  account: string
  /** Items assigned in jobs still running (or finished in the last hour). */
  target: number
  /** Live (or, with `activate: false`, uploaded and proven). */
  done: number
  failed: number
  /** Items at work right now. */
  running: number
  /** Any of its items not finished yet. */
  active: boolean
  /** Every item counted comes from a dry run: nothing really goes live. */
  dryRun?: boolean
}

/** GET /api/pipeline: everything the Uploads page shows about uploads. */
export type PipelineState = {
  /** Jobs not finished, and those finished in the last week; newest first. */
  jobs: UploadJob[]
  /** Their items, without `payloads` (GET /api/pipeline/items/[id] has them). */
  items: JobItem[]
  progress: AccountProgress[]
  /** The worker is paused for every job. */
  paused: boolean
  /** Why the worker can't run live uploads, e.g. no print file hosting. */
  blockers: string[]
}

// Routes (src/app/api/pipeline):
//   GET    /api/pipeline                    → PipelineState
//   POST   /api/pipeline/jobs               UploadPlan → PipelineState
//   PATCH  /api/pipeline/jobs/[id]          { status: "paused" | "running" | "cancelled" } → PipelineState
//   POST   /api/pipeline/items/[id]/retry   → PipelineState
//   DELETE /api/pipeline/items/[id]         cancels a not yet uploaded item → PipelineState
//   GET    /api/pipeline/items/[id]         → JobItem, payloads included
//   GET    /api/pipeline/items/[id]/files/[...path]   a file it made, relative to its folder: media/01.jpg, media/video.mp4, print/r1414.jpg
//   PATCH  /api/pipeline                    { paused: boolean } → PipelineState
//   GET    /api/storage                     → StorageStatus (lib/storage)
//   POST   /api/storage/test                → { ok, url?, error?, ms }: uploads, reads back and deletes a small file
//
// Server exports others use:
//   lib/pipeline/progress.ts  accountProgress(): Promise<AccountProgress[]>
//   lib/pipeline/render.ts    renderChainMedia(chainId, poster, dir): Promise<{ photos, video }> (paths under pipeline/ in storage)
//                             renderPhotos(poster: Buffer, sceneIds: string[]): Promise<Buffer[]> (JPEG, listing size)
//   lib/pipeline/print.ts     makePrintFiles(poster, orientation, dir, sizes?): Promise<PrintFile[]> (url still null)
//   lib/storage/index.ts      storageStatus(), uploadPublic(key, data, type) → public URL, deletePublic(key), testStorage()
//   lib/pipeline/store.ts     itemForListing(listingId: number): Promise<JobItem | null>
