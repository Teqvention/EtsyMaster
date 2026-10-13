// Tags in two steps, for shops and mockups alike: primary tags say what kind
// of thing it is ("City", "Kitchen"), and under each the secondary tags tell
// them apart ("Cartoon", "Real", "Funky"). A thing can carry several primary
// tags, each with secondary tags of its own. Names are matched
// case-insensitively and keep the spelling they were first given.
//
// Stored as the full list plus its first primary tag in the field older
// versions read (a shop's `tag`, a mockup's `category`), so servers still on
// those keep showing and changing that one; where the two disagree, the old
// field wins for the first primary tag (see `joinTags`).

export type Tag = { primary: string; secondary: string[] }

export type TagCount = { name: string; count: number }
/** A primary tag in use, with its secondary tags. */
export type PrimaryTag = TagCount & { secondary: TagCount[] }

export const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** What a typed tag is saved as: single spaces, at most 32 characters. */
export const tagName = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, 32)

const isTag = (t: unknown): t is Tag =>
  !!t &&
  typeof (t as Tag).primary === "string" &&
  Array.isArray((t as Tag).secondary) &&
  (t as Tag).secondary.every((s) => typeof s === "string")

/**
 * The full list from what's stored: `first` (the old field's tag, or null
 * when it's unset) is authoritative for the first primary tag, `all` adds
 * the others. No `first` means no tags at all: an older server took them off.
 */
export function joinTags(first: Tag | null | undefined, all: unknown): Tag[] {
  if (!first?.primary) return []
  const rest = Array.isArray(all) ? all.filter(isTag) : []
  return [first, ...rest.filter((t) => !sameTag(t.primary, first.primary))]
}

/** The tag carrying `primary`, if any. */
export const tagUnder = (tags: Tag[], primary: string) => tags.find((t) => sameTag(t.primary, primary))

export const hasPrimary = (tags: Tag[], primary: string) => !!tagUnder(tags, primary)

/** Whether `secondary` is under `primary`, or under any primary tag when that's left out. */
export const hasSecondary = (tags: Tag[], secondary: string, primary?: string) =>
  tags.some((t) => (primary === undefined || sameTag(t.primary, primary)) && t.secondary.some((s) => sameTag(s, secondary)))

/** `tags` with `primary` added (at the end, with no secondary tags) or taken off with its secondary ones. */
export function withPrimary(tags: Tag[], primary: string, on: boolean): Tag[] {
  const others = tags.filter((t) => !sameTag(t.primary, primary))
  if (!on) return others
  return hasPrimary(tags, primary) ? tags : [...tags, { primary, secondary: [] }]
}

/** `tags` with `secondary` put under `primary` or taken off it; nothing changes without that primary tag. */
export function withSecondary(tags: Tag[], primary: string, secondary: string, on: boolean): Tag[] {
  return tags.map((t) => {
    if (!sameTag(t.primary, primary)) return t
    const others = t.secondary.filter((s) => !sameTag(s, secondary))
    return { ...t, secondary: on ? [...others, secondary] : others }
  })
}

/** Every primary tag on `lists` (one list per thing), A–Z, with how many carry it and its secondary tags (A–Z, counted). */
export function countTags(lists: Iterable<Tag[]>): PrimaryTag[] {
  const primaries = new Map<string, { name: string; count: number; secondary: Map<string, TagCount> }>()
  for (const tags of lists) {
    for (const tag of tags) {
      const key = tag.primary.toLowerCase()
      const primary = primaries.get(key) ?? { name: tag.primary, count: 0, secondary: new Map() }
      primary.count += 1
      for (const name of tag.secondary) {
        const held = primary.secondary.get(name.toLowerCase()) ?? { name, count: 0 }
        primary.secondary.set(name.toLowerCase(), { ...held, count: held.count + 1 })
      }
      primaries.set(key, primary)
    }
  }
  const byName = (a: TagCount, b: TagCount) => a.name.localeCompare(b.name)
  return [...primaries.values()]
    .map((p) => ({ name: p.name, count: p.count, secondary: [...p.secondary.values()].sort(byName) }))
    .sort(byName)
}

/** The spelling `name` already has as a primary tag in `known`, else `name`. */
export const primarySpelling = (known: PrimaryTag[], name: string) =>
  known.find((t) => sameTag(t.name, name))?.name ?? name

/** The spelling `name` already has as a secondary tag under `primary` in `known`, else `name`. */
export const secondarySpelling = (known: PrimaryTag[], primary: string, name: string) =>
  known.find((t) => sameTag(t.name, primary))?.secondary.find((s) => sameTag(s.name, name))?.name ?? name

/** A change to the tags of one or many things. */
export type TagChange =
  | { type: "primary"; primary: string; on: boolean }
  | { type: "secondary"; primary: string; secondary: string; on: boolean }
  | { type: "clear" }

export function isTagChange(value: unknown): value is TagChange {
  const c = value as TagChange
  if (!c || typeof c !== "object") return false
  if (c.type === "clear") return true
  if (c.type === "primary") return typeof c.primary === "string" && !!tagName(c.primary) && typeof c.on === "boolean"
  return (
    c.type === "secondary" &&
    typeof c.primary === "string" &&
    typeof c.secondary === "string" &&
    !!tagName(c.secondary) &&
    typeof c.on === "boolean"
  )
}

/** The change with its names as saved, in the spelling `known` has for them. */
export function spellChange(change: TagChange, known: PrimaryTag[]): TagChange {
  if (change.type === "clear") return change
  const primary = primarySpelling(known, tagName(change.primary))
  if (change.type === "primary") return { ...change, primary }
  return { ...change, primary, secondary: secondarySpelling(known, primary, tagName(change.secondary)) }
}

/** `tags` after `change`; a secondary tag goes only where its primary tag is. */
export function applyTagChange(tags: Tag[], change: TagChange): Tag[] {
  if (change.type === "clear") return []
  if (change.type === "primary") return withPrimary(tags, change.primary, change.on)
  return hasPrimary(tags, change.primary) ? withSecondary(tags, change.primary, change.secondary, change.on) : tags
}

/** "City › Cartoon, Funky", or just "City". */
export const describeTag = (tag: Tag) => (tag.secondary.length ? `${tag.primary} › ${tag.secondary.join(", ")}` : tag.primary)

/** Every tag in words: "City › Cartoon · Kitchen". */
export const describeTags = (tags: Tag[]) => tags.map(describeTag).join(" · ")
