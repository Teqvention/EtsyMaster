"use client"

import * as React from "react"
import { CheckIcon, ChevronRightIcon, MinusIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { describeTags, sameTag, tagName, tagUnder, type PrimaryTag, type Tag } from "@/lib/tags"
import { cn } from "@/lib/utils"

// Tags for one thing or many, shops and mockups alike (see lib/tags.ts): the
// primary tags in use as a checklist, any number of them switched on (a
// search field finds one or creates it), then for each primary tag every one
// of the things carries, its secondary tags to switch on and off or add to.
// For many things at once a row shows a dash when only some carry it.

type State = "all" | "some" | "none"

const stateOf = (carrying: number, total: number): State =>
  carrying === 0 ? "none" : carrying === total ? "all" : "some"

export function TagPicker({
  known,
  items,
  onPrimary,
  onSecondary,
  onClear,
  noun,
  autoFocus = true,
}: {
  /** Every primary tag in use for this kind of thing, with its secondary tags. */
  known: PrimaryTag[]
  /** The tags of each thing being tagged. */
  items: Tag[][]
  onPrimary: (primary: string, on: boolean) => void
  onSecondary: (primary: string, secondary: string, on: boolean) => void
  /** Takes every tag off; left out when none is on. */
  onClear?: () => void
  /** What's tagged, plural ("shops"), for the hint when they don't share a primary tag. */
  noun: string
  autoFocus?: boolean
}) {
  const total = items.length
  const tagged = items.filter((tags) => tags.length > 0).length
  const carrying = (name: string) => items.filter((tags) => !!tagUnder(tags, name)).length
  // The primary tags every one carries, in the first one's order: only those can take secondary ones for all.
  const shared = (items[0] ?? []).filter((t) => items.every((tags) => !!tagUnder(tags, t.primary))).map((t) => t.primary)
  // The primary tags carried when the picker opened lead the list, and stay
  // put while tags go on and off so no row moves under the pointer.
  const [first] = React.useState(() => new Set(items.flat().map((t) => t.primary.toLowerCase())))
  // A primary tag just made isn't counted anywhere yet.
  const list = React.useMemo(() => {
    const extra = (items[0] ?? []).filter((t) => !known.some((k) => sameTag(k.name, t.primary)))
    const all = [...known, ...extra.map((t) => ({ name: t.primary, count: 1, secondary: [] }))]
    return all.toSorted((a, b) => Number(first.has(b.name.toLowerCase())) - Number(first.has(a.name.toLowerCase())))
  }, [known, items, first])

  return (
    <div className="flex flex-col">
      <PrimaryList
        tags={list}
        stateOf={(name) => stateOf(carrying(name), total)}
        autoFocus={autoFocus}
        onToggle={onPrimary}
        onClear={tagged > 0 ? onClear : undefined}
      />
      <div className="max-h-[min(22rem,45svh)] overflow-y-auto border-t">
        {shared.length > 0 ? (
          <div className="flex flex-col divide-y">
            {shared.map((primary) => (
              <SecondaryTags
                key={primary.toLowerCase()}
                primary={primary}
                known={list.find((t) => sameTag(t.name, primary))?.secondary ?? []}
                stateOf={(name) =>
                  stateOf(
                    items.filter((tags) => tagUnder(tags, primary)?.secondary.some((s) => sameTag(s, name))).length,
                    total
                  )
                }
                onToggle={(name, on) => onSecondary(primary, name, on)}
              />
            ))}
          </div>
        ) : (
          <p className="px-3 py-2.5 text-xs text-pretty text-muted-foreground">
            {tagged > 0
              ? `These ${noun} share no primary tag: give them one to add secondary tags.`
              : "Pick primary tags first, e.g. City and Kitchen. Then narrow each down with secondary tags: Cartoon, Real, Funky."}
          </p>
        )}
      </div>
    </div>
  )
}

function PrimaryList({
  tags,
  stateOf,
  autoFocus,
  onToggle,
  onClear,
}: {
  tags: { name: string; count: number }[]
  stateOf: (name: string) => State
  autoFocus: boolean
  onToggle: (name: string, on: boolean) => void
  onClear?: () => void
}) {
  const [query, setQuery] = React.useState("")
  const input = React.useRef<HTMLInputElement>(null)
  const list = React.useRef<HTMLUListElement>(null)

  const name = tagName(query)
  const needle = name.toLowerCase()
  const matches = needle
    ? tags
        .filter((t) => t.name.toLowerCase().includes(needle))
        .toSorted(
          (a, b) => Number(b.name.toLowerCase().startsWith(needle)) - Number(a.name.toLowerCase().startsWith(needle))
        )
    : tags
  const exact = matches.some((t) => t.name.toLowerCase() === needle)

  // From the field, a tag is always switched on; clicking a row toggles it.
  function turnOn(tag: string) {
    onToggle(tag, true)
    setQuery("")
  }

  // ↑/↓ walk the field and the rows, like a menu.
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    const items = [input.current, ...(list.current?.querySelectorAll<HTMLElement>("button") ?? [])].filter(
      (el): el is HTMLElement => !!el
    )
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = items[Math.min(Math.max(at + (event.key === "ArrowDown" ? 1 : -1), 0), items.length - 1)]
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  return (
    <div className="flex flex-col" onKeyDown={onKeyDown}>
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1">
        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Primary tags</span>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="-mr-1 inline-flex items-center gap-0.5 rounded-sm px-1 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:text-destructive [&_svg]:size-3"
          >
            <XIcon />
            Remove tags
          </button>
        )}
      </div>
      <div className="mx-1.5 flex items-center gap-2 rounded-md border px-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            const top = matches.find((t) => t.name.toLowerCase() === needle) ?? (needle ? matches[0] : undefined)
            if (top) turnOn(top.name)
            else if (name) turnOn(name)
          }}
          placeholder={tags.length ? "Find or create a tag" : "Name a tag, e.g. City"}
          aria-label="Find or create a primary tag"
          maxLength={32}
          autoComplete="off"
          spellCheck={false}
          className="h-8 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <ul ref={list} className="max-h-56 overflow-y-auto p-1.5" aria-label="Primary tags">
        {matches.map((tag) => {
          const state = stateOf(tag.name)
          return (
            <li key={tag.name}>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
                onClick={() => onToggle(tag.name, state !== "all")}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:bg-accent [@media(hover:hover)]:hover:bg-accent"
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors duration-100 ease-out",
                    state === "none" ? "border-input" : "border-primary bg-primary text-primary-foreground"
                  )}
                >
                  {state === "all" && <CheckIcon className="size-3" strokeWidth={3} />}
                  {state === "some" && <MinusIcon className="size-3" strokeWidth={3} />}
                </span>
                <span className={cn("min-w-0 flex-1 truncate", state === "all" && "font-medium")}>{tag.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{tag.count}</span>
              </button>
            </li>
          )
        })}

        {name && !exact && (
          <li>
            <button
              type="button"
              onClick={() => turnOn(name)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:bg-accent [@media(hover:hover)]:hover:bg-accent"
            >
              <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">
                Create <span className="font-medium">“{name}”</span>
              </span>
            </button>
          </li>
        )}

        {!name && matches.length === 0 && (
          <li className="px-2 py-2 text-xs text-muted-foreground">No tags yet. Type a name and press Enter.</li>
        )}
      </ul>
    </div>
  )
}

/** The secondary tags known under `primary`, as toggles, and a field for a new one. */
function SecondaryTags({
  primary,
  known,
  stateOf,
  onToggle,
}: {
  primary: string
  known: { name: string; count: number }[]
  stateOf: (name: string) => State
  onToggle: (name: string, on: boolean) => void
}) {
  const [query, setQuery] = React.useState("")

  function add() {
    const name = tagName(query)
    if (!name) return
    onToggle(name, true)
    setQuery("")
  }

  return (
    <div className="flex flex-col gap-2 px-3 pt-2.5 pb-3">
      <span className="flex min-w-0 items-center gap-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        <span className="shrink-0">Secondary tags</span>
        <ChevronRightIcon className="size-3 shrink-0" aria-hidden />
        <span className="truncate normal-case tracking-normal text-foreground">{primary}</span>
      </span>
      {known.length > 0 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={`Secondary tags under ${primary}`}>
          {known.map((tag) => {
            const state = stateOf(tag.name)
            return (
              <button
                key={tag.name}
                type="button"
                aria-pressed={state === "all" ? true : state === "some" ? "mixed" : false}
                onClick={() => onToggle(tag.name, state !== "all")}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-[background-color,border-color,color,transform] duration-150 ease-out-strong outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97] motion-reduce:transition-none [&_svg]:size-3",
                  state === "all"
                    ? "border-primary bg-primary text-primary-foreground"
                    : state === "some"
                      ? "border-dashed border-primary/60 text-foreground"
                      : "text-muted-foreground [@media(hover:hover)]:hover:bg-muted [@media(hover:hover)]:hover:text-foreground"
                )}
              >
                {state === "all" ? <CheckIcon strokeWidth={3} /> : state === "some" ? <MinusIcon strokeWidth={3} /> : <PlusIcon />}
                {tag.name}
                <span className={cn("tabular-nums", state === "all" ? "opacity-70" : "text-muted-foreground")}>
                  {tag.count}
                </span>
              </button>
            )
          })}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              add()
            }
          }}
          placeholder={known.length ? "Add another, e.g. Funky" : "Add one, e.g. Cartoon"}
          aria-label={`Add a secondary tag under ${primary}`}
          maxLength={32}
          autoComplete="off"
          spellCheck={false}
          className="h-7 w-full min-w-0 rounded-md border bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button
          variant="outline"
          size="icon-sm"
          className="size-7 shrink-0 active:scale-[0.97]"
          disabled={!tagName(query)}
          onClick={add}
          aria-label={`Add the secondary tag under ${primary}`}
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  )
}

/** Small and quiet, next to a name: "City › Cartoon, Funky", one pill per primary tag, the first few. */
export function TagBadges({ tags, max = 2, className }: { tags: Tag[]; max?: number; className?: string }) {
  if (!tags.length) return null
  const shown = tags.slice(0, max)
  const more = tags.length - shown.length
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)} title={describeTags(tags)}>
      {shown.map((tag) => (
        <TagBadge key={tag.primary.toLowerCase()} tag={tag} />
      ))}
      {more > 0 && (
        <span className="inline-flex h-4 shrink-0 items-center rounded-full border px-1.5 text-[10px] leading-none text-muted-foreground tabular-nums">
          +{more}
        </span>
      )}
    </span>
  )
}

function TagBadge({ tag }: { tag: Tag }) {
  return (
    <span className="inline-flex h-4 max-w-48 min-w-0 items-center gap-0.5 rounded-full border px-1.5 text-[10px] leading-none font-normal text-muted-foreground">
      <span className="shrink-0 font-medium text-foreground">{tag.primary}</span>
      {tag.secondary.length > 0 && (
        <>
          <ChevronRightIcon className="size-2.5 shrink-0 opacity-60" aria-hidden />
          <span className="truncate">{tag.secondary.join(", ")}</span>
        </>
      )}
    </span>
  )
}
