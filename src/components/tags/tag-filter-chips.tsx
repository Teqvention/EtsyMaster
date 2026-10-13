"use client"

import { CornerDownRightIcon, TagIcon } from "lucide-react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { countTags, hasPrimary, hasSecondary, sameTag, tagUnder, type Tag } from "@/lib/tags"

// Which things a page lists by their tags, for shops and mockups alike: all
// (`primary` null), one primary tag's (`primary` "City"), within it one
// secondary tag's (`secondary` "Cartoon") or those with none under it
// (`secondary` ""), or the things without a tag (`primary` ""). A row of
// chips picks the primary tag, a second one under it the secondary tag.

export type TagView = { primary: string | null; secondary: string | null }

export const ALL_TAGS: TagView = { primary: null, secondary: null }

export function matchesTagView(tags: Tag[], { primary, secondary }: TagView) {
  if (primary === null) return true
  if (primary === "") return tags.length === 0
  if (secondary === null) return hasPrimary(tags, primary)
  if (secondary === "") return tagUnder(tags, primary)?.secondary.length === 0
  return hasSecondary(tags, secondary, primary)
}

/** The view as it reads in words: "City › Cartoon", "Untagged", or null for all. */
export function describeTagView({ primary, secondary }: TagView) {
  if (primary === null) return null
  if (primary === "") return "Untagged"
  if (secondary === null) return primary
  return `${primary} › ${secondary === "" ? "No secondary tag" : secondary}`
}

type Chip = { key: string; label: string; count: number; value: string | null; icon?: boolean }

export function TagFilterChips({
  items,
  view,
  onChange,
  empty = [],
}: {
  /** The tags of every thing listed. */
  items: Tag[][]
  view: TagView
  onChange: (view: TagView) => void
  /** Primary tags named but carried by none, shown with 0. */
  empty?: string[]
}) {
  const tags = countTags(items)
  for (const name of empty) {
    if (!tags.some((t) => sameTag(t.name, name))) tags.push({ name, count: 0, secondary: [] })
  }
  tags.sort((a, b) => a.name.localeCompare(b.name))
  const untagged = items.filter((t) => t.length === 0).length
  // A tag nobody carries any more (or a stale link) still shows while picked.
  const picked = view.primary ? tags.find((t) => sameTag(t.name, view.primary!)) : undefined
  const missing = !!view.primary && !picked
  const primaryKey = view.primary === null ? ALL : view.primary === "" ? UNTAGGED : `t:${view.primary.toLowerCase()}`

  if (tags.length === 0 && !missing) return null

  const primaries: Chip[] = [
    { key: ALL, label: "All", count: items.length, value: null },
    ...tags.map((t) => ({ key: `t:${t.name.toLowerCase()}`, label: t.name, count: t.count, value: t.name, icon: true })),
    ...(missing ? [{ key: primaryKey, label: view.primary!, count: 0, value: view.primary, icon: true }] : []),
    ...(untagged > 0 ? [{ key: UNTAGGED, label: "Untagged", count: untagged, value: "" }] : []),
  ]

  // Within a primary tag: its secondary tags, and the things with none of them.
  const plain = picked ? items.filter((t) => tagUnder(t, picked.name)?.secondary.length === 0).length : 0
  const subMissing = !!view.secondary && !!picked && !picked.secondary.some((s) => sameTag(s.name, view.secondary!))
  const secondaries: Chip[] = picked
    ? [
        { key: "s:all", label: `All ${picked.name}`, count: picked.count, value: null },
        ...picked.secondary.map((s) => ({ key: `s:${s.name.toLowerCase()}`, label: s.name, count: s.count, value: s.name })),
        ...(subMissing ? [{ key: `s:${view.secondary!.toLowerCase()}`, label: view.secondary!, count: 0, value: view.secondary }] : []),
        ...(plain > 0 && picked.secondary.length > 0 ? [{ key: "s:none", label: "No secondary tag", count: plain, value: "" }] : []),
      ]
    : []
  const secondaryKey =
    view.secondary === null ? "s:all" : view.secondary === "" ? "s:none" : `s:${view.secondary.toLowerCase()}`

  return (
    <div className="flex flex-col gap-1.5">
      <ChipRow chips={primaries} value={primaryKey} label="Primary tag" onPick={(chip) => onChange({ primary: chip.value, secondary: null })} />
      {secondaries.length > 1 && (
        <div className="flex items-start gap-1.5 pl-1">
          <CornerDownRightIcon className="mt-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <ChipRow
            chips={secondaries}
            value={secondaryKey}
            label={`Secondary tag under ${picked!.name}`}
            onPick={(chip) => onChange({ primary: view.primary, secondary: chip.value })}
          />
        </div>
      )}
    </div>
  )
}

const ALL = "all"
const UNTAGGED = "untagged"

function ChipRow({
  chips,
  value,
  label,
  onPick,
}: {
  chips: Chip[]
  value: string
  label: string
  onPick: (chip: Chip) => void
}) {
  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      spacing={1}
      value={[value]}
      onValueChange={(next) => {
        const chip = chips.find((c) => c.key === next[0])
        if (chip) onPick(chip)
      }}
      aria-label={label}
      className="w-full flex-wrap"
    >
      {chips.map((chip) => (
        <ToggleGroupItem key={chip.key} value={chip.key} className="gap-1.5">
          {chip.icon && <TagIcon />}
          {chip.label}
          <span className="text-xs text-muted-foreground tabular-nums">{chip.count}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
