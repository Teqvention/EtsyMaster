"use client"

import { useRouter } from "next/navigation"
import * as React from "react"
import { PaletteIcon, PlusIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"

import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { addGeneratedImages, createStyle, refreshStyles, sized, useStyles } from "@/hooks/use-styles"
import { cn } from "@/lib/utils"

// "Add to style" for a generated poster, in any dropdown or context menu: a
// submenu to find a style (or name a new one) and copy the poster onto its
// moodboard. Typing filters from anywhere in the list; Enter takes the top
// match, or creates the style when nothing matches.

export function AddToStyleMenuItems({ generation, file }: { generation: string; file: string }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <PaletteIcon />
        Add to style
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64 p-0">
        <StylePicker generation={generation} file={file} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function StylePicker({ generation, file }: { generation: string; file: string }) {
  const router = useRouter()
  const styles = useStyles()
  const [query, setQuery] = React.useState("")
  const [typing, setTyping] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  const list = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    refreshStyles()
    // After the menu has placed its own focus.
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [])

  const name = query.trim().replace(/\s+/g, " ")
  const needle = name.toLowerCase()
  const all = styles ?? []
  const matches = needle
    ? all
        .filter((s) => s.name.toLowerCase().includes(needle))
        .toSorted(
          (a, b) =>
            Number(b.name.toLowerCase().startsWith(needle)) -
            Number(a.name.toLowerCase().startsWith(needle))
        )
    : all
  const exact = matches.some((s) => s.name.toLowerCase() === needle)
  const top = matches.find((s) => s.name.toLowerCase() === needle)?.id ?? matches[0]?.id ?? null

  async function add(id: string, label: string, before: number) {
    const pending = toast.loading(`Adding to ${label}…`)
    try {
      const style = await addGeneratedImages(id, [{ generation, file }])
      const open = { label: "Open", onClick: () => router.push(`/styles/${id}`) }
      if (style.images.length === before) toast.info(`Already in ${style.name}`, { id: pending, action: open })
      else toast.success(`Added to ${style.name}`, { id: pending, action: open })
    } catch (error) {
      toast.error(`Couldn't add to ${label}: ${(error as Error).message}`, { id: pending })
    }
  }

  async function create() {
    try {
      const style = await createStyle(name)
      await add(style.id, style.name, 0)
    } catch (error) {
      toast.error(`Couldn't create the style: ${(error as Error).message}`)
    }
  }

  // Letters typed while a style is highlighted go to the field instead of the
  // menu's typeahead. Moving focus during keydown makes the browser insert
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
          placeholder="Find or create a style"
          aria-label="Find or create a style"
          maxLength={60}
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div ref={list} className="max-h-72 overflow-y-auto p-1">
        {styles === null && (
          <p className="px-1.5 py-2 text-xs text-muted-foreground">Loading styles…</p>
        )}

        {matches.map((style) => (
          <DropdownMenuItem
            key={style.id}
            data-default={(typing && style.id === top) || undefined}
            onClick={() => add(style.id, style.name, style.count)}
            className="data-default:bg-accent data-default:text-accent-foreground"
          >
            <Thumb url={style.covers[0]} />
            <span className="truncate">{style.name}</span>
            <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">{style.count}</span>
          </DropdownMenuItem>
        ))}

        {name && !exact && (
          <DropdownMenuItem
            data-default={(typing && top === null) || undefined}
            onClick={create}
            className={cn(
              "data-default:bg-accent data-default:text-accent-foreground",
              matches.length > 0 && "mt-1"
            )}
          >
            <PlusIcon className="text-muted-foreground" />
            <span className="min-w-0 truncate">
              New style <span className="font-medium">“{name}”</span>
            </span>
          </DropdownMenuItem>
        )}

        {styles !== null && !name && matches.length === 0 && (
          <p className="px-1.5 py-2 text-xs text-muted-foreground">
            No styles yet. Type a name to start one with this poster.
          </p>
        )}
      </div>
    </div>
  )
}

/** A style's first image, or a palette icon for an empty one. */
export function Thumb({ url, className }: { url?: string; className?: string }) {
  if (!url) {
    return (
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-sm bg-muted text-muted-foreground [&>svg]:size-3.5!",
          className
        )}
      >
        <PaletteIcon />
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sized(url, 160)}
      alt=""
      className={cn("size-6 shrink-0 rounded-sm object-cover ring-1 ring-foreground/10", className)}
    />
  )
}
