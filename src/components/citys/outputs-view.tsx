"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ExternalLinkIcon,
  ImagesIcon,
  LoaderCircleIcon,
  PaletteIcon,
  RotateCcwIcon,
  ScanSearchIcon,
  SearchIcon,
  SparklesIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { TierBadge } from "@/components/citys/tier"
import { SelectionBar } from "@/components/selection"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { redoCityOutput, reviewCityOutputs, useCityOutputs } from "@/hooks/use-city-outputs"
import type { CityOutput } from "@/lib/citys/outputs"
import { formatNumber } from "@/lib/etsy/format"
import { cn } from "@/lib/utils"

// Every city poster made, to look through and decide on: grouped by style
// (real photos by sky, the reference's own style, new ideas, sets, each
// city style and each production) or by place, newest first. A
// tile approves or rejects on hover; opened, it sits next to the reference
// it came from, and A, R and the arrow keys go through them without the
// mouse. Approved posters are what the city uploads take.

type Status = "review" | "approved" | "rejected" | "all"
type Group = "style" | "place"

const key = (o: Pick<CityOutput, "setId" | "outputId">) => `${o.setId}/${o.outputId}`

export function OutputsView() {
  const outputs = useCityOutputs()
  const params = useSearchParams()
  // ?group=production:<id> (from a style's productions) opens on that production, place by place.
  const asked = params.get("group")
  const [status, setStatus] = React.useState<Status>(asked || params.get("style") ? "all" : "review")
  const [group, setGroup] = React.useState<Group>(asked?.startsWith("production:") ? "place" : "style")
  const [search, setSearch] = React.useState("")
  const [only, setOnly] = React.useState<string | null>(asked)
  // ?style=<id> (from a style's page): everything in that style, its productions included.
  const [styleOnly, setStyleOnly] = React.useState<string | null>(params.get("style"))
  // Select mode: posters picked to start a style of their own from.
  const [selecting, setSelecting] = React.useState(false)
  const [chosen, setChosen] = React.useState<Set<string>>(new Set())
  const [naming, setNaming] = React.useState(false)
  const toggleChosen = (o: CityOutput) =>
    setChosen((set) => {
      const next = new Set(set)
      if (next.has(key(o))) next.delete(key(o))
      else next.add(key(o))
      return next
    })
  const [open, setOpen] = React.useState<string | null>(null)

  const counts = React.useMemo(() => {
    const c = { review: 0, approved: 0, rejected: 0, all: 0, painting: 0 }
    for (const o of outputs ?? []) {
      c.all++
      if (o.status === "pending" || o.status === "running") c.painting++
      else if (o.review === "approved") c.approved++
      else if (o.review === "rejected") c.rejected++
      else if (o.status === "done") c.review++
    }
    return c
  }, [outputs])

  const shown = React.useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return (outputs ?? []).filter((o) => {
      if (status === "review" && (o.review || o.status === "error")) return false
      if (status === "approved" && o.review !== "approved") return false
      if (status === "rejected" && o.review !== "rejected") return false
      if (only && o.group !== only) return false
      if (styleOnly && o.styleId !== styleOnly) return false
      if (words.length && !words.every((w) => `${o.place} ${o.groupLabel} ${o.detail}`.toLowerCase().includes(w))) return false
      return true
    })
  }, [outputs, status, only, styleOnly, search])

  const groups = React.useMemo(() => {
    const map = new Map<string, { id: string; label: string; items: CityOutput[] }>()
    for (const o of shown) {
      const id = group === "style" ? o.group : o.placeId
      const entry = map.get(id) ?? { id, label: group === "style" ? o.groupLabel : o.place, items: [] }
      entry.items.push(o)
      map.set(id, entry)
    }
    return [...map.values()]
  }, [shown, group])

  const styleGroups = React.useMemo(() => {
    const map = new Map<string, { id: string; label: string; count: number }>()
    for (const o of outputs ?? []) {
      const entry = map.get(o.group) ?? { id: o.group, label: o.groupLabel, count: 0 }
      entry.count++
      map.set(o.group, entry)
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [outputs])

  const order = groups.flatMap((g) => g.items)
  const openIndex = open ? order.findIndex((o) => key(o) === open) : -1
  const opened = openIndex >= 0 ? order[openIndex] : null

  async function review(items: CityOutput[], value: CityOutput["review"]) {
    try {
      await reviewCityOutputs(items.map((o) => ({ setId: o.setId, outputId: o.outputId })), value)
    } catch (error) {
      toast.error(`Couldn't save it: ${(error as Error).message}`)
    }
  }

  if (!outputs) {
    return (
      <div className="flex flex-col gap-3 px-4 lg:px-6">
        <Skeleton className="h-8 w-[30rem] max-w-full rounded-lg" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-4">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="aspect-[3/4] rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (outputs.length === 0) {
    return (
      <div className="px-4 lg:px-6">
        <Empty className="min-h-[60svh] border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ImagesIcon />
            </EmptyMedia>
            <EmptyTitle>No city posters yet</EmptyTitle>
            <EmptyDescription>Pick reference photos in the Stealer and generate: real photo variants, looks and styled posters land here to review.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link href="/citys/stealer" />}>
              <ScanSearchIcon />
              Open the Stealer
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border p-0.5" role="group" aria-label="Status">
          {(
            [
              ["review", "To review", counts.review],
              ["approved", "Approved", counts.approved],
              ["rejected", "Rejected", counts.rejected],
              ["all", "All", counts.all],
            ] as const
          ).map(([value, label, count]) => (
            <Segment key={value} on={status === value} onClick={() => setStatus(value)}>
              {label}
              <span className={cn("tabular-nums", status === value ? "text-background/70" : "text-muted-foreground")}>{formatNumber(count)}</span>
            </Segment>
          ))}
        </div>
        <div className="flex rounded-lg border p-0.5" role="group" aria-label="Group by">
          <Segment on={group === "style"} onClick={() => setGroup("style")}>
            By style
          </Segment>
          <Segment on={group === "place"} onClick={() => setGroup("place")}>
            By place
          </Segment>
        </div>
        <InputGroup className="w-56">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Place or style" aria-label="Search posters" autoComplete="off" />
          {search && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Clear" onClick={() => setSearch("")}>
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        <Button
          variant={selecting ? "default" : "outline"}
          size="sm"
          aria-pressed={selecting}
          onClick={() => {
            setSelecting((on) => !on)
            setChosen(new Set())
          }}
          title="Pick posters to start a style of your own from"
        >
          <PaletteIcon />
          {selecting ? "Done selecting" : "Select for a style"}
        </Button>
        {counts.painting > 0 && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
            <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
            {formatNumber(counts.painting)} being painted
          </span>
        )}
      </div>
      {styleGroups.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {styleOnly && (
            <GroupChip on onClick={() => setStyleOnly(null)}>
              In {outputs.find((o) => o.styleId === styleOnly)?.groupLabel.split(" · ")[0] ?? "this style"}
              <XIcon className="size-3" />
            </GroupChip>
          )}
          <GroupChip on={!only} onClick={() => setOnly(null)}>
            Everything
          </GroupChip>
          {styleGroups.map((g) => (
            <GroupChip key={g.id} on={only === g.id} onClick={() => setOnly(only === g.id ? null : g.id)}>
              {g.label}
              <span className="text-muted-foreground tabular-nums">{g.count}</span>
            </GroupChip>
          ))}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="flex min-h-40 flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm font-medium">{status === "review" ? "Nothing left to review" : "Nothing here"}</p>
          {status === "review" && counts.painting > 0 && <p className="text-xs text-muted-foreground">{formatNumber(counts.painting)} still being painted.</p>}
        </div>
      ) : (
        groups.map((g) => {
          const ready = g.items.filter((o) => o.status === "done" && !o.review)
          return (
            <section key={g.id} className="flex flex-col gap-2" aria-label={g.label}>
              <header className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">{g.label}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">{formatNumber(g.items.length)}</span>
                {ready.length > 1 && (
                  <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" onClick={() => review(ready, "approved")}>
                    <CheckIcon />
                    Approve {ready.length}
                  </Button>
                )}
              </header>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-4 gap-y-4">
                {g.items.map((o) => (
                  <li key={key(o)}>
                    <OutputTile
                      item={o}
                      showPlace={group === "style"}
                      selecting={selecting}
                      selected={chosen.has(key(o))}
                      onOpen={() => (selecting ? toggleChosen(o) : setOpen(key(o)))}
                      onReview={(v) => review([o], v)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )
        })
      )}

      <SelectionBar count={chosen.size} total={order.filter((o) => o.file).length} onSelectAll={() => setChosen(new Set(order.filter((o) => o.file).map(key)))} onClear={() => setChosen(new Set())}>
        <Button size="sm" onClick={() => setNaming(true)} className="active:scale-[0.97]">
          <PaletteIcon />
          New style from {chosen.size}
        </Button>
      </SelectionBar>
      <NewStyleDialog
        open={naming}
        onOpenChange={setNaming}
        items={(outputs ?? []).filter((o) => chosen.has(key(o)) && o.file)}
        onDone={() => {
          setSelecting(false)
          setChosen(new Set())
        }}
      />

      <Viewer
        item={opened}
        index={openIndex}
        total={order.length}
        onClose={() => setOpen(null)}
        onMove={(step) => {
          const next = order[openIndex + step]
          if (next) setOpen(key(next))
        }}
        onReview={async (v) => {
          if (!opened) return
          await review([opened], v)
          const next = order[openIndex + 1]
          if (next) setOpen(key(next))
        }}
      />
    </div>
  )
}

function Segment({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
        on ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

function GroupChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs outline-none transition-[border-color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
        on ? "border-brand/60 bg-brand/10" : "border-border text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

function OutputTile({
  item,
  showPlace,
  selecting,
  selected,
  onOpen,
  onReview,
}: {
  item: CityOutput
  showPlace: boolean
  /** Select mode: a click picks the poster instead of opening it. */
  selecting?: boolean
  selected?: boolean
  onOpen: () => void
  onReview: (review: CityOutput["review"]) => void
}) {
  const painting = item.status === "pending" || item.status === "running"
  return (
    <div className="group/tile flex min-w-0 flex-col gap-1.5">
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          disabled={painting || (selecting && !item.file)}
          aria-pressed={selecting ? !!selected : undefined}
          className={cn(
            "relative block aspect-[3/4] w-full overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            item.review === "approved" && "ring-2 ring-emerald-500/70",
            item.review === "rejected" && "opacity-50",
            selected && "ring-3 ring-brand"
          )}
          aria-label={`${item.place} · ${item.groupLabel} · ${item.detail}`}
        >
          {item.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.thumb} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
          ) : painting ? (
            <span className="absolute inset-0 overflow-hidden">
              <span className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-foreground/5 to-transparent motion-reduce:animate-none" />
              <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">Painting…</span>
            </span>
          ) : (
            <span className="absolute inset-0 grid place-items-center p-3 text-center text-xs text-destructive">
              <span className="flex flex-col items-center gap-1">
                <TriangleAlertIcon className="size-4" />
                {item.error ?? "Failed"}
              </span>
            </span>
          )}
        </button>
        {selecting && item.file && (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute top-2 left-2 grid size-5 place-items-center rounded-md border-2 transition-colors duration-150",
              selected ? "border-brand bg-brand text-white" : "border-white/80 bg-black/20"
            )}
          >
            {selected && <CheckIcon className="size-3.5" />}
          </span>
        )}
        {item.status === "done" && !selecting && (
          <div className="absolute right-2 bottom-2 flex gap-1 opacity-0 transition-opacity duration-150 group-hover/tile:opacity-100 focus-within:opacity-100">
            <ReviewButton label="Reject" on={item.review === "rejected"} onClick={() => onReview(item.review === "rejected" ? null : "rejected")} tone="reject" />
            <ReviewButton label="Approve" on={item.review === "approved"} onClick={() => onReview(item.review === "approved" ? null : "approved")} tone="approve" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 items-baseline justify-between gap-2 px-0.5 text-[11px]">
        <span className="max-w-[60%] shrink-0 truncate font-medium">{showPlace ? item.place : item.groupLabel}</span>
        <span className="min-w-0 truncate text-right text-muted-foreground" title={item.detail}>
          {item.detail}
        </span>
      </div>
    </div>
  )
}

function ReviewButton({ label, on, onClick, tone }: { label: string; on: boolean; onClick: () => void; tone: "approve" | "reject" }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-full border bg-background/90 shadow-sm backdrop-blur-sm outline-none transition-[transform,background-color,color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.92]",
        on && tone === "approve" && "border-emerald-600 bg-emerald-600 text-white",
        on && tone === "reject" && "border-destructive bg-destructive text-white"
      )}
    >
      {tone === "approve" ? <CheckIcon className="size-3.5" /> : <XIcon className="size-3.5" />}
    </button>
  )
}

function Viewer({
  item,
  index,
  total,
  onClose,
  onMove,
  onReview,
}: {
  item: CityOutput | null
  index: number
  total: number
  onClose: () => void
  onMove: (step: number) => void
  onReview: (review: CityOutput["review"]) => void
}) {
  const [notes, setNotes] = React.useState("")
  const [redoing, setRedoing] = React.useState(false)
  // Another poster: its own notes.
  const [notesFor, setNotesFor] = React.useState(item?.outputId)
  if (notesFor !== item?.outputId) {
    setNotesFor(item?.outputId)
    setNotes("")
  }

  React.useEffect(() => {
    if (!item) return
    function onKey(event: KeyboardEvent) {
      if ((event.target as HTMLElement).closest("textarea, input")) return
      if (event.key === "ArrowRight") onMove(1)
      else if (event.key === "ArrowLeft") onMove(-1)
      else if (event.key === "a" || event.key === "A") onReview("approved")
      else if (event.key === "r" || event.key === "R") onReview("rejected")
      else return
      event.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [item, onMove, onReview])

  async function redo() {
    if (!item) return
    setRedoing(true)
    try {
      await redoCityOutput(item.setId, item.outputId, notes)
      toast.success("One more on its way")
      setNotes("")
    } catch (error) {
      toast.error(`Couldn't start it: ${(error as Error).message}`)
    } finally {
      setRedoing(false)
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="grid h-[min(54rem,calc(100svh-2rem))] grid-rows-1 gap-0 overflow-hidden p-0 sm:max-w-[min(80rem,calc(100%-2rem))]">
        {item && (
          <div className="grid min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="relative grid min-h-0 grid-cols-2 gap-4 bg-muted/40 p-6">
              <figure className="flex min-h-0 flex-col gap-2">
                <figcaption className="text-xs font-medium">Ours</figcaption>
                <div className="relative min-h-0 flex-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {item.url && <img src={item.url} alt={item.title ?? item.place} className="absolute inset-0 m-auto max-h-full max-w-full rounded-md object-contain shadow-sm" />}
                </div>
              </figure>
              <figure className="flex min-h-0 flex-col gap-2">
                <figcaption className="text-xs text-muted-foreground">Reference{item.reference?.shop && ` · ${item.reference.shop}`}</figcaption>
                <div className="relative min-h-0 flex-1">
                  {item.reference?.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.reference.image} alt="" className="absolute inset-0 m-auto max-h-full max-w-full rounded-md object-contain opacity-95" />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">From the city&apos;s name alone</span>
                  )}
                </div>
              </figure>
            </div>
            <div className="flex min-h-0 flex-col border-l">
              <div className="flex flex-col gap-1 border-b px-4 pt-4 pb-3">
                <div className="flex items-center gap-2">
                  {item.tier && <TierBadge tier={item.tier} />}
                  <DialogTitle className="truncate text-base">{item.place}</DialogTitle>
                </div>
                <DialogDescription className="text-xs">
                  {item.groupLabel} · {item.detail}
                </DialogDescription>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm">
                {item.title && <p className="font-medium">{item.title}</p>}
                {item.brief && <p className="mt-1 text-xs leading-relaxed text-pretty text-muted-foreground">{item.brief}</p>}
                <div className="mt-4 flex flex-col gap-2">
                  <label className="text-xs font-medium" htmlFor="redo-notes">
                    One more like it
                  </label>
                  <Textarea id="redo-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What should be different, e.g. warmer sky, keep the bridge" className="min-h-16 text-sm" />
                  <Button variant="outline" size="sm" onClick={redo} disabled={redoing} className="self-start">
                    {redoing ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
                    Make one more
                  </Button>
                </div>
                {item.reference && (
                  <a href={item.reference.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline">
                    The reference listing
                    <ExternalLinkIcon className="size-3" />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-1.5 border-t px-4 py-3">
                <Button variant="ghost" size="icon-sm" onClick={() => onMove(-1)} disabled={index <= 0} aria-label="Previous">
                  <ArrowLeftIcon />
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {index + 1} / {total}
                </span>
                <Button variant="ghost" size="icon-sm" onClick={() => onMove(1)} disabled={index >= total - 1} aria-label="Next">
                  <ArrowRightIcon />
                </Button>
                <div className="ml-auto flex gap-1.5">
                  {item.review ? (
                    <Button variant="ghost" size="sm" onClick={() => onReview(null)}>
                      <RotateCcwIcon />
                      Undo
                    </Button>
                  ) : null}
                  <Button variant="outline" size="sm" onClick={() => onReview("rejected")} className={cn(item.review === "rejected" && "border-destructive text-destructive")}>
                    <XIcon />
                    Reject <Kbd>R</Kbd>
                  </Button>
                  <Button size="sm" onClick={() => onReview("approved")} className={cn(item.review === "approved" && "bg-emerald-600 hover:bg-emerald-600/90")}>
                    <CheckIcon />
                    Approve <Kbd className="bg-background/20 text-current">A</Kbd>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Starts a city style of its own from picked posters: they become its board, read a moment later. */
function NewStyleDialog({ open, onOpenChange, items, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; items: CityOutput[]; onDone: () => void }) {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  async function create() {
    if (!name.trim() || !items.length) return
    setBusy(true)
    try {
      const made = await fetch("/api/citys/styles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) })
      const style = await made.json()
      if (!made.ok) throw new Error(style.error ?? made.statusText)
      const added = await fetch(`/api/styles/${style.id}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: items.slice(0, 20).map((o) => ({ generation: o.setId, file: o.file })) }),
      })
      if (!added.ok) throw new Error((await added.json().catch(() => ({}))).error ?? added.statusText)
      toast.success(`“${name.trim()}” is a new style`, { description: "Its board is read a moment later; then the lab can paint." })
      onOpenChange(false)
      onDone()
      router.push(`/citys/styles/${style.id}`)
    } catch (error) {
      toast.error(`Couldn't make the style: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle>New style from {items.length} {items.length === 1 ? "poster" : "posters"}</DialogTitle>
        <DialogDescription>They become the style&apos;s board{items.length > 20 ? " (the first 20)" : ""}; it&apos;s read a moment later and opens in the lab.</DialogDescription>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Style name, e.g. Pastel sketch" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <LoaderCircleIcon className="animate-spin" /> : <PaletteIcon />}
              Make the style
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
