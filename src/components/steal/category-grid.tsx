"use client"

import * as React from "react"
import { CheckIcon, FolderIcon, PlusIcon, SearchIcon } from "lucide-react"

import { refreshCategories, useMockupCategories } from "@/hooks/use-mockup-categories"
import { cn } from "@/lib/utils"

// Categories as big targets: one click files everything into one. Typing
// filters, and names a new category when nothing matches; ↑/↓ (and ←/→ with
// an empty field) move through them and Enter takes the highlighted one.

const COLUMNS = 2

export function CategoryGrid({
  onPick,
  counts,
  current,
  inputRef,
}: {
  onPick: (category: string) => void
  /** Listings already in each category (lower-cased name). */
  counts: ReadonlyMap<string, number>
  /** Where everything being filed already is, if all in one. */
  current?: string | null
  /** For the dialog to focus first. */
  inputRef?: React.Ref<HTMLInputElement>
}) {
  const categories = useMockupCategories()
  const [query, setQuery] = React.useState("")
  const [highlight, setHighlight] = React.useState(0)
  const list = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    refreshCategories()
  }, [])

  const name = query.trim().replace(/\s+/g, " ")
  const needle = name.toLowerCase()
  const matches = needle
    ? categories
        .filter((c) => c.name.toLowerCase().includes(needle))
        .toSorted(
          (a, b) =>
            Number(b.name.toLowerCase().startsWith(needle)) -
            Number(a.name.toLowerCase().startsWith(needle))
        )
    : categories
  const creating = !!name && !matches.some((c) => c.name.toLowerCase() === needle)
  // Options in order: the matches, then "Create …".
  const options = [...matches.map((c) => c.name), ...(creating ? [null] : [])]
  const active = Math.min(highlight, options.length - 1)

  // A new name isn't created here: filing into it creates it on the server,
  // and two writers of the category list at once could trip each other.
  function pick(option: string | null) {
    onPick(option ?? name.slice(0, 40))
  }

  function move(by: number) {
    if (!options.length) return
    const next = Math.max(0, Math.min(options.length - 1, active + by))
    setHighlight(next)
    list.current?.querySelector(`[data-option="${next}"]`)?.scrollIntoView({ block: "nearest" })
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <label className="flex h-9 items-center gap-2 rounded-lg border bg-background px-2.5 transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlight(0)
          }}
          onKeyDown={(event) => {
            const empty = !event.currentTarget.value
            if (event.key === "ArrowDown") move(COLUMNS)
            else if (event.key === "ArrowUp") move(-COLUMNS)
            else if (event.key === "ArrowRight" && empty) move(1)
            else if (event.key === "ArrowLeft" && empty) move(-1)
            else if (event.key === "Enter" && options.length) pick(options[active])
            else return
            event.preventDefault()
          }}
          placeholder="Find or create a category"
          aria-label="Find or create a category"
          maxLength={40}
          autoComplete="off"
          spellCheck={false}
          className="h-full w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </label>

      <div
        ref={list}
        role="listbox"
        aria-label="Categories"
        className="-m-1 grid max-h-[min(22rem,50svh)] grid-cols-2 content-start gap-2 overflow-y-auto p-1"
      >
        {matches.map((category, i) => {
          const key = category.name.toLowerCase()
          const count = counts.get(key) ?? 0
          const here = current?.toLowerCase() === key
          return (
            <Option
              key={category.name}
              index={i}
              highlighted={i === active}
              onHover={() => setHighlight(i)}
              onPick={() => pick(category.name)}
              icon={<FolderIcon />}
              title={category.name}
              detail={here ? "Already here" : count ? `${count} stolen` : "Empty"}
              trailing={here && <CheckIcon className="size-4 text-brand" />}
            />
          )
        })}
        {creating && (
          <Option
            index={matches.length}
            highlighted={active === matches.length}
            onHover={() => setHighlight(matches.length)}
            onPick={() => pick(null)}
            icon={<PlusIcon />}
            title={`Create “${name}”`}
            detail="New category"
            dashed
          />
        )}
        {!name && matches.length === 0 && (
          <p className="col-span-full rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            No categories yet. Type a name to create the first one.
          </p>
        )}
      </div>
    </div>
  )
}

function Option({
  index,
  highlighted,
  onHover,
  onPick,
  icon,
  title,
  detail,
  trailing,
  dashed,
}: {
  index: number
  highlighted: boolean
  onHover: () => void
  onPick: () => void
  icon: React.ReactNode
  title: string
  detail: string
  trailing?: React.ReactNode
  dashed?: boolean
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={highlighted}
      data-option={index}
      // Pointer moves (not enters) so a list scrolled under a still cursor
      // doesn't steal the keyboard's highlight.
      onPointerMove={onHover}
      onClick={onPick}
      className={cn(
        "group/option flex h-14 min-w-0 items-center gap-3 rounded-lg border bg-card px-3 text-left outline-none transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.98] motion-reduce:active:scale-100",
        dashed && "border-dashed",
        highlighted && "border-foreground/20 bg-accent"
      )}
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground transition-colors duration-150 [&_svg]:size-4",
          highlighted && "bg-background text-foreground"
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="truncate text-xs text-muted-foreground tabular-nums">{detail}</span>
      </span>
      {trailing}
    </button>
  )
}
