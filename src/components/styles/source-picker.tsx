"use client"

import Link from "next/link"
import * as React from "react"
import { BadgeCheckIcon, CheckIcon, ImagesIcon, LoaderCircleIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { addGeneratedImages } from "@/hooks/use-styles"
import { MAX_IMAGES, type Style, type StyleSource } from "@/lib/styles/types"

// Fills a moodboard from the Generation page: every set's extracted posters
// and kept outputs, newest set first. Images already on the board are shown
// but can't be picked twice.

const key = (set: string, file: string) => `${set}/${file}`
const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })

export function SourcePicker({
  open,
  onOpenChange,
  style,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  style: Style
  onAdded: (style: Style) => void
}) {
  const [sources, setSources] = React.useState<StyleSource[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState("")
  const [picked, setPicked] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    let alive = true
    fetch("/api/styles/sources", { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error ?? r.statusText))))
      .then((s: StyleSource[]) => {
        if (!alive) return
        setSources(s)
        setError(null)
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [open])

  const added = React.useMemo(() => new Set(style.images.map((i) => i.from).filter(Boolean)), [style.images])
  const room = Math.max(0, MAX_IMAGES - style.images.length)
  const full = picked.length >= room

  const q = query.trim().toLowerCase()
  const shown = React.useMemo(
    () =>
      (sources ?? []).filter(
        (s) => !q || s.title.toLowerCase().includes(q) || s.folder?.toLowerCase().includes(q)
      ),
    [sources, q]
  )

  function close(next: boolean) {
    if (!next) {
      setPicked([])
      setQuery("")
    }
    onOpenChange(next)
  }

  function toggle(k: string) {
    setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : p.length < room ? [...p, k] : p))
  }

  function toggleSet(source: StyleSource) {
    const keys = source.images.map((i) => key(source.id, i.file)).filter((k) => !added.has(k))
    const all = keys.every((k) => picked.includes(k))
    setPicked((p) =>
      all ? p.filter((k) => !keys.includes(k)) : [...p, ...keys.filter((k) => !p.includes(k))].slice(0, Math.max(room, p.length))
    )
  }

  async function submit() {
    if (!picked.length || busy) return
    setBusy(true)
    try {
      const items = picked.map((k) => {
        const [generation, file] = k.split("/")
        return { generation, file }
      })
      const next = await addGeneratedImages(style.id, items)
      onAdded(next)
      toast.success(`Added ${items.length === 1 ? "1 image" : `${items.length} images`} to ${next.name}`)
      close(false)
    } catch (e) {
      toast.error(`Couldn't add the images: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex h-[min(90svh,56rem)] flex-col gap-3 sm:max-w-[min(94vw,60rem)]">
        <DialogHeader className="pr-8">
          <DialogTitle>Add from Generation</DialogTitle>
          <DialogDescription>
            Extracted posters and kept outputs. Pick the ones that share the look of {style.name}.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sets"
            aria-label="Search sets"
            className="pl-8"
          />
        </div>

        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-1">
          {error ? (
            <p className="py-10 text-center text-sm text-destructive">Couldn&apos;t load the sets: {error}</p>
          ) : sources === null ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-48" />
              <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="aspect-[3/4] rounded-lg" />
                ))}
              </div>
            </div>
          ) : sources.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ImagesIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing generated yet</EmptyTitle>
                <EmptyDescription>
                  Steal a listing on the Generation page; its extracted posters show up here.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/generation" />}>
                  Open Generation
                </Button>
              </EmptyContent>
            </Empty>
          ) : shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No sets match “{query.trim()}”.</p>
          ) : (
            <div className="flex flex-col gap-6">
              {shown.map((source) => {
                const free = source.images.filter((i) => !added.has(key(source.id, i.file)))
                const all = free.length > 0 && free.every((i) => picked.includes(key(source.id, i.file)))
                return (
                  <section key={source.id} className="flex flex-col gap-2" aria-label={source.title}>
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-medium">{source.title}</h3>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {[source.folder, date.format(new Date(source.createdAt))].filter(Boolean).join(" · ")}
                      </span>
                      {free.length > 1 && (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="ml-auto shrink-0"
                          disabled={!all && full}
                          onClick={() => toggleSet(source)}
                        >
                          {all ? "Clear" : "Select all"}
                        </Button>
                      )}
                    </div>
                    <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
                      {source.images.map((image) => {
                        const k = key(source.id, image.file)
                        const isAdded = added.has(k)
                        const selected = picked.includes(k)
                        return (
                          <li key={image.file} className="flex min-w-0 flex-col gap-1">
                            <button
                              type="button"
                              aria-pressed={selected}
                              aria-label={`${image.label}${isAdded ? " (already on the board)" : ""}`}
                              disabled={isAdded || (!selected && full)}
                              onClick={() => toggle(k)}
                              className="group/tile relative aspect-[3/4] overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10 outline-none transition-[box-shadow,transform] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 aria-pressed:ring-2 aria-pressed:ring-brand"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/api/styles/sources/${source.id}/${image.file}?w=320`}
                                alt=""
                                loading="lazy"
                                className="size-full object-cover transition-opacity duration-150 group-disabled/tile:opacity-40"
                              />
                              {selected && (
                                <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-brand text-white shadow-sm starting:scale-50 starting:opacity-0 transition-[scale,opacity] duration-150 ease-out-strong">
                                  <CheckIcon className="size-3" strokeWidth={3} />
                                </span>
                              )}
                              {isAdded && (
                                <span className="absolute inset-x-1.5 bottom-1.5 rounded-md bg-background/90 py-0.5 text-center text-[11px] font-medium">
                                  On the board
                                </span>
                              )}
                            </button>
                            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                              <span className="truncate">{image.label}</span>
                              {image.approved && (
                                <BadgeCheckIcon className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Approved" />
                              )}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter className="items-center">
          <span className="mr-auto text-xs text-muted-foreground tabular-nums">
            {room === 0
              ? `The board is full (${MAX_IMAGES} images).`
              : picked.length
                ? `${picked.length} picked · room for ${room - picked.length} more`
                : `Room for ${room} more`}
          </span>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!picked.length || busy}>
            {busy && <LoaderCircleIcon className="animate-spin" />}
            {picked.length > 1 ? `Add ${picked.length} images` : "Add image"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
