"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon, SearchIcon, TagIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { formatNumber } from "@/lib/etsy/format"
import type { Listing } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// Pick keywords (the listings' tags) to narrow a set of listings down to the
// ones carrying any of them. Typing searches every tag in the set, most used
// first; ↑/↓ move, Enter toggles.

/** How a tag is compared: case and stray spaces don't make a different tag. */
export function normalizeTag(tag: string) {
  return tag.toLowerCase().trim()
}

/** `listings` carrying any of `tags` (normalized); all of them when none are picked. */
export function withAnyTag(listings: Listing[], tags: string[]) {
  if (!tags.length) return listings
  const wanted = new Set(tags)
  return listings.filter((l) => l.tags.some((t) => wanted.has(normalizeTag(t))))
}

// Thousands of tags in a big shop; the list only needs to show the first few
// matches.
const MAX_OPTIONS = 200

export function TagFilter({
  listings,
  value,
  onChange,
}: {
  listings: Listing[]
  /** Picked tags, normalized. */
  value: string[]
  onChange: (tags: string[]) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [active, setActive] = React.useState(0)
  const list = React.useRef<HTMLDivElement>(null)

  const tags = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const l of listings) {
      for (const tag of new Set(l.tags.map(normalizeTag))) {
        if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count)
  }, [listings])

  const needle = normalizeTag(query).replace(/\s+/g, " ")
  const matches = React.useMemo(() => {
    if (!needle) return tags.slice(0, MAX_OPTIONS)
    return tags
      .filter((t) => t.tag.includes(needle))
      .sort((a, b) => Number(b.tag.startsWith(needle)) - Number(a.tag.startsWith(needle)))
      .slice(0, MAX_OPTIONS)
  }, [tags, needle])

  const picked = new Set(value)

  function toggle(tag: string) {
    onChange(picked.has(tag) ? value.filter((t) => t !== tag) : [...value, tag])
  }

  function move(to: number) {
    const next = Math.max(0, Math.min(to, matches.length - 1))
    setActive(next)
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${next}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery("")
        }}
      >
        <PopoverTrigger
          render={
            <Button variant="outline" size="sm" className="text-foreground">
              <TagIcon />
              Keywords
              {value.length > 0 && (
                <span className="rounded-full bg-brand px-1.5 text-[11px] leading-4 text-white tabular-nums">
                  {value.length}
                </span>
              )}
              <ChevronDownIcon className="text-muted-foreground" />
            </Button>
          }
        />
        <PopoverContent align="start" className="w-80 gap-0 p-0">
          <div className="flex items-center gap-2 border-b px-2.5">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(0)
                list.current?.scrollTo({ top: 0 })
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault()
                  move(active + 1)
                } else if (event.key === "ArrowUp") {
                  event.preventDefault()
                  move(active - 1)
                } else if (event.key === "Enter") {
                  event.preventDefault()
                  const match = matches[active]
                  if (match) toggle(match.tag)
                }
              }}
              placeholder={`Search ${formatNumber(tags.length)} keywords`}
              aria-label="Search keywords"
              autoComplete="off"
              spellCheck={false}
              className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div ref={list} role="listbox" aria-multiselectable className="max-h-72 overflow-y-auto p-1">
            {matches.map((t, index) => (
              <button
                key={t.tag}
                type="button"
                role="option"
                aria-selected={picked.has(t.tag)}
                data-index={index}
                onMouseMove={() => active !== index && setActive(index)}
                onClick={() => toggle(t.tag)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm outline-none",
                  index === active && "bg-accent text-accent-foreground"
                )}
              >
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-[4px] border border-input",
                    picked.has(t.tag) && "border-brand bg-brand text-white"
                  )}
                >
                  {picked.has(t.tag) && <CheckIcon className="size-3" />}
                </span>
                <span className="truncate">{t.tag}</span>
                <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
                  {formatNumber(t.count)}
                </span>
              </button>
            ))}
            {matches.length === 0 && (
              <p className="px-1.5 py-2 text-xs text-muted-foreground">No keyword matches “{query.trim()}”.</p>
            )}
          </div>

          {value.length > 0 && (
            <div className="flex items-center justify-between border-t px-2.5 py-1.5 text-xs text-muted-foreground">
              <span>Listings with any of {value.length}</span>
              <Button variant="ghost" size="xs" onClick={() => onChange([])}>
                Clear
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {value.map((tag) => (
        <Button
          key={tag}
          variant="secondary"
          size="xs"
          onClick={() => toggle(tag)}
          aria-label={`Remove keyword ${tag}`}
        >
          {tag}
          <XIcon data-icon="inline-end" />
        </Button>
      ))}
    </div>
  )
}
