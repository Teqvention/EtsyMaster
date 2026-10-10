"use client"

import { useRouter } from "next/navigation"
import * as React from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns2Icon,
  DownloadIcon,
  EllipsisIcon,
  ImageUpIcon,
  ScrollTextIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { GenerateDialog } from "@/components/generation/generate-dialog"
import {
  CreativityMeter,
  fileBase,
  makeMockupPoster,
  outputName,
  ReviewButtons,
  ReviewMark,
  shortTitle,
  slug,
} from "@/components/generation/parts"
import { AddToStyleMenuItems } from "@/components/styles/add-to-style"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  deleteOutputs,
  generateMore,
  generationFileUrl,
  reviewOutputs,
  useGenerations,
} from "@/hooks/use-generations"
import type { GenerationSet, Output, Review } from "@/lib/generation/types"
import { cn } from "@/lib/utils"

// One output large, next to what it was drawn from, for deciding fast:
// A approves, X rejects (and moves on to the next one), arrows step through,
// C turns the comparison off, holding Space puts a magnifying glass under the
// pointer. "More like this" asks for new takes on it.

export type ViewerItem = { set: string; output: string }
export type Viewing = { items: ViewerItem[]; at: ViewerItem } | null

const same = (a: ViewerItem, b: ViewerItem) => a.set === b.set && a.output === b.output

// Kept for the session: whoever turns these off wants them off next time too.
let autoAdvance = true
let comparing = true

type Against = "poster" | "photo" | "earlier"

// The magnifying glass: its size across, and how much larger than on screen it shows the image.
const LENS = 240
const ZOOM = 3

export function CompareViewer({ viewing, onChange }: { viewing: Viewing; onChange: (next: Viewing) => void }) {
  return (
    <Dialog open={viewing !== null} onOpenChange={(open) => !open && onChange(null)}>
      {/* Focus starts on the dialog itself, so the arrow keys browse rather than move between toggles. */}
      <DialogContent
        initialFocus={(type) => (type === "keyboard" ? undefined : false)}
        className="flex max-h-[96svh] flex-col gap-3 p-3 outline-none sm:max-w-[min(96vw,84rem)]"
      >
        {viewing && <Viewer viewing={viewing} onChange={onChange} />}
      </DialogContent>
    </Dialog>
  )
}

function Viewer({ viewing, onChange }: { viewing: NonNullable<Viewing>; onChange: (next: Viewing) => void }) {
  const router = useRouter()
  const sets = useGenerations()
  const [compare, setCompare] = React.useState(comparing)
  const [advance, setAdvance] = React.useState(autoAdvance)
  const [against, setAgainst] = React.useState<Against>("poster")
  const [refining, setRefining] = React.useState(false)
  const [magnifying, setMagnifying] = React.useState(false)
  const strip = React.useRef<HTMLDivElement>(null)

  // Only images that are there; one deleted meanwhile drops out.
  const live = React.useMemo(() => {
    const byId = new Map((sets ?? []).map((s) => [s.id, s]))
    return viewing.items.flatMap((item) => {
      const set = byId.get(item.set)
      const output = set?.outputs.find((o) => o.id === item.output)
      return set && output?.file && output.status === "done" ? [{ item, set, output }] : []
    })
  }, [sets, viewing.items])

  const index = live.findIndex((l) => same(l.item, viewing.at))
  const current = live[index]
  const prev = live[index - 1]
  const next = live[index + 1]

  const go = React.useCallback(
    (to: ViewerItem | undefined) => to && onChange({ ...viewing, at: to }),
    [onChange, viewing]
  )

  // The image on show went away (deleted): the one after it takes its place.
  React.useEffect(() => {
    if (!sets || current) return
    const from = viewing.items.findIndex((i) => same(i, viewing.at))
    const after = viewing.items.slice(from + 1).find((i) => live.some((l) => same(l.item, i)))
    const before = viewing.items.slice(0, Math.max(0, from)).findLast((i) => live.some((l) => same(l.item, i)))
    if (after ?? before) go(after ?? before)
    else onChange(null)
  }, [sets, current, live, viewing, go, onChange])

  React.useEffect(() => {
    strip.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [index])

  const decide = React.useCallback(
    async (review: Review) => {
      if (!current) return
      const undo = current.output.review === review
      if (!undo && advance && next) go(next.item)
      try {
        await reviewOutputs(current.set.id, [current.output.id], undo ? null : review)
      } catch (error) {
        toast.error(`Couldn't save: ${(error as Error).message}`)
      }
    },
    [current, advance, next, go]
  )

  // Capture phase: a focused toggle or button would otherwise take the arrows for itself.
  React.useEffect(() => {
    if (refining) return
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      if (target.closest("input, textarea, [role=menu]") || event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (event.key === "ArrowLeft") go(prev?.item)
      else if (event.key === "ArrowRight") go(next?.item)
      else if (key === "a") decide("approved")
      else if (key === "x") decide("rejected")
      else if (key === "c") setCompare((c) => (comparing = !c))
      else if (key === "m") setRefining(true)
      else if (event.key === " ") setMagnifying(true)
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [refining, prev, next, go, decide])

  // Letting go of Space puts the glass away, and the release isn't left to click a focused button.
  // Leaving the window puts it away too, as the release never arrives then.
  React.useEffect(() => {
    if (!magnifying) return
    function onKeyUp(event: KeyboardEvent) {
      if (event.key !== " ") return
      setMagnifying(false)
      event.preventDefault()
      event.stopPropagation()
    }
    const putAway = () => setMagnifying(false)
    window.addEventListener("keyup", onKeyUp, true)
    window.addEventListener("blur", putAway)
    return () => {
      window.removeEventListener("keyup", onKeyUp, true)
      window.removeEventListener("blur", putAway)
    }
  }, [magnifying])

  if (!current) return null
  const { set, output } = current
  const poster = set.posters.find((p) => p.index === output.poster)
  const earlier = output.from ? set.outputs.find((o) => o.id === output.from && o.file) : undefined
  // "Earlier" only means something for a reworked image.
  const showing: Against = against === "earlier" && !earlier ? "poster" : against
  const reference = showing === "photo" ? set.original : showing === "earlier" ? earlier : poster
  const name = outputName(output)
  const file = `${fileBase(set)}-${slug(name)}.jpg`
  const decided = live.filter((l) => l.output.review).length

  return (
    <>
      <DialogHeader className="flex-row items-center gap-3 pr-9">
        <div className="flex min-w-0 flex-col gap-0.5">
          <DialogTitle className="flex items-center gap-2">
            <span className="truncate">{name}</span>
            <CreativityMeter level={output.creativity} />
            {output.mode === "idea" && (
              <span className="rounded-full bg-brand/10 px-1.5 py-px text-[11px] font-medium text-brand">Idea</span>
            )}
          </DialogTitle>
          <DialogDescription className="truncate">
            {shortTitle(set.source.title)}
            {set.posters.length > 1 && ` · Poster ${output.poster + 1}${poster?.label ? ` (${poster.label})` : ""}`}
          </DialogDescription>
        </div>
        <p className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
          {index + 1} / {live.length}
          {decided > 0 && <span className="hidden sm:inline"> · {decided} decided</span>}
        </p>
      </DialogHeader>

      <div
        className={cn(
          "grid min-h-0 flex-1 gap-3",
          compare ? "grid-rows-[minmax(0,2fr)_minmax(0,3fr)] md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:grid-rows-1" : "grid-cols-1"
        )}
      >
        {compare && (
          <Pane
            magnify={magnifying}
            label={
              <ToggleGroup
                size="sm"
                spacing={0}
                value={[showing]}
                onValueChange={(value) => value[0] && setAgainst(value[0] as Against)}
                aria-label="Compare with"
                className="rounded-md bg-background/80 p-0.5 shadow-xs backdrop-blur-sm"
              >
                <ToggleGroupItem value="poster" className="h-6 px-2 text-xs">
                  Reference
                </ToggleGroupItem>
                <ToggleGroupItem value="photo" className="h-6 px-2 text-xs">
                  Listing photo
                </ToggleGroupItem>
                {earlier && (
                  <ToggleGroupItem value="earlier" className="h-6 px-2 text-xs">
                    Earlier
                  </ToggleGroupItem>
                )}
              </ToggleGroup>
            }
          >
            {reference?.file && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={generationFileUrl(set.id, reference.file)}
                alt="What it was drawn from"
                className="max-h-full max-w-full object-contain"
              />
            )}
          </Pane>
        )}

        <Pane
          magnify={magnifying}
          label={
            <span className="flex items-center gap-1.5 rounded-md bg-background/80 px-2 py-1 text-xs font-medium shadow-xs backdrop-blur-sm">
              Ours
            </span>
          }
          review={output.review}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={output.id}
            src={generationFileUrl(set.id, output.file!)}
            alt={`${name}: new poster from ${set.source.title}`}
            className="max-h-full max-w-full object-contain"
          />
          {prev && (
            <Button
              variant="secondary"
              size="icon"
              aria-label="Previous"
              className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-background/90 shadow-sm active:scale-95"
              onClick={() => go(prev.item)}
            >
              <ChevronLeftIcon />
            </Button>
          )}
          {next && (
            <Button
              variant="secondary"
              size="icon"
              aria-label="Next"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-background/90 shadow-sm active:scale-95"
              onClick={() => go(next.item)}
            >
              <ChevronRightIcon />
            </Button>
          )}
        </Pane>
      </div>

      {live.length > 1 && (
        <div
          ref={strip}
          className="flex gap-1.5 overflow-x-auto px-0.5 py-1 [scrollbar-width:none]"
          role="listbox"
          aria-label="Images"
        >
          {live.map((l) => (
            <button
              key={`${l.item.set}/${l.item.output}`}
              type="button"
              role="option"
              aria-selected={same(l.item, viewing.at)}
              aria-current={same(l.item, viewing.at)}
              aria-label={outputName(l.output)}
              onClick={() => go(l.item)}
              className={cn(
                "relative h-14 shrink-0 overflow-hidden rounded-md ring-1 ring-foreground/10 transition-[opacity,transform] duration-150 ease-out outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95",
                same(l.item, viewing.at) ? "opacity-100 ring-2 ring-brand" : "opacity-55 [@media(hover:hover)]:hover:opacity-100",
                l.output.review === "rejected" && !same(l.item, viewing.at) && "opacity-30"
              )}
              style={{ aspectRatio: l.output.width && l.output.height ? l.output.width / l.output.height : 0.75 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={generationFileUrl(l.set.id, l.output.file!)} alt="" className="size-full object-cover" />
              <Mark review={l.output.review} />
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant={compare ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={compare}
            onClick={() => setCompare((c) => (comparing = !c))}
            title="Compare (C)"
          >
            <Columns2Icon />
            Compare
          </Button>
          {output.brief && (
            <Popover>
              <PopoverTrigger render={<Button variant="ghost" size="sm" />}>
                <ScrollTextIcon />
                Art direction
              </PopoverTrigger>
              <PopoverContent align="start" className="w-96 text-sm leading-relaxed">
                {output.title && <p className="font-medium">{output.title}</p>}
                <p className="text-muted-foreground">{output.brief}</p>
                {output.feedback && (
                  <p className="mt-2 border-l-2 border-brand/50 pl-2 text-xs text-muted-foreground">
                    Your notes: {output.feedback}
                  </p>
                )}
              </PopoverContent>
            </Popover>
          )}
          <label className="ml-1 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <Switch size="sm" checked={advance} onCheckedChange={(on) => setAdvance((autoAdvance = on))} />
            Next after deciding
          </label>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <p className="mr-1 hidden items-center gap-1 text-[11px] text-muted-foreground lg:flex">
            <Kbd>←</Kbd>
            <Kbd>→</Kbd> browse <Kbd>A</Kbd> approve <Kbd>X</Kbd> reject <Kbd>Space</Kbd> magnify
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}>
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem render={<a href={generationFileUrl(set.id, output.file!)} download={file} />}>
                <DownloadIcon />
                Download
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => makeMockupPoster(set, output.file!, name, router)}>
                <ImageUpIcon />
                Use in mockups
              </DropdownMenuItem>
              <AddToStyleMenuItems generation={set.id} file={output.file!} />
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() =>
                  deleteOutputs(set.id, [output.id]).catch((error: Error) =>
                    toast.error(`Couldn't delete: ${error.message}`)
                  )
                }
              >
                <Trash2Icon />
                Delete image
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => setRefining(true)} title="More like this (M)">
            <SparklesIcon />
            More like this
          </Button>
          <ReviewButtons set={set} output={output} size="lg" onDecide={decide} />
        </div>
      </div>

      <RefineDialog set={set} output={output} open={refining} onOpenChange={setRefining} />
    </>
  )
}

function Pane({
  label,
  review,
  magnify,
  children,
}: {
  label: React.ReactNode
  review?: Review | null
  magnify: boolean
  children: React.ReactNode
}) {
  const box = React.useRef<HTMLDivElement>(null)
  const lens = React.useRef<HTMLDivElement>(null)
  const pointer = React.useRef<{ x: number; y: number } | null>(null)

  // Moved by hand rather than through state, as it follows every pointer move.
  // Only over the image; off it the glass hides.
  const place = React.useCallback(() => {
    const pane = box.current
    const glass = lens.current
    if (!pane || !glass) return
    const image = pane.querySelector<HTMLImageElement>(":scope > img")
    const rect = image?.getBoundingClientRect()
    const at = pointer.current
    if (!image || !rect?.width || !at || at.x < rect.left || at.x > rect.right || at.y < rect.top || at.y > rect.bottom) {
      glass.style.display = "none"
      return
    }
    const origin = pane.getBoundingClientRect()
    Object.assign(glass.style, {
      display: "",
      left: `${at.x - origin.left - LENS / 2}px`,
      top: `${at.y - origin.top - LENS / 2}px`,
      backgroundImage: `url("${image.currentSrc}")`,
      backgroundSize: `${rect.width * ZOOM}px ${rect.height * ZOOM}px`,
      backgroundPosition: `${LENS / 2 - (at.x - rect.left) * ZOOM}px ${LENS / 2 - (at.y - rect.top) * ZOOM}px`,
    })
  }, [])

  // Again after every render (browsing while held, comparison turned off) and once a new image is in.
  React.useLayoutEffect(() => {
    if (magnify) place()
  })
  React.useEffect(() => {
    const pane = box.current
    if (!magnify || !pane) return
    pane.addEventListener("load", place, true)
    return () => pane.removeEventListener("load", place, true)
  }, [magnify, place])

  return (
    <div
      ref={box}
      onPointerMove={(event) => {
        pointer.current = { x: event.clientX, y: event.clientY }
        if (magnify) place()
      }}
      onPointerLeave={() => {
        pointer.current = null
        if (magnify) place()
      }}
      className={cn(
        "relative grid min-h-[30svh] place-items-center overflow-hidden rounded-lg bg-muted/50 p-2 md:min-h-[min(70svh,44rem)] [&>img]:max-h-[calc(96svh-15rem)]",
        magnify && "[&>img]:cursor-none"
      )}
    >
      {children}
      <div className="absolute top-2 left-2 flex items-center gap-1.5">{label}</div>
      {review && (
        <span
          className={cn(
            "absolute top-2 right-2 rounded-full px-2 py-0.5 text-[11px] font-medium text-white shadow-sm",
            review === "approved" ? "bg-emerald-600 dark:bg-emerald-500" : "bg-destructive"
          )}
        >
          {review === "approved" ? "Approved" : "Rejected"}
        </span>
      )}
      {magnify && (
        <div
          ref={lens}
          aria-hidden
          className="pointer-events-none absolute rounded-full border-2 border-background bg-muted bg-no-repeat bg-origin-border shadow-xl ring-1 ring-foreground/15"
          style={{ width: LENS, height: LENS }}
        />
      )}
    </div>
  )
}

function Mark({ review }: { review: Review | null }) {
  return (
    <span className="[&>span]:top-0.5 [&>span]:left-0.5 [&>span]:size-3.5 [&_svg]:size-2!">
      <ReviewMark review={review} />
    </span>
  )
}

/** "More like this": the generate dialog, notes first, starting from one output. */
export function RefineDialog({
  set,
  output,
  open,
  onOpenChange,
}: {
  set: GenerationSet
  output: Output
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const name = outputName(output)
  return (
    <GenerateDialog
      open={open}
      onOpenChange={onOpenChange}
      title="More like this"
      description={`Builds on “${output.title ?? name}” — say what should be different.`}
      thumbs={output.file ? [generationFileUrl(set.id, output.file)] : []}
      references={{ count: 1, noun: "image" }}
      notesFirst
      initial={{
        variants: { count: 2, creativity: [output.creativity], styleId: output.styleId ?? null },
        ideas: { count: 0, creativity: ["medium"] },
      }}
      submitLabel="Make"
      onSubmit={async (options) => {
        try {
          await generateMore(set.id, { ...options, from: output.id })
          const n = options.variants.count + options.ideas.count
          toast.success(`Making ${n} more like “${name}”`, {
            description: "They show up next to it as they're done.",
          })
        } catch (error) {
          toast.error(`Couldn't start: ${(error as Error).message}`)
          throw error
        }
      }}
    />
  )
}
