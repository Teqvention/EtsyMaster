import type { KeywordInsight } from "@/lib/keywords/types"
import type { MockupChain } from "@/lib/mockups/chain-types"

// An upload draft: one approved poster from the Generation page on its way to
// an Etsy listing — the poster, the mockup chain it's shown in, and the
// listing copy the copywriter wrote for it. Stored in data/uploads/drafts.json.

export type DraftStatus = "draft" | "ready" | "uploaded"

/** Writing the listing copy happens in the background. */
export type CopyStatus = "queued" | "writing" | "done" | "error"

/** The listing the poster was stolen from: the copy's main inspiration. */
export type DraftSource = {
  listingId: number
  title: string
  tags: string[]
  url: string
  shop: string | null
}

/** Our poster, as the copywriter needs to know it. */
export type DraftDesign = {
  mode: "variant" | "idea"
  /** The output's few words, e.g. "Cat in a pool". */
  title?: string
  /** One line on what the poster shows. */
  summary?: string
}

export type ListingCopy = {
  /** ≤ 140 characters. */
  title: string
  /** Exactly 13, ≤ 20 characters each, lower case. */
  tags: string[]
  description: string
  /** Which keyword strategy this copy follows… */
  strategy: string
  /** …and why it fits this poster. */
  strategyWhy: string
  /** 0–1: how much of the source's title and tags it carries over. */
  adoption: number
  /** A sentence on the choices made. */
  reasoning: string
}

export type Draft = Partial<ListingCopy> & {
  id: string
  generationId: string
  outputId: string
  /** URL of the poster image. */
  poster: string
  /** Which of the set's extracted posters it redraws (0-based). */
  posterIndex?: number
  posterWidth?: number
  posterHeight?: number
  /** The steal's category. */
  folder: string
  /** The mockup chain the listing photos come from; the default one when created. */
  chainId: string | null
  source: DraftSource
  design: DraftDesign
  copy: CopyStatus
  /** What the last rewrite was asked to do differently. */
  hint?: string
  status: DraftStatus
  /** In the shop's currency, cents. */
  priceCents?: number
  error?: string
  /** ISO 8601 */
  createdAt: string
  updatedAt: string
}

/** An approved poster without a draft yet. */
export type WaitingPoster = {
  generationId: string
  outputId: string
  poster: string
  posterWidth?: number
  posterHeight?: number
  folder: string
  sourceTitle: string
  designTitle?: string
}

/** A draft as the page gets it: with how strong its keywords are in the library. */
export type DraftView = Draft & {
  /** Normalised tag → library score (0–100), for the tags the library knows. */
  strength: Record<string, number>
  /** Strong library keywords that fit this listing and aren't used yet. */
  suggestions: Pick<KeywordInsight, "keyword" | "score" | "shops" | "avgSalesPerMonth">[]
}

export type UploadsState = {
  drafts: DraftView[]
  waiting: WaitingPoster[]
  chains: MockupChain[]
  library: { shops: number; listings: number; keywords: number }
}

/** What the page may change on a draft. */
export type DraftPatch = Partial<Pick<Draft, "title" | "tags" | "description" | "status" | "chainId" | "priceCents">>

export const TITLE_MAX = 140
export const TAG_MAX = 20
export const TAG_COUNT = 13
