"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon, HeartIcon, ListPlusIcon, PlusIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { preloadFont, saveFontLists, useFontCatalog, useLoadedFonts } from "@/hooks/use-fonts"
import type { FontFamily } from "@/lib/citys/composition/fonts"
import { fontKey } from "@/lib/citys/composition/render"
import { cn } from "@/lib/utils"

// Picks a Google Font for a text: searchable, by category, most popular
// first, with the shop's liked fonts and its own lists one tab away. Each
// name is shown in its own font once it's in view; a heart likes it, the
// list button files it into a list.

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "Sans Serif", label: "Sans" },
  { value: "Serif", label: "Serif" },
  { value: "Display", label: "Display" },
  { value: "Handwriting", label: "Script" },
  { value: "Monospace", label: "Mono" },
]

const SHOW = 60

const newListId = () => `l-${Date.now().toString(36)}`

export function FontPicker({ value, onChange }: { value: string; onChange: (family: string, weights: number[]) => void }) {
  const { families, lists } = useFontCatalog()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [category, setCategory] = React.useState("all")
  const [tab, setTab] = React.useState<string>("all")

  const needle = query.trim().toLowerCase()
  const shown = React.useMemo(() => {
    let list = families ?? []
    if (tab === "liked") list = list.filter((f) => lists.liked.includes(f.family))
    else if (tab !== "all") {
      const l = lists.lists.find((x) => x.id === tab)
      list = list.filter((f) => l?.families.includes(f.family))
    }
    if (category !== "all") list = list.filter((f) => f.category === category)
    if (needle) list = list.filter((f) => f.family.toLowerCase().includes(needle)).sort((a, b) => Number(b.family.toLowerCase().startsWith(needle)) - Number(a.family.toLowerCase().startsWith(needle)))
    else list = [...list].sort((a, b) => a.popularity - b.popularity)
    return list.slice(0, SHOW)
  }, [families, lists, tab, category, needle])

  function toggleLike(family: string) {
    const liked = lists.liked.includes(family) ? lists.liked.filter((f) => f !== family) : [...lists.liked, family]
    void saveFontLists({ ...lists, liked })
  }

  function addToList(family: string, listId: string | null, name?: string) {
    if (listId === null && name) {
      void saveFontLists({ ...lists, lists: [...lists.lists, { id: newListId(), name, families: [family] }] })
      return
    }
    void saveFontLists({
      ...lists,
      lists: lists.lists.map((l) => (l.id === listId ? { ...l, families: l.families.includes(family) ? l.families.filter((f) => f !== family) : [...l.families, family] } : l)),
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="w-full justify-between font-normal" />}>
        <span className="truncate">{value}</span>
        <ChevronDownIcon className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-0">
        <div className="flex items-center gap-2 border-b px-2.5">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${families ? families.length.toLocaleString("en-US") : ""} Google Fonts`}
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Search fonts"
          />
        </div>
        <div className="flex flex-wrap gap-1 border-b px-2 py-1.5">
          <TabChip on={tab === "all"} onClick={() => setTab("all")}>
            All
          </TabChip>
          <TabChip on={tab === "liked"} onClick={() => setTab("liked")}>
            <HeartIcon className="size-3" />
            {lists.liked.length}
          </TabChip>
          {lists.lists.map((l) => (
            <TabChip key={l.id} on={tab === l.id} onClick={() => setTab(l.id)}>
              {l.name}
            </TabChip>
          ))}
        </div>
        <div className="flex gap-1 border-b px-2 py-1.5">
          {CATEGORIES.map((c) => (
            <TabChip key={c.value} on={category === c.value} onClick={() => setCategory(c.value)}>
              {c.label}
            </TabChip>
          ))}
        </div>
        <ul className="max-h-80 overflow-y-auto p-1">
          {families === null && <li className="px-2 py-2 text-xs text-muted-foreground">Loading fonts…</li>}
          {shown.map((f) => (
            <FontRow
              key={f.family}
              font={f}
              current={f.family === value}
              liked={lists.liked.includes(f.family)}
              lists={lists.lists}
              onPick={() => {
                onChange(f.family, f.weights)
                setOpen(false)
              }}
              onLike={() => toggleLike(f.family)}
              onList={(listId, name) => addToList(f.family, listId, name)}
            />
          ))}
          {families && shown.length === 0 && <li className="px-2 py-2 text-xs text-muted-foreground">No font matches.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function TabChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn("inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50", on ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
    >
      {children}
    </button>
  )
}

function FontRow({
  font,
  current,
  liked,
  lists,
  onPick,
  onLike,
  onList,
}: {
  font: FontFamily
  current: boolean
  liked: boolean
  lists: { id: string; name: string; families: string[] }[]
  onPick: () => void
  onLike: () => void
  onList: (listId: string | null, name?: string) => void
}) {
  const ref = React.useRef<HTMLLIElement>(null)
  const [visible, setVisible] = React.useState(false)
  const weight = font.weights.includes(400) ? 400 : (font.weights[0] ?? 400)
  const spec = { family: font.family, weight, italic: false }
  React.useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setVisible(true))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  React.useEffect(() => {
    if (visible) void preloadFont(spec)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])
  const fonts = useLoadedFonts(visible ? [spec] : [])
  const loaded = fonts.get(fontKey(spec))
  const path = loaded ? loaded.getPath(font.family, 0, 15, 15).toPathData(1) : null
  const width = loaded ? Math.min(200, loaded.getAdvanceWidth(font.family, 15) + 2) : 0
  const [listing, setListing] = React.useState(false)
  const [name, setName] = React.useState("")

  return (
    <li ref={ref} className="group/f flex items-center gap-1 rounded-md pr-1 hover:bg-accent">
      <button type="button" onClick={onPick} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <span className="grid size-4 shrink-0 place-items-center">{current && <CheckIcon className="size-3.5" />}</span>
        {path ? (
          <svg width={width} height={20} viewBox={`0 0 ${width} 20`} className="shrink-0 overflow-visible fill-current" aria-label={font.family}>
            <path d={path} />
          </svg>
        ) : (
          <span className="truncate text-sm">{font.family}</span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{font.weights.length}w</span>
      </button>
      <button type="button" onClick={onLike} aria-label={liked ? "Unlike" : "Like"} className={cn("grid size-6 place-items-center rounded outline-none", liked ? "text-like" : "text-muted-foreground opacity-0 group-hover/f:opacity-100 focus-visible:opacity-100")}>
        <HeartIcon className={cn("size-3.5", liked && "fill-current")} />
      </button>
      <Popover open={listing} onOpenChange={setListing}>
        <PopoverTrigger className="grid size-6 place-items-center rounded text-muted-foreground opacity-0 outline-none group-hover/f:opacity-100 focus-visible:opacity-100" aria-label="Add to a list">
          <ListPlusIcon className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 gap-1 p-1">
          {lists.map((l) => (
            <button key={l.id} type="button" onClick={() => onList(l.id)} className="flex items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-accent">
              {l.name}
              {l.families.includes(font.family) && <CheckIcon className="size-3" />}
            </button>
          ))}
          <form
            className="flex items-center gap-1 p-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (!name.trim()) return
              onList(null, name.trim())
              setName("")
              setListing(false)
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New list" className="h-7 min-w-0 flex-1 rounded border bg-transparent px-2 text-xs outline-none" />
            <button type="submit" className="grid size-7 place-items-center rounded border text-muted-foreground hover:text-foreground" aria-label="Create list">
              <PlusIcon className="size-3.5" />
            </button>
          </form>
        </PopoverContent>
      </Popover>
    </li>
  )
}
