"use client"

import { useRouter } from "next/navigation"
import * as React from "react"
import { LoaderCircleIcon, PaletteIcon } from "lucide-react"
import { toast } from "sonner"

import { ImagePicker, ThumbStack, type ImagePick } from "@/components/generation/image-picker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createCityStyle } from "@/hooks/use-city-style"
import { useSaved } from "@/hooks/use-saved"
import { hasPrimaryTag, useShopHistory } from "@/hooks/use-shop-history"
import { addSavedListings, createStyle } from "@/hooks/use-styles"
import { describeFolder, folderName, isWithin } from "@/lib/saved/folders"
import { MAX_IMAGES, type Style } from "@/lib/styles/types"
import { cn } from "@/lib/utils"

// A style from the posters of a Saved folder, or more of them for a style's
// board. The server takes each poster out of its listing photo (the photo
// shows it framed in a room) and puts it on the moodboard; Gemini reads the
// board once they're all there. A new style is named after the folder until
// it's renamed here.

/** Board images that came from a saved listing: `listing/<listingId>/<n>`. */
const LISTING = /^listing\/(\d+)\//

export function StyleFromSavedDialog({
  open,
  onOpenChange,
  folder,
  picked,
  style,
  navigate = false,
  onDone,
  kind,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The folder to take them from; without one it's picked here. */
  folder?: string
  /** Listings picked to start; otherwise all of the folder. */
  picked?: number[]
  /** Adds to this style's board instead of making a new style. */
  style?: Style
  /** Opens the new style once it's made, rather than offering to. */
  navigate?: boolean
  /** With the new style, or the one added to. */
  onDone?: (style: Style) => void
  /** A city style or a normal one; picked here (city when the posters' shops are city shops) when not given. */
  kind?: "city" | "normal"
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-xl">
        {open && (
          <Form
            fixed={folder}
            initial={picked}
            target={style}
            navigate={navigate}
            kind={kind}
            onDone={(next) => {
              onOpenChange(false)
              onDone?.(next)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Form({
  fixed,
  initial,
  target,
  navigate,
  onDone,
  kind: fixedKind,
}: {
  fixed?: string
  initial?: number[]
  target?: Style
  navigate: boolean
  onDone: (style: Style) => void
  kind?: "city" | "normal"
}) {
  const router = useRouter()
  const saved = useSaved()
  const history = useShopHistory()
  const [chosenKind, setKind] = React.useState<"city" | "normal" | null>(null)
  const [folder, setFolder] = React.useState<string | null>(null)
  // Null while untouched: the folder's name, and all of it (or the listings it opened with).
  const [name, setName] = React.useState<string | null>(null)
  const [picked, setPicked] = React.useState<Set<string> | null>(null)
  const [busy, setBusy] = React.useState(false)

  // Each folder once, by its newest spelling; the one saved to last comes first.
  const folders = React.useMemo(() => {
    const byKey = new Map<string, { name: string; count: number }>()
    for (const { folder: f } of saved ?? []) {
      const entry = byKey.get(f.toLowerCase()) ?? { name: f, count: 0 }
      byKey.set(f.toLowerCase(), { ...entry, count: entry.count + 1 })
    }
    return [...byKey.values()]
  }, [saved])
  const current = fixed ?? folder ?? folders[0]?.name ?? null

  const onBoard = React.useMemo(
    () => new Set(target?.images.flatMap((i) => i.from?.match(LISTING)?.[1] ?? [])),
    [target]
  )
  const listings = React.useMemo(
    () =>
      (saved ?? []).filter(
        // A folder's posters, and those of the folders inside it.
        (s) => current !== null && isWithin(s.folder, current) && s.image
      ),
    [saved, current]
  )
  const items = React.useMemo<ImagePick[]>(
    () =>
      listings
        .filter((l) => !onBoard.has(String(l.listingId)))
        .map((l) => ({ id: String(l.listingId), src: l.thumb || l.image, title: l.title })),
    [listings, onBoard]
  )

  const max = target ? Math.max(0, MAX_IMAGES - target.images.length - (target.incoming ?? 0)) : MAX_IMAGES
  const defaults = React.useMemo(() => {
    const start = initial?.length ? items.filter((i) => initial.includes(Number(i.id))) : items
    return new Set(start.slice(0, max).map((i) => i.id))
  }, [items, initial, max])
  const selected = picked ?? defaults
  const chosen = items.filter((i) => selected.has(i.id))
  // City mode first when most of the posters come from shops tagged "citys".
  const cityShops = React.useMemo(
    () => new Set(Object.values(history).filter((v) => hasPrimaryTag(v, "citys")).map((v) => v.shop.name.toLowerCase())),
    [history]
  )
  const fromCityShops = listings.filter((l) => l.shop && cityShops.has(l.shop.toLowerCase())).length
  const kind = fixedKind ?? chosenKind ?? (listings.length && fromCityShops * 2 >= listings.length ? "city" : "normal")
  const styleName = name ?? (current ? folderName(current) : "")
  const ready = chosen.length > 0 && (target !== undefined || styleName.trim() !== "")

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    const byId = new Map(listings.map((l) => [String(l.listingId), l]))
    const picks = chosen.flatMap((i) => byId.get(i.id) ?? [])
    const posters = picks.length === 1 ? "1 poster" : `${picks.length} posters`
    try {
      const style = target ?? (kind === "city" ? await createCityStyle(styleName) : await createStyle(styleName))
      const page = kind === "city" && !target ? `/citys/styles/${style.id}` : `/styles/${style.id}`
      const next = await addSavedListings(
        style.id,
        picks.map(({ listingId, title, image }) => ({ listingId, title, image }))
      )
      if (target) {
        toast.success(`Adding ${posters} to ${next.name}`, {
          description: "Each is taken out of its photo, then Gemini reads the board again.",
        })
      } else {
        toast.success(`Generating ${next.name}`, {
          description: `${posters} taken out of their photos, then Gemini reads the board.`,
          ...(!navigate && {
            action: { label: "Open", onClick: () => router.push(page) },
          }),
        })
        if (navigate) router.push(page)
      }
      onDone(next)
    } catch (error) {
      toast.error(`Couldn't ${target ? "add the posters" : "create the style"}: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const pickFolder = !fixed && folders.length > 0
  let hint: string
  if (target && max === 0) hint = `The board is full (${MAX_IMAGES} images)`
  else if (chosen.length === 0) hint = "Pick at least one poster"
  else if (!target && !styleName.trim()) hint = "Name the style"
  else if (!target && chosen.length < 3) hint = "3 or more posters read best"
  else hint = "Each poster is taken out of its photo first"

  return (
    <form onSubmit={submit} className="flex max-h-[min(88svh,52rem)] min-w-0 flex-col">
      <DialogHeader className="flex-row items-center gap-3 border-b p-4 pr-12">
        {chosen.length > 0 ? (
          <ThumbStack thumbs={chosen.slice(0, 3).map((i) => i.src)} />
        ) : (
          <span className="grid h-11 w-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
            <PaletteIcon />
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <DialogTitle className="truncate">{target ? `Add to ${target.name}` : "Generate style"}</DialogTitle>
          <DialogDescription className="truncate">
            {fixed ? `Saved posters in ${fixed} that share the look` : "Saved posters that share the look"}
          </DialogDescription>
        </div>
      </DialogHeader>

      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-4">
        {(pickFolder || !target) && (
          <div className="flex flex-col gap-3 sm:flex-row">
            {pickFolder && (
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Folder</span>
                <Select
                  value={current}
                  onValueChange={(next) => {
                    if (!next || next === current) return
                    setFolder(next)
                    setPicked(null)
                  }}
                  items={folders.map((f) => ({ value: f.name, label: describeFolder(f.name) }))}
                >
                  <SelectTrigger className="w-full" aria-label="Folder">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {folders.map((f) => (
                        <SelectItem key={f.name} value={f.name}>
                          <span className="truncate">{describeFolder(f.name)}</span>
                          <span className="ml-auto text-xs text-muted-foreground tabular-nums">{f.count}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            )}
            {!target && !fixedKind && (
              <div className="flex shrink-0 flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Kind</span>
                <div className="flex h-9 rounded-lg border p-0.5" role="radiogroup" aria-label="Kind of style">
                  {(["normal", "city"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={kind === k}
                      onClick={() => setKind(k)}
                      title={k === "city" ? "Read for how it shows a place too, and tried in the city lab" : "A style for any poster"}
                      className={cn(
                        "rounded-md px-3 text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
                        kind === k ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {k === "city" ? "City" : "Normal"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!target && (
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <label htmlFor="saved-style-name" className="text-xs font-medium text-muted-foreground">
                  Name
                </label>
                <Input
                  id="saved-style-name"
                  autoFocus
                  value={styleName}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Retro Gouache Kitchen"
                  maxLength={60}
                />
              </div>
            )}
          </div>
        )}

        {saved === null ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" />
            Loading saved posters…
          </p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-pretty text-muted-foreground">
            {folders.length === 0
              ? "Nothing saved yet. In a shop's Listings, select posters and right-click to save them."
              : listings.length > 0
                ? `Every poster in ${describeFolder(current ?? "")} is on the board already.`
                : `Nothing in ${describeFolder(current ?? "")} yet.`}
          </p>
        ) : (
          <ImagePicker label="Posters" items={items} picked={selected} max={max} onChange={setPicked} />
        )}
      </div>

      <DialogFooter className="m-0 flex-row items-center gap-2 rounded-b-xl border-t bg-muted/40 p-3 sm:justify-between">
        <p className="text-xs text-muted-foreground tabular-nums">{hint}</p>
        <Button type="submit" disabled={!ready || busy} className="active:scale-[0.97]">
          {busy ? <LoaderCircleIcon className="animate-spin" /> : <PaletteIcon />}
          {target ? "Add" : "Generate with"} {chosen.length} {chosen.length === 1 ? "poster" : "posters"}
        </Button>
      </DialogFooter>
    </form>
  )
}
