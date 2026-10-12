import type { CityStyleData } from "@/lib/citys/studio-types"

// A style is a moodboard: a handful of posters that share a look, and the
// guide Gemini writes from them once. Generation then paints steals in that
// look from the guide (and a few of the images), so the style is understood
// one time, not re-guessed on every poster. Stored as
// the document styles/<id>/style next to copies of its images (files under styles/<id>/).

/** The visual language the moodboard shares, written to be applied to any subject. */
export type StyleGuide = {
  /** Two or three sentences: the look at a glance. */
  summary: string
  /** What it's made with, e.g. "gouache on textured paper". */
  medium: string
  /** Linework, brushwork, edges and surface texture. */
  technique: string
  /** Dominant first. */
  palette: { hex: string; role: string }[]
  lighting: string
  composition: string
  /** How much is simplified, and where the detail goes. */
  detail: string
  /** Lettering, when the posters have any. */
  typography: string | null
  mood: string
  /** Recurring visual devices, not subjects. */
  motifs: string[]
  do: string[]
  dont: string[]
  /** One paragraph of art direction for an image model. */
  prompt: string
}

export type StyleImage = {
  file: string
  width: number
  height: number
  /** ISO 8601 */
  addedAt: string
  /**
   * `<generation>/<file>` it was copied from, or `listing/<listingId>/<n>` for
   * the n-th poster of a saved listing's photo, so pickers can mark it as added.
   */
  from?: string
}

export type GuideStatus = "idle" | "running" | "error"

export type Style = {
  id: string
  name: string
  /** In board order; the first four make the cover. */
  images: StyleImage[]
  guide: StyleGuide | null
  guideStatus: GuideStatus
  guideError?: string
  /** Images the guide was read from; any other set means it's out of date. */
  guideImages?: string[]
  /** The guide was changed by hand, so new images don't overwrite it. */
  guideEdited?: boolean
  /** Saved listings whose posters are still being taken out of their photos, to be added. */
  incoming?: number
  /** Why some saved listings added last time never made it onto the board. */
  importError?: string
  /** ISO 8601 */
  createdAt: string
  updatedAt: string
  /** "city": made for city posters, with `city` (Citys → Styles); a normal style when absent. */
  kind?: "city"
  city?: CityStyleData
}

export type StyleSummary = Pick<
  Style,
  "id" | "name" | "guide" | "guideStatus" | "incoming" | "createdAt" | "updatedAt" | "kind"
> & {
  count: number
  /** Image URLs for the cover, up to four. */
  covers: string[]
  /** City styles: their groups, whether they're confirmed, their guide's version. */
  cityTags?: string[]
  cityStatus?: "draft" | "confirmed"
  cityVersion?: number
}

/** Images on the Generation page a moodboard can be filled from, one group per set. */
export type StyleSource = {
  /** Generation set id. */
  id: string
  title: string
  folder: string | null
  createdAt: string
  images: { file: string; label: string; approved: boolean }[]
}

/** A moodboard reads best with a handful of images; more than this is noise. */
export const MAX_IMAGES = 24
/** At most this many go to Gemini when the guide is written. */
export const READ_IMAGES = 10
