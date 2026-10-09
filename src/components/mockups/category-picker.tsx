"use client"

import * as React from "react"
import { CheckIcon, FolderIcon, PlusIcon, SearchIcon } from "lucide-react"

import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import {
  createCategory,
  refreshCategories,
  useMockupCategories,
} from "@/hooks/use-mockup-categories"
import { cn } from "@/lib/utils"

// Search-or-create for mockup categories (the Saved page's folders), inside
// any menu, dropdown or context. Typing filters (from anywhere in the list,
// not just the field); Enter takes the top match, or creates the category
// when nothing matches. Arrow keys move through the list as in any menu.
export function CategoryPicker({
  onPick,
  counts,
  current,
}: {
  onPick: (category: string) => void
  /** What to count per category (lower-cased name), instead of its mockups. */
  counts?: ReadonlyMap<string, number>
  /** Checked in the list. */
  current?: string | null
}) {
  const categories = useMockupCategories()
  const [query, setQuery] = React.useState("")
  const [typing, setTyping] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  const list = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    refreshCategories()
    // After the menu has placed its own focus.
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
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
  const exact = matches.some((c) => c.name.toLowerCase() === needle)
  const top = matches.find((c) => c.name.toLowerCase() === needle)?.name ?? matches[0]?.name ?? null

  // Letters typed while a category is highlighted go to the field instead of
  // the menu's typeahead. Moving focus during keydown makes the browser insert
  // the character there.
  function redirectTyping(event: React.KeyboardEvent) {
    if (event.target === input.current || event.metaKey || event.ctrlKey || event.altKey) return
    if ((event.key.length === 1 && event.key !== " ") || event.key === "Backspace") {
      event.stopPropagation()
      input.current?.focus({ preventScroll: true })
    }
  }

  return (
    <div onKeyDownCapture={redirectTyping}>
      <div className="flex items-center gap-2 border-b px-2.5">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              event.stopPropagation()
              list.current?.querySelector<HTMLElement>("[data-default]")?.click()
              return
            }
            // Arrows into the list, Escape and Tab out stay with the menu;
            // every other key (←/→, Home, Space…) edits the text.
            if (!["ArrowDown", "ArrowUp", "Escape", "Tab"].includes(event.key)) {
              event.stopPropagation()
            }
          }}
          placeholder="Find or create a category"
          aria-label="Find or create a category"
          maxLength={40}
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div ref={list} className="max-h-64 overflow-y-auto p-1">
        {matches.map((category) => {
          const key = category.name.toLowerCase()
          const count = counts ? (counts.get(key) ?? 0) : category.count
          return (
            <DropdownMenuItem
              key={category.name}
              data-default={(typing && category.name === top) || undefined}
              onClick={() => onPick(createCategory(category.name))}
              className="data-default:bg-accent data-default:text-accent-foreground"
            >
              <FolderIcon className="text-muted-foreground" />
              <span className="truncate">{category.name}</span>
              <span className="ml-auto flex items-center gap-1.5 pl-3 text-xs text-muted-foreground tabular-nums">
                {count > 0 && count}
                {current?.toLowerCase() === key && <CheckIcon className="size-3.5 text-foreground" />}
              </span>
            </DropdownMenuItem>
          )
        })}

        {name && !exact && (
          <DropdownMenuItem
            data-default={(typing && top === null) || undefined}
            onClick={() => onPick(createCategory(name))}
            className={cn(
              "data-default:bg-accent data-default:text-accent-foreground",
              matches.length > 0 && "mt-1"
            )}
          >
            <PlusIcon className="text-muted-foreground" />
            <span className="min-w-0 truncate">
              Create <span className="font-medium">“{name}”</span>
            </span>
          </DropdownMenuItem>
        )}

        {!name && matches.length === 0 && (
          <p className="px-1.5 py-2 text-xs text-muted-foreground">
            No categories yet. Type a name to create one.
          </p>
        )}
      </div>
    </div>
  )
}
