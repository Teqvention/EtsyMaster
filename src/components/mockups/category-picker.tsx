"use client"

import * as React from "react"
import { CheckIcon, FolderIcon, PlusIcon, SearchIcon } from "lucide-react"

import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { createCategory, refreshCategories, useCategories, type Categories } from "@/hooks/use-categories"
import { childFolder, describeFolder, flatten, folderTree, isWithin, SEPARATOR } from "@/lib/saved/folders"
import { cn } from "@/lib/utils"

// Search-or-create for mockup categories (primary tags) or the Saved page's
// folders, inside any menu, dropdown or context. Typing filters (from
// anywhere in the list, not just the field); Enter takes the top match, or
// creates the category when nothing matches. Arrow keys move through the
// list as in any menu. Folders show as their tree, each counting what's in
// it and the folders inside; a search finds them by their whole path, and
// "a/b" makes a folder inside another.
export function CategoryPicker({
  of,
  onPick,
  counts,
  current,
  exclude,
  parent,
}: {
  /** Which list: mockup categories, or the folders steals go in. */
  of: Categories
  onPick: (category: string) => void
  /** What to count per category (lower-cased name), instead of what's in it. */
  counts?: ReadonlyMap<string, number>
  /** Checked in the list. */
  current?: string | null
  /** Folders: this one and those inside it are left out (it's being moved). */
  exclude?: string
  /** Folders: the one open, also offered to make a new folder inside. */
  parent?: string | null
}) {
  const folders = of === "saved"
  const listed = useCategories(of)
  // Folders as a tree, depth first, with what's in each and the folders inside.
  const categories = React.useMemo(() => {
    if (!folders) return listed.map((c) => ({ ...c, label: c.name, depth: 0 }))
    const own = listed.map((c) => ({ name: c.name, count: counts ? (counts.get(c.name.toLowerCase()) ?? 0) : c.count }))
    return flatten(folderTree(own))
      .filter((n) => !exclude || !isWithin(n.path, exclude))
      .map((n) => ({ name: n.path, count: n.total, label: n.name, depth: n.depth }))
  }, [folders, listed, counts, exclude])
  const [query, setQuery] = React.useState("")
  const [typing, setTyping] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  const list = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    refreshCategories(of)
    // After the menu has placed its own focus.
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [of])

  const name = query.trim().replace(/\s+/g, " ")
  const needle = name.toLowerCase()
  // A folder's path reads with "›"; typed with "/" it matches too.
  const matches = needle
    ? categories
        .filter((c) => c.name.toLowerCase().includes(needle) || (folders && describeFolder(c.name).toLowerCase().includes(needle)))
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
          placeholder={folders ? "Find or create a folder" : "Find or create a tag"}
          aria-label={folders ? "Find or create a folder" : "Find or create a tag"}
          maxLength={folders ? 120 : 40}
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div ref={list} className="max-h-64 overflow-y-auto p-1">
        {matches.map((category) => {
          const key = category.name.toLowerCase()
          const count = folders || !counts ? category.count : (counts.get(key) ?? 0)
          return (
            <DropdownMenuItem
              key={category.name}
              data-default={(typing && category.name === top) || undefined}
              onClick={() => onPick(createCategory(of, category.name))}
              title={folders ? describeFolder(category.name) : undefined}
              style={!needle && category.depth ? { paddingLeft: 6 + category.depth * 12 } : undefined}
              className="data-default:bg-accent data-default:text-accent-foreground"
            >
              <FolderIcon className="text-muted-foreground" />
              <span className="truncate">{needle && folders ? describeFolder(category.name) : category.label}</span>
              <span className="ml-auto flex items-center gap-1.5 pl-3 text-xs text-muted-foreground tabular-nums">
                {count > 0 && count}
                {current?.toLowerCase() === key && <CheckIcon className="size-3.5 text-foreground" />}
              </span>
            </DropdownMenuItem>
          )
        })}

        {name && !exact && folders && parent && !name.includes(SEPARATOR) && (
          <DropdownMenuItem
            onClick={() => onPick(createCategory(of, childFolder(parent, name)))}
            className={cn(matches.length > 0 && "mt-1")}
          >
            <PlusIcon className="text-muted-foreground" />
            <span className="min-w-0 truncate">
              Create <span className="font-medium">“{name}”</span> in {describeFolder(parent)}
            </span>
          </DropdownMenuItem>
        )}

        {name && !exact && (
          <DropdownMenuItem
            data-default={(typing && top === null) || undefined}
            onClick={() => onPick(createCategory(of, name))}
            className={cn(
              "data-default:bg-accent data-default:text-accent-foreground",
              matches.length > 0 && !(folders && parent && !name.includes(SEPARATOR)) && "mt-1"
            )}
          >
            <PlusIcon className="text-muted-foreground" />
            <span className="min-w-0 truncate">
              Create <span className="font-medium">“{folders ? describeFolder(name) : name}”</span>
              {folders && parent && !name.includes(SEPARATOR) && " at the top"}
            </span>
          </DropdownMenuItem>
        )}

        {!name && matches.length === 0 && (
          <p className="px-1.5 py-2 text-xs text-muted-foreground">
            {folders ? "No folders yet. Type a name to create one; a/b makes b inside a." : "No tags yet. Type a name to create one."}
          </p>
        )}
      </div>
    </div>
  )
}
