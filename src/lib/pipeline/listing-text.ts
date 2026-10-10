import type { Account } from "@/lib/accounts/types"
import type { Orientation, SizeKey } from "@/lib/catalog/sizes"
import type { PriceProfile } from "@/lib/pricing/types"
import { buildDescription, withoutDashes } from "@/lib/uploads/description"
import { cleanTags, cleanTitle } from "@/lib/uploads/text"
import type { Draft } from "@/lib/uploads/types"

// What a listing says, as it goes to Gelato and Etsy: the draft's copy, the
// shop's description blocks, alt text per photo. Never a hyphen or dash in
// any of it, whatever the copywriter or a hand edit left in.

export type ListingText = {
  title: string
  tags: string[]
  description: string
  materials: string[]
  /** Alt text per listing photo, in order. */
  alt: string[]
}

const DASHES = /[-‐‑‒–—―]/g

/** Text without any dash: ranges become "to", the rest goes the way withoutDashes takes it. */
export function noDashes(text: string) {
  return withoutDashes(text.replace(/(\d)\s*[-‐‑‒–—―]\s*(\d)/g, "$1 to $2"))
    .replace(DASHES, " ")
    .replace(/[ \t]{2,}/g, " ")
}

const oneLine = (text: string) => noDashes(text).replace(/\s+/g, " ").trim()

/** Where a mockup shows the print, read off its scene's id and name (the first match wins). */
const PLACES: [RegExp, string][] = [
  [/angelehnt|leaning/, "leaning against a wall"],
  [/schlafzimmer|bett|\bbed/, "in a bedroom"],
  [/k(ü|ue)che|kitchen/, "in a kitchen"],
  [/diele|flur|hallway|entrance/, "in a hallway"],
  [/wohnzimmer|living|sofa|couch/, "in a living room"],
  [/esszimmer|dining/, "in a dining room"],
  [/b(ü|ue)ro|office|desk/, "in a home office"],
  [/regal|shel(f|ves)/, "above a shelf"],
  [/sideboard|kommode|dresser/, "above a sideboard"],
]

/**
 * The listing text of `draft` in `account`'s shop, its size lines for the
 * `sizes` it offers (the profile's when unknown); throws when the copy isn't
 * there yet. The draft id picks the block wordings, so they stay put. `shots`
 * says what each photo shows: null the poster itself, else its mockup scene's
 * id and name ("" when unknown).
 */
export function listingText(
  draft: Draft,
  account: Account,
  profile: PriceProfile | null,
  orientation: Orientation,
  shots: (string | null)[],
  sizes?: SizeKey[]
): ListingText {
  if (!draft.title?.trim() || !draft.tags?.length || !draft.description?.trim()) {
    throw new Error("The draft has no complete copy yet (title, tags and description)")
  }
  const title = cleanTitle(oneLine(draft.title))
  const tags = cleanTags(draft.tags.map((t) => t.replace(DASHES, " ")))
  const story = draft.description
  const description = noDashes(buildDescription({ story, account, profile, orientation, sizes, seed: draft.id }))
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  const materials = account.listing.materials.map(oneLine).filter(Boolean)

  // What the poster shows, briefly: its own few words, else the title's first part.
  const subject = oneLine(draft.design.title || title.split(/[|,]/)[0]).replace(/\b(poster|print|wall art)\b/gi, "").trim()
  const kind = orientation === "hor" ? "landscape art print" : "art print"
  // True to each photo: the poster alone, or where its scene puts it; a place seen before gets a view number.
  const seen = new Map<string, number>()
  const alt = shots.map((shot) => {
    const scene = shot?.toLowerCase() ?? ""
    const place = shot === null ? ", the full poster" : ` ${PLACES.find(([words]) => words.test(scene))?.[1] ?? "in a styled room"}`
    const n = (seen.get(place) ?? 0) + 1
    seen.set(place, n)
    const text = `${subject} ${kind}${place}${n > 1 ? `, view ${n}` : ""}`.replace(/\s+/g, " ").trim()
    return (text.charAt(0).toUpperCase() + text.slice(1)).slice(0, 250)
  })
  return { title, tags, description, materials, alt }
}
