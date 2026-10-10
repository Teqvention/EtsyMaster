"use client"

import { useRouter } from "next/navigation"
import * as React from "react"
import { CheckIcon, ChevronDownIcon, FolderIcon, LoaderCircleIcon, ScanSearchIcon } from "lucide-react"
import { toast } from "sonner"

import { DeliveryField, useDelivery } from "@/components/generation/generate-dialog"
import { CategoryPicker } from "@/components/mockups/category-picker"
import { SelectMark } from "@/components/selection"
import { ChoiceCard, LAST_MOCKUP_CATEGORY, Thumb } from "@/components/steal/steal-mockups-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { RadioGroup } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { generate, retryGeneration, useGenerations } from "@/hooks/use-generations"
import type { Listing } from "@/lib/etsy/types"
import { DEFAULT_OPTIONS, type GenerationSet, type GenerationSource } from "@/lib/generation/types"
import type { ScannedPhoto, ScanProgress } from "@/lib/mockups/scan"
import type { SavedListing } from "@/lib/saved/types"
import { cn } from "@/lib/utils"

// Listings' photos into blank mockup scenes: each listing's main photo,
// every photo it has, or a hand-picked few. First every photo is looked at:
// a shop shoots one room with every poster, so by default each room is
// offered once, and photos that aren't room mockups (size charts,
// close-ups) or show a room stolen already are left out. A photo that's a
// mockup already (or becoming one) isn't offered again; one that failed runs
// its set again. They land in a mockup category, painted now or in a batch job.

/** A listing whose photos can become mockups: saved, or in a shop's analysis. */
export type MockupListing = {
  listingId: number
  title: string
  url: string
  shop: string | null
  tags?: string[]
  /** Full size, the main one first. */
  photos: string[]
}

export const fromSaved = (l: SavedListing): MockupListing => ({
  listingId: l.listingId,
  title: l.title,
  url: l.url,
  shop: l.shop,
  tags: l.tags,
  // Listings saved before their photos were kept have only the main one.
  photos: l.photos?.length ? l.photos : [l.image],
})

export const fromListing = (l: Listing): MockupListing => ({
  listingId: l.id,
  title: l.title,
  url: l.url,
  shop: l.shop?.name ?? null,
  tags: l.tags,
  photos: l.images.map((i) => i.full),
})

/** A listing's photo not made into a mockup yet; `again`, its failed set to run again. */
export type MockupPhoto = { listing: MockupListing; index: number; url: string; again?: GenerationSet }

/** The photos of `listings` still to make into mockups (listings with none left drop out), and how many are made. */
export function mockupPhotos(listings: MockupListing[], sets: GenerationSet[] | null) {
  // Every mockup set of a photo, newest first.
  const byPhoto = Map.groupBy(
    (sets ?? []).filter((s) => s.kind === "mockup"),
    (s) => `${s.source.listingId} ${s.source.image}`
  )
  let made = 0
  const left = listings.flatMap((listing) => {
    const photos = listing.photos.flatMap((url, index): MockupPhoto[] => {
      const tried = byPhoto.get(`${listing.listingId} ${url}`) ?? []
      if (tried.some((s) => s.status !== "error")) {
        made++
        return []
      }
      return [{ listing, index, url, again: tried[0] }]
    })
    return photos.length ? [{ listing, photos }] : []
  })
  return { left, made }
}

type Choice = "main" | "all" | "pick"

/** Listings shown at once when picking by hand. */
const PAGE = 30

const keyOf = (p: MockupPhoto) => `${p.listing.listingId}:${p.index}`

/** Etsy serves every photo smaller under the same name. */
const small = (url: string) => url.replace("/il_fullxfull.", "/il_340x270.")

export function MockupDialog({
  open,
  onOpenChange,
  listings,
  title = "Generate mockups",
  description,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What it runs on, best first: the first photo of a room stands for it. */
  listings: MockupListing[]
  title?: string
  description: string
  /** Once it's started. */
  onDone?: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Anchored from the top, so picking photos grows it downwards only.
        className="top-[max(1rem,10svh)] translate-y-0 gap-0 p-0 sm:max-w-xl"
      >
        {open && (
          <Form
            listings={listings}
            title={title}
            description={description}
            onStarted={() => {
              onDone?.()
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Form({
  listings,
  title,
  description,
  onStarted,
}: {
  listings: MockupListing[]
  title: string
  description: string
  onStarted: () => void
}) {
  const router = useRouter()
  const sets = useGenerations()
  const { left, made } = React.useMemo(() => mockupPhotos(listings, sets), [listings, sets])
  const every = left.flatMap((l) => l.photos)
  const scan = useScan(every, sets)
  const [unique, setUnique] = React.useState(true)

  // With the scan on, each room once (its first photo), mockups not stolen yet.
  const rooms = unique && scan.photos ? scan.photos : null
  const keep = (photos: MockupPhoto[]) => {
    if (!rooms) return photos
    const seen = new Set<string>()
    return photos.filter((p) => {
      const found = rooms.get(p.url)
      if (!found) return true
      if (!found.mockup || found.stolen || seen.has(found.room)) return false
      seen.add(found.room)
      return true
    })
  }
  const all = keep(every)
  const main = keep(every.filter((p) => p.index === 0))
  // How often each room comes up, for the picker.
  const shots = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const found of scan.photos?.values() ?? []) counts.set(found.room, (counts.get(found.room) ?? 0) + 1)
    return counts
  }, [scan.photos])

  const [choice, setChoice] = React.useState<Choice>("all")
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(() => new Set())
  const [chosenCategory, setCategory] = React.useState<string | null>(null)
  const [last] = React.useState(() =>
    typeof window === "undefined" ? null : localStorage.getItem(LAST_MOCKUP_CATEGORY)
  )
  const [delivery, setDelivery] = useDelivery()
  const [busy, setBusy] = React.useState(false)
  // A whole shop is thousands of photos: picking shows a page of listings at a time.
  const [pages, setPages] = React.useState(1)
  const category = chosenCategory ?? last
  const waiting = unique && !scan.photos && !scan.error

  const chosen = choice === "main" ? main : choice === "all" ? all : all.filter((p) => picked.has(keyOf(p)))
  const count = waiting ? 0 : chosen.length
  const again = chosen.filter((p) => p.again).length

  function choose(next: Choice) {
    // Choosing by hand starts from what was chosen.
    if (next === "pick" && choice !== "pick") setPicked(new Set(chosen.map(keyOf)))
    setChoice(next)
  }

  function toggle(photos: MockupPhoto[]) {
    setPicked((current) => {
      const next = new Set(current)
      // A listing's photos all go on, unless they all are.
      const on = photos.every((p) => next.has(keyOf(p)))
      for (const p of photos) {
        if (on) next.delete(keyOf(p))
        else next.add(keyOf(p))
      }
      return next
    })
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!category || !count || busy) return
    const fresh = chosen.filter((p) => !p.again)
    setBusy(true)
    try {
      await Promise.all([
        fresh.length
          ? generate("mockup", category, fresh.map(sourceOf), delivery === "batch" ? { ...DEFAULT_OPTIONS, delivery } : undefined)
          : null,
        // A failed one runs again where it was going.
        ...chosen.flatMap((p) => (p.again ? [retryGeneration(p.again.id, delivery)] : [])),
      ])
      localStorage.setItem(LAST_MOCKUP_CATEGORY, category)
      onStarted()
      toast.success(`Generating ${count} ${count === 1 ? "mockup" : "mockups"}`, {
        description:
          delivery === "batch"
            ? `In a batch job, into the ${category} category: back in minutes to a few hours.`
            : `Each photo becomes a blank mockup in the ${category} category.`,
        action: {
          label: "View",
          onClick: () => router.push(`/generation?kind=mockup&folder=${encodeURIComponent(category)}`),
        },
      })
    } catch (error) {
      toast.error(`Couldn't start: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  // The listing with the most photos left shows what "all" adds.
  const fullest = left.reduce<MockupPhoto[]>((best, l) => {
    const kept = keep(l.photos)
    return kept.length > best.length ? kept : best
  }, [])
  const offered = new Set(all)
  const listed = left.flatMap(({ listing, photos }) => {
    const kept = photos.filter((p) => offered.has(p))
    return kept.length ? [{ listing, photos: kept }] : []
  })
  const shown = listed.slice(0, pages * PAGE)
  const note = [
    made > 0 && `${made} already ${made === 1 ? "a mockup" : "mockups"}`,
    again > 0 && `${again} failed before, run again`,
  ].filter(Boolean)

  return (
    // min-w-0: the truncated description must not size the dialog's grid column.
    <form onSubmit={submit} className="flex max-h-[min(88svh,48rem)] min-w-0 flex-col">
      <DialogHeader className="gap-1 p-5 pr-12 pb-4">
        <DialogTitle className="text-base">{title}</DialogTitle>
        <DialogDescription className="truncate">{description}</DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
        {every.length > 1 && (
          <ScanPanel
            on={unique}
            onToggle={setUnique}
            scan={scan}
            every={every}
            offered={all.length}
          />
        )}

        {every.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Every photo here is a mockup already.
          </p>
        ) : every.length === 1 ? (
          <div className="relative aspect-4/3 w-48 overflow-hidden rounded-lg border bg-muted">
            <Thumb src={small(every[0].url)} />
          </div>
        ) : (
          <RadioGroup
            value={choice}
            onValueChange={(value) => choose(value as Choice)}
            aria-label="Which photos"
            className={cn("grid-cols-3 gap-2.5 transition-opacity duration-200", waiting && "opacity-60")}
          >
            <ChoiceCard
              value="main"
              title="Main photos"
              detail={waiting ? "…" : main.length ? `${main.length} · 1 per listing` : "None left"}
            >
              <Mosaic photos={main} />
            </ChoiceCard>
            <ChoiceCard
              value="all"
              title={rooms ? "Every room" : "All photos"}
              detail={waiting ? "…" : `${all.length} · extras too`}
            >
              <Mosaic photos={rooms ? all : fullest} />
            </ChoiceCard>
            <ChoiceCard
              value="pick"
              title="Choose photos"
              detail={choice === "pick" ? `${count} of ${all.length} picked` : "Pick by hand"}
            >
              <div className="grid size-full grid-cols-3 grid-rows-2 gap-px opacity-80">
                {all.slice(0, 6).map((p) => (
                  <Thumb key={keyOf(p)} src={small(p.url)} />
                ))}
              </div>
            </ChoiceCard>
          </RadioGroup>
        )}

        {choice === "pick" && every.length > 1 && !waiting && (
          <ul
            aria-label="Photos"
            className="flex flex-col gap-4 transition-[opacity,translate] duration-200 ease-out-strong starting:-translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0"
          >
            {shown.map(({ listing, photos }) => {
              const on = photos.filter((p) => picked.has(keyOf(p))).length
              return (
                <li key={listing.listingId} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => toggle(photos)}
                      className="min-w-0 truncate rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                      title={on === photos.length ? "Pick none of its photos" : "Pick all of its photos"}
                    >
                      {listing.title}
                    </button>
                    <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                      {on} of {photos.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1.5">
                    {photos.map((p) => {
                      const selected = picked.has(keyOf(p))
                      const times = rooms ? (shots.get(rooms.get(p.url)?.room ?? "") ?? 1) : 1
                      return (
                        <button
                          key={keyOf(p)}
                          type="button"
                          aria-pressed={selected}
                          aria-label={`${p.index === 0 ? "Main photo" : `Photo ${p.index + 1}`}${p.again ? ", failed before" : ""}`}
                          title={times > 1 ? `This room is in ${times} photos` : undefined}
                          onClick={() => toggle([p])}
                          className={cn(
                            "group/tile relative block aspect-square w-full overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10 outline-none transition-[box-shadow,scale] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.96] motion-reduce:active:scale-100",
                            selected && "ring-2 ring-brand"
                          )}
                        >
                          <Thumb src={small(p.url)} />
                          <span
                            aria-hidden
                            className={cn(
                              "absolute inset-0 bg-brand/10 opacity-0 transition-opacity duration-150",
                              selected && "opacity-100"
                            )}
                          />
                          <SelectMark selected={selected} selecting />
                          {times > 1 && (
                            <span className="absolute top-1 right-1 rounded-sm bg-background/85 px-1 text-[10px] font-medium tabular-nums backdrop-blur-sm">
                              ×{times}
                            </span>
                          )}
                          <span
                            className={cn(
                              "absolute right-1 bottom-1 rounded-sm bg-background/85 px-1 text-[10px] font-medium tabular-nums backdrop-blur-sm",
                              p.again && "text-destructive"
                            )}
                          >
                            {p.index === 0 ? "Main" : p.index + 1}
                            {p.again && " · failed"}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </li>
              )
            })}
            {listed.length > shown.length && (
              <li>
                <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setPages((n) => n + 1)}>
                  Show more · {listed.length - shown.length} more {listed.length - shown.length === 1 ? "listing" : "listings"}
                </Button>
              </li>
            )}
          </ul>
        )}

        {every.length > 0 && (
          <>
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">Mockup category</span>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" size="sm" className="max-w-64 min-w-0">
                      <FolderIcon className="text-muted-foreground" />
                      <span className={cn("truncate", !category && "text-muted-foreground")}>
                        {category ?? "Choose a category"}
                      </span>
                      <ChevronDownIcon className="text-muted-foreground" data-icon="inline-end" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="start" className="w-64 p-0">
                  <CategoryPicker of="mockups" onPick={setCategory} current={category} />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <DeliveryField value={delivery} onChange={setDelivery} />
            </div>
          </>
        )}
      </div>

      <DialogFooter className="m-0 flex-row items-center gap-2 border-t bg-muted/50 px-5 py-3">
        <p className="mr-auto text-xs text-pretty text-muted-foreground">
          {waiting ? "Looking at the photos first…" : note.length ? note.join(" · ") : "Each photo becomes a blank mockup scene."}
        </p>
        <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
        <Button
          type="submit"
          disabled={!category || !count || busy}
          className="active:scale-[0.97] motion-reduce:active:scale-100"
        >
          {(busy || waiting) && <LoaderCircleIcon className="animate-spin" />}
          {waiting ? "Analysing" : count === 1 ? "Generate mockup" : `Generate ${count} mockups`}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** The scan's switch, how far it is, and what it left out. */
function ScanPanel({
  on,
  onToggle,
  scan,
  every,
  offered,
}: {
  on: boolean
  onToggle: (on: boolean) => void
  scan: Scan
  every: MockupPhoto[]
  offered: number
}) {
  const found = scan.photos
  const left = found
    ? {
        flat: every.filter((p) => found.get(p.url)?.mockup === false).length,
        stolen: every.filter((p) => found.get(p.url)?.mockup && found.get(p.url)?.stolen).length,
      }
    : null
  const repeats = left ? every.length - offered - left.flat - left.stolen : 0
  const share = scan.progress ? scan.progress.done / Math.max(1, scan.progress.total) : 0

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
          <ScanSearchIcon />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">Each room once</span>
          <span className="text-xs text-pretty text-muted-foreground">
            {scan.error
              ? `Couldn't look at the photos: ${scan.error}`
              : !found
                ? scan.progress?.step === "sorting"
                  ? `Telling mockups from size charts and close-ups · ${scan.progress.done} of ${scan.progress.total} rooms…`
                  : `Comparing ${every.length} photos${scan.progress ? ` · ${scan.progress.done} of ${scan.progress.total}` : ""}…`
                : on
                  ? `${every.length} photos show ${offered} new ${offered === 1 ? "room" : "rooms"}: ${[
                      repeats > 0 && `${repeats} repeat one`,
                      left!.flat > 0 && `${left!.flat} aren't mockups`,
                      left!.stolen > 0 && `${left!.stolen} show a room stolen already`,
                    ]
                      .filter(Boolean)
                      .join(", ") || "none repeat"}.`
                  : "Every photo is offered, repeats and size charts too."}
          </span>
        </div>
        <Switch checked={on} onCheckedChange={onToggle} aria-label="Each room once" />
      </div>
      {!found && !scan.error && (
        <Progress
          // Telling them apart takes the longer.
          value={scan.progress?.step === "sorting" ? 35 + share * 63 : share * 35}
          aria-label="Looking at the photos"
        />
      )}
    </div>
  )
}

// --- The scan ---

type Scan = { photos: Map<string, ScannedPhoto> | null; progress: ScanProgress | null; error: string | null }

/** Looks at `photos` once, against every photo made into a mockup before. */
function useScan(photos: MockupPhoto[], sets: GenerationSet[] | null) {
  const [scan, setScan] = React.useState<Scan>({ photos: null, progress: null, error: null })
  const ready = sets !== null && photos.length > 1

  React.useEffect(() => {
    if (!ready) return
    const abort = new AbortController()
    // Main photos first: they stand for their room.
    const order = [...photos.filter((p) => p.index === 0), ...photos.filter((p) => p.index > 0)].map((p) => p.url)
    const stolen = (sets ?? []).filter((s) => s.kind === "mockup" && s.status !== "error").map((s) => s.source.image)
    ;(async () => {
      try {
        const response = await fetch("/api/mockups/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: order, stolen }),
          signal: abort.signal,
        })
        if (!response.ok || !response.body) throw new Error((await response.json().catch(() => null))?.error ?? response.statusText)
        const decoder = new TextDecoder()
        let rest = ""
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n")
          rest = lines.pop() ?? ""
          for (const line of lines) {
            if (!line.trim()) continue
            const message = JSON.parse(line) as { progress?: ScanProgress; photos?: ScannedPhoto[]; error?: string }
            if (message.error) throw new Error(message.error)
            if (message.progress) setScan((s) => ({ ...s, progress: message.progress! }))
            if (message.photos) setScan({ photos: new Map(message.photos.map((p) => [p.url, p])), progress: null, error: null })
          }
        }
      } catch (error) {
        if (!abort.signal.aborted) setScan({ photos: null, progress: null, error: (error as Error).message })
      }
    })()
    return () => abort.abort()
    // Started once, with the photos as they were on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  return scan
}

function sourceOf({ listing, index, url }: MockupPhoto): GenerationSource {
  return {
    listingId: listing.listingId,
    title: index ? `${listing.title} · photo ${index + 1}` : listing.title,
    image: url,
    url: listing.url,
    shop: listing.shop,
    tags: listing.tags,
  }
}

/** Up to four photos filling a card's preview; none left, a check. */
function Mosaic({ photos }: { photos: MockupPhoto[] }) {
  const shown = photos.slice(0, 4)
  if (!shown.length) {
    return (
      <span className="grid size-full place-items-center text-muted-foreground">
        <CheckIcon className="size-5" />
      </span>
    )
  }
  if (shown.length === 1) return <Thumb src={small(shown[0].url)} />
  return (
    <div className={cn("grid size-full grid-cols-2 gap-px", shown.length > 2 && "grid-rows-2")}>
      {shown.map((p, i) => (
        <Thumb key={keyOf(p)} src={small(p.url)} className={cn(shown.length === 3 && i === 2 && "col-span-2")} />
      ))}
    </div>
  )
}
