// What the Generation page shows: one "set" per listing photo a folder was
// run on. A poster set downloads the photo, finds every poster in it (one, or
// each of a set of N), reads what each one is, and then draws new posters
// from them in batches — variants at a chosen creativity (optionally in a
// saved style) and new ideas on the same selling concept. A mockup set turns
// the photo into a blank mockup scene. Stored as the document generations/<id>/set
// next to its images.

export type GenerationKind = "poster" | "mockup"

/** How far a new poster may stray from its reference. */
export const CREATIVITIES = ["minimal", "subtle", "low", "medium", "high"] as const
export type Creativity = (typeof CREATIVITIES)[number]

export const CREATIVITY_LABEL: Record<Creativity, string> = {
  minimal: "Minimal",
  subtle: "Subtle",
  low: "Low",
  medium: "Medium",
  high: "High",
}

export type AssetStatus = "pending" | "running" | "done" | "error"

/** An image the pipeline makes, in the set's folder once done. */
export type Asset = {
  status: AssetStatus
  file: string | null
  width?: number
  height?: number
  error?: string
  /** Something worth knowing about a result, e.g. no frame found. */
  note?: string
}

/** What one photo holds: a single framed print, a set of N, or a flat design. */
export type PosterLayout = "single" | "set" | "flat"

/** What a poster is, read once by Gemini and used for every prompt after. */
export type PosterAnalysis = {
  /** One line: what the poster shows. */
  summary: string
  subject: string
  setting: string
  action: string
  /** Medium, technique and rendering, e.g. "gouache, thick brush strokes, flat light". */
  style: string
  /** Hex colours, dominant first. */
  palette: string[]
  composition: string
  /** The words on the poster and how they're lettered; null without text. */
  typography: string | null
  mood: string
  /** Who buys it and for which room. */
  audience: string
  /** Why it sells: the concept, joke or feeling. */
  hook: string
  /** Raw material for new ideas on the same concept. */
  swaps: { subjects: string[]; settings: string[]; props: string[] }
}

export type ExtractedPoster = Asset & {
  /** 0-based, reading order. */
  index: number
  /** Short name, e.g. "Lemon slice" — tells the posters of a set apart. */
  label?: string
  analysis?: PosterAnalysis
}

/** `variant` redraws the reference; `idea` keeps its concept and style but invents a new scene. */
export type OutputMode = "variant" | "idea"

export type Review = "approved" | "rejected"

export type Output = Asset & {
  id: string
  /** Index into the set's posters. */
  poster: number
  /** The request it came from. */
  batch: string
  mode: OutputMode
  creativity: Creativity
  /** Drawn in a saved style (variants only). */
  styleId?: string | null
  /** A few words naming it, e.g. "Cat in a pool" for an idea. */
  title?: string
  /** The art direction it was drawn from. */
  brief?: string
  /** What the user asked to be different. */
  feedback?: string
  /** The output this one redoes. */
  from?: string
  /** Approved outputs this idea takes inspiration from. */
  inspiration?: string[]
  /** The batch job painting it, while it does (see `PaintJob`), or `SENDING` until that job starts. */
  job?: string
  review: Review | null
  /** ISO 8601 */
  reviewedAt?: string
  createdAt: string
}

export type GenerateGroup = {
  count: number
  /** One level, or several the count is spread over evenly. */
  creativity: Creativity[]
}

/** What the generate dialog asks for. */
export type GenerateOptions = {
  variants: GenerateGroup & { styleId: string | null }
  ideas: GenerateGroup
  /** What should be different, in the user's words. */
  feedback?: string
  /** Only these posters of a set (indices); all when not given. */
  posters?: number[]
  /** Redo of this output (its poster, mode and brief are the starting point). */
  from?: string
  /** New ideas inspired by these approved outputs (ids), on top of the reference. */
  inspiration?: string[]
  /** "batch": painted in a Vertex batch job — half the price, back in minutes to hours. */
  delivery?: Delivery
}

export type Delivery = "now" | "batch"

/**
 * A Vertex batch job painting some of a set's outputs. One job can paint for
 * many sets: each lists its own outputs under the same name.
 */
export type PaintJob = {
  /** Vertex's resource name. */
  name: string
  outputs: string[]
  /** ISO 8601 */
  submittedAt: string
  finishedAt?: string
  status: "running" | "done" | "error"
  error?: string
  /** Images the whole job has painted so far; Vertex hands them over when it ends. */
  ready?: number
  /** ISO 8601: when `ready` last went up. */
  movedAt?: string
  /** Requests in the whole job. */
  size?: number
  /** Being ended early, so what's painted comes in and the rest goes out again. */
  harvest?: boolean
}

/** An output's `job` while it waits, with others, for the batch job they'll go out in. */
export const SENDING = "sending"

export const MAX_VARIANTS = 20
export const MAX_IDEAS = 50
/** Approved images an inspired batch shows the AI at most. */
export const MAX_INSPIRATION = 12

/** Five variants, one per level from almost identical to high; the default every new poster set gets. */
export const DEFAULT_OPTIONS: GenerateOptions = {
  variants: { count: 5, creativity: [...CREATIVITIES], styleId: null },
  ideas: { count: 0, creativity: ["medium"] },
}

export type Batch = {
  id: string
  options: GenerateOptions
  createdAt: string
  /** Outputs are made once the posters are known. */
  expanded: boolean
}

export type SetStatus = "queued" | "running" | "done" | "error"

export type GenerationSource = {
  listingId: number
  title: string
  /** Etsy listing photo (full size). */
  image: string
  url: string
  shop: string | null
  /** The seller's tags, for our own listing's keywords later. */
  tags?: string[]
}

export type GenerationSet = {
  id: string
  kind: GenerationKind
  folder: string
  source: GenerationSource
  status: SetStatus
  /** ISO 8601 */
  createdAt: string
  updatedAt: string
  /** The listing photo, downloaded. */
  original: Asset
  /** Poster sets: what the photo holds, once read. */
  layout?: PosterLayout
  posters: ExtractedPoster[]
  /** Finding the posters (one step for all of them). */
  extraction?: Asset
  /** Mockup sets: one, saying how the blank mockup is painted. */
  batches: Batch[]
  /** Mockup sets: one, the photo redrawn with blank frames, which the scene is made from. */
  outputs: Output[]
  /** Batch jobs painting its outputs, oldest first. */
  jobs?: PaintJob[]
  /** Asked to stop: whatever isn't painting yet won't be (see `stopWaiting`). */
  stopping?: boolean
  /** ISO 8601 — set aside as done (out of Everything and To review); cleared when more images are made. */
  doneAt?: string
  /** Mockup sets: the blank mockup and its scene, for the editor. */
  mockup?: Asset
  sceneId?: string
}

/** `count` levels spread evenly over `levels`, in order: 5 over low+high → L H L H L. */
export function spread(count: number, levels: Creativity[]): Creativity[] {
  const use = levels.length ? levels : (["medium"] as Creativity[])
  return Array.from({ length: count }, (_, i) => use[i % use.length])
}

/** How many images `options` makes per poster. */
export function imagesPerPoster(options: GenerateOptions) {
  return options.from ? 1 : options.inspiration ? options.ideas.count : options.variants.count + options.ideas.count
}

export const isBusy = (status: AssetStatus | SetStatus) =>
  status === "pending" || status === "queued" || status === "running"
