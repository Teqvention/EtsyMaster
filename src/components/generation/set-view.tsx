"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import {
  ArrowLeftIcon,
  CheckCheckIcon,
  CheckIcon,
  CircleAlertIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  ImageUpIcon,
  LightbulbIcon,
  LoaderCircleIcon,
  PaletteIcon,
  RepeatIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { CompareViewer, type Viewing } from "@/components/generation/compare-viewer"
import { GenerateDialog } from "@/components/generation/generate-dialog"
import {
  aspectOf,
  AssetImage,
  CreativityMeter,
  DeleteButton,
  downloadOutputs,
  fileBase,
  makeMockupPoster,
  OutputTile,
  progress,
  shortTitle,
  slug,
  timeAgo,
} from "@/components/generation/parts"
import { AddToStyleMenuItems } from "@/components/styles/add-to-style"
import { StyleFromImagesDialog } from "@/components/styles/style-from-images"
import { useStyles } from "@/hooks/use-styles"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { RetryButton } from "@/components/generation/retry-button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  deleteGeneration,
  deleteOutputs,
  generateMore,
  generationFileUrl,
  isActive,
  reviewOutputs,
  useGenerations,
} from "@/hooks/use-generations"
import {
  CREATIVITIES,
  CREATIVITY_LABEL,
  type Batch,
  type ExtractedPoster,
  type GenerateOptions,
  type GenerationSet,
  type Output,
  type OutputMode,
} from "@/lib/generation/types"
import { describeFolder } from "@/lib/saved/folders"
import { cn } from "@/lib/utils"

// One listing photo and everything drawn from it. The poster(s) on the
// left are what it all comes from — with a set of N, picking one narrows
// the page to it. On the right, its results grouped by request, newest
// first: each group says what was asked for, and can be approved or
// cleared in one go. Any image opens large, next to its reference.

type ReviewFilter = "all" | "pending" | "approved" | "rejected"

export function SetView({ id }: { id: Promise<string> }) {
  const setId = React.use(id)
  const sets = useGenerations()
  const set = sets?.find((s) => s.id === setId)

  if (sets === null) {
    return (
      <div className="grid gap-6 px-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:px-6">
        <Skeleton className="aspect-3/4 w-full rounded-xl" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-3/4 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }
  if (!set) {
    return (
      <div className="px-4 lg:px-6">
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleAlertIcon />
            </EmptyMedia>
            <EmptyTitle>This set is gone</EmptyTitle>
            <EmptyDescription>It was deleted, or the link is wrong.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/generation" />}>
              <ArrowLeftIcon />
              All generations
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }
  return <Loaded set={set} />
}

type Group = {
  key: string
  batch: Batch | null
  mode: OutputMode
  poster: number
  outputs: Output[]
}

function Loaded({ set }: { set: GenerationSet }) {
  const router = useRouter()
  const [filter, setFilter] = useFilter()
  const [viewing, setViewing] = React.useState<Viewing>(null)
  const [generating, setGenerating] = React.useState(false)
  const [inspiring, setInspiring] = React.useState(false)
  const [styling, setStyling] = React.useState(false)
  const styles = useStyles()
  const active = isActive(set)
  const { failed, stage, review, approved } = progress(set)
  const many = set.posters.length > 1
  const poster = many && filter.poster !== null ? set.posters.find((p) => p.index === filter.poster) : undefined

  const counts = React.useMemo(() => {
    const mine = set.outputs.filter((o) => !poster || o.poster === poster.index)
    return {
      all: mine.length,
      pending: mine.filter((o) => o.status === "done" && !o.review).length,
      approved: mine.filter((o) => o.review === "approved").length,
      rejected: mine.filter((o) => o.review === "rejected").length,
    }
  }, [set.outputs, poster])

  // Newest request first; within it, per poster and mode, in the order drawn.
  const groups = React.useMemo(() => {
    const keep = (o: Output) =>
      (!poster || o.poster === poster.index) &&
      (filter.review === "all" ||
        (filter.review === "pending" ? o.status === "done" && !o.review : o.review === filter.review))
    const batches = new Map(set.batches.map((b, i) => [b.id, { batch: b, order: i }]))
    const map = new Map<string, Group>()
    for (const o of set.outputs) {
      if (!keep(o)) continue
      const key = `${o.batch}|${o.poster}|${o.mode}`
      const group = map.get(key) ?? {
        key,
        batch: batches.get(o.batch)?.batch ?? null,
        mode: o.mode,
        poster: o.poster,
        outputs: [],
      }
      group.outputs.push(o)
      map.set(key, group)
    }
    const order = (g: Group) => batches.get(g.batch?.id ?? "")?.order ?? -1
    return [...map.values()].sort(
      (a, b) => order(b) - order(a) || a.poster - b.poster || (a.mode === "variant" ? -1 : 1)
    )
  }, [set.outputs, set.batches, poster, filter.review])

  const shown = groups.flatMap((g) => g.outputs).filter((o) => o.status === "done" && o.file)
  const open = (output: Output) =>
    setViewing({
      items: shown.map((o) => ({ set: set.id, output: o.id })),
      at: { set: set.id, output: output.id },
    })
  const approvedShown = set.outputs.filter(
    (o) => o.review === "approved" && o.file && (!poster || o.poster === poster.index)
  )
  // For a style: everything not rejected, approved first.
  const styleable = set.outputs
    .filter((o) => o.status === "done" && o.file && o.review !== "rejected" && (!poster || o.poster === poster.index))
    .toSorted((a, b) => Number(b.review === "approved") - Number(a.review === "approved"))
  const queued = async (options: GenerateOptions) => {
    try {
      await generateMore(set.id, options)
      setFilter({ review: "all" })
      toast.success("Added to the queue", {
        description: "The new images appear at the top as they're drawn.",
      })
    } catch (error) {
      toast.error(`Couldn't start: ${(error as Error).message}`)
      throw error
    }
  }
  const reviewAll = () => {
    const queue = set.outputs.filter(
      (o) => o.status === "done" && o.file && !o.review && (!poster || o.poster === poster.index)
    )
    if (queue.length) {
      setViewing({
        items: queue.map((o) => ({ set: set.id, output: o.id })),
        at: { set: set.id, output: queue[0].id },
      })
    }
  }
  const styleName = (id: string | null | undefined) => (id ? styles?.find((s) => s.id === id)?.name : undefined)

  return (
    <div className="grid gap-6 px-4 lg:grid-cols-[17rem_minmax(0,1fr)] lg:px-6 xl:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 self-start text-muted-foreground"
          nativeButton={false}
          render={<Link href={`/generation?folder=${encodeURIComponent(set.folder)}`} />}
        >
          <ArrowLeftIcon />
          {describeFolder(set.folder)}
        </Button>

        <div className="flex flex-col gap-1">
          <h2 className="text-base leading-snug font-semibold text-balance">{shortTitle(set.source.title)}</h2>
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground [&>*+*]:before:mr-1.5 [&>*+*]:before:content-['·']">
            {set.source.shop && <span>{set.source.shop}</span>}
            <time dateTime={set.createdAt} title={new Date(set.createdAt).toLocaleString()}>
              {timeAgo(set.createdAt)}
            </time>
            <a
              href={set.source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 underline-offset-4 hover:text-foreground hover:underline"
            >
              Etsy
              <ExternalLinkIcon className="size-3" />
            </a>
          </div>
        </div>

        <References set={set} selected={poster?.index ?? null} onSelect={(index) => setFilter({ poster: index })} />

        {poster?.analysis ? (
          <Analysis poster={poster} />
        ) : (
          !many && set.posters[0]?.analysis && <Analysis poster={set.posters[0]} />
        )}
      </aside>

      <main className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            value={[filter.review]}
            onValueChange={(value) => value[0] && setFilter({ review: value[0] as ReviewFilter })}
            aria-label="Show"
          >
            <FilterItem value="all" label="All" count={counts.all} />
            <FilterItem value="pending" label="To review" count={counts.pending} accent />
            <FilterItem value="approved" label="Approved" count={counts.approved} />
            <FilterItem value="rejected" label="Rejected" count={counts.rejected} />
          </ToggleGroup>

          {active && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              {set.status === "queued" ? "Waiting" : stage}
            </p>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {failed > 0 && !active && <RetryButton sets={[set.id]} count={failed} label={`Retry ${failed} failed`} />}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More" />}>
                <EllipsisIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  disabled={!approved}
                  onClick={() =>
                    downloadOutputs(
                      set,
                      set.outputs.filter((o) => o.review === "approved")
                    )
                  }
                >
                  <DownloadIcon />
                  Download approved
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => downloadOutputs(set, set.outputs)}>
                  <DownloadIcon />
                  Download all
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!styleable.length} onClick={() => setStyling(true)}>
                  <PaletteIcon />
                  Create style…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!counts.rejected}
                  onClick={() =>
                    deleteOutputs(
                      set.id,
                      set.outputs.filter((o) => o.review === "rejected").map((o) => o.id)
                    ).catch((error: Error) => toast.error(`Couldn't delete: ${error.message}`))
                  }
                >
                  <Trash2Icon />
                  Delete rejected
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {review > 0 && (
              <Button variant="outline" size="sm" onClick={reviewAll} className="active:scale-[0.97]">
                <CheckIcon />
                Review {poster ? counts.pending : review}
              </Button>
            )}
            {filter.review === "approved" && counts.approved > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={set.posters.length === 0}
                onClick={() => setInspiring(true)}
                className="active:scale-[0.97]"
                title="New ideas after the approved images"
              >
                <LightbulbIcon />
                New ideas
              </Button>
            )}
            {filter.review === "approved" && counts.approved > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStyling(true)}
                className="active:scale-[0.97]"
                title="A new style from the images you pick"
              >
                <PaletteIcon />
                Create style
              </Button>
            )}
            <Button
              size="sm"
              disabled={set.posters.length === 0}
              onClick={() => setGenerating(true)}
              className="active:scale-[0.97]"
            >
              <SparklesIcon />
              Generate more
            </Button>
          </div>
        </div>

        {set.outputs.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {active ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
              </EmptyMedia>
              <EmptyTitle>{active ? stage : "No images yet"}</EmptyTitle>
              <EmptyDescription>
                {active
                  ? "The new posters show up here as they're drawn."
                  : "Generate variants or new ideas from the poster on the left."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : groups.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CheckIcon />
              </EmptyMedia>
              <EmptyTitle>{filter.review === "pending" ? "All decided" : "None here"}</EmptyTitle>
              <EmptyDescription>
                {filter.review === "pending"
                  ? "Every finished image of this set is approved or rejected."
                  : "No images match this filter."}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={() => setFilter({ review: "all" })}>
                Show all
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          groups.map((group) => (
            <GroupSection
              key={group.key}
              set={set}
              group={group}
              poster={many && !poster ? set.posters.find((p) => p.index === group.poster) : undefined}
              styleName={styleName}
              onOpen={open}
            />
          ))
        )}
      </main>

      <CompareViewer viewing={viewing} onChange={setViewing} />
      <GenerateDialog
        open={generating}
        onOpenChange={setGenerating}
        title={poster ? `Generate more from poster ${poster.index + 1}` : "Generate more"}
        description={poster?.label ?? shortTitle(set.source.title)}
        thumbs={(poster ? [poster] : set.posters).flatMap((p) => (p.file ? [generationFileUrl(set.id, p.file)] : []))}
        references={{
          count: poster ? 1 : Math.max(1, set.posters.length),
          noun: "poster",
        }}
        initial={
          poster
            ? {
                variants: {
                  count: 3,
                  creativity: ["low", "medium", "high"],
                  styleId: null,
                },
                ideas: { count: 0, creativity: ["medium"] },
                posters: [poster.index],
              }
            : undefined
        }
        onSubmit={queued}
      />
      <GenerateDialog
        open={inspiring}
        onOpenChange={setInspiring}
        title="New ideas from approved"
        description="Same concept, in the spirit of what you approved"
        thumbs={approvedShown.slice(0, 3).map((o) => generationFileUrl(set.id, o.file!))}
        references={{ count: 1, noun: "batch" }}
        initial={{
          variants: { count: 0, creativity: ["medium"], styleId: null },
          ideas: { count: 6, creativity: ["low", "medium", "high"] },
          ...(poster && { posters: [poster.index] }),
        }}
        inspiration={approvedShown.map((o) => ({
          id: o.id,
          src: generationFileUrl(set.id, o.file!),
          title: o.title ?? CREATIVITY_LABEL[o.creativity],
        }))}
        onSubmit={queued}
      />
      <StyleFromImagesDialog
        open={styling}
        onOpenChange={setStyling}
        generation={set.id}
        images={styleable.map((o) => ({
          file: o.file!,
          title: o.title ?? CREATIVITY_LABEL[o.creativity],
          approved: o.review === "approved",
        }))}
      />
      <DeleteSet set={set} onDeleted={() => router.push(`/generation?folder=${encodeURIComponent(set.folder)}`)} />
    </div>
  )
}

function FilterItem({
  value,
  label,
  count,
  accent,
}: {
  value: ReviewFilter
  label: string
  count: number
  accent?: boolean
}) {
  return (
    <ToggleGroupItem value={value} className="gap-1.5">
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 text-[11px] leading-4 font-medium tabular-nums",
          accent && count > 0 ? "bg-brand text-white" : "bg-muted text-muted-foreground"
        )}
      >
        {count}
      </span>
    </ToggleGroupItem>
  )
}

// --- References ---

/** The listing photo and the poster(s) taken out of it; with a set, each one picks. */
function References({
  set,
  selected,
  onSelect,
}: {
  set: GenerationSet
  selected: number | null
  onSelect: (index: number | null) => void
}) {
  const router = useRouter()
  const extraction = set.extraction ?? {
    status: "pending" as const,
    file: null,
  }
  const many = set.posters.length > 1
  const photo = set.original.file ? generationFileUrl(set.id, set.original.file) : set.source.image

  if (extraction.status !== "done" || set.posters.length === 0) {
    return (
      <div className="flex max-w-64 flex-col gap-2 lg:max-w-none">
        <div
          className="relative overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/5"
          style={{ aspectRatio: 3 / 4 }}
        >
          <AssetImage
            set={set}
            asset={
              extraction.status === "done" ? { status: "error", file: null, error: "No poster found" } : extraction
            }
            working="Finding posters"
          />
        </div>
        <Photo src={photo} set={set} />
      </div>
    )
  }

  if (!many) {
    const [poster] = set.posters
    return (
      <div className="flex max-w-64 flex-col gap-2 lg:max-w-none">
        <figure
          className="group/ref relative overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/5"
          style={{ aspectRatio: aspectOf(poster) ?? 3 / 4 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={generationFileUrl(set.id, poster.file!)}
            alt="Reference poster"
            className="size-full object-cover"
          />
          <figcaption className="absolute top-2 left-2 rounded-md bg-background/85 px-2 py-0.5 text-xs font-medium shadow-xs backdrop-blur-sm">
            Reference
          </figcaption>
          <PosterMenu set={set} poster={poster} router={router} className="absolute top-2 right-2" />
        </figure>
        <Photo src={photo} set={set} note={extraction.note} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium">Set of {set.posters.length}</p>
        {selected !== null && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Show all
          </button>
        )}
      </div>
      <div className={cn("grid gap-2", set.posters.length <= 4 ? "grid-cols-2" : "grid-cols-3")}>
        {set.posters.map((p) => {
          const on = selected === p.index
          const count = set.outputs.filter((o) => o.poster === p.index).length
          return (
            <div key={p.index} className="group/ref relative">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(on ? null : p.index)}
                title={p.label ?? `Poster ${p.index + 1}`}
                className={cn(
                  "relative block w-full overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10 transition-[opacity,transform,box-shadow] duration-150 ease-out outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
                  on && "ring-2 ring-brand",
                  selected !== null && !on && "opacity-50 [@media(hover:hover)]:hover:opacity-100"
                )}
                style={{ aspectRatio: aspectOf(p) ?? 3 / 4 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={generationFileUrl(set.id, p.file!)}
                  alt={p.label ?? `Poster ${p.index + 1}`}
                  className="size-full object-cover"
                />
                <span className="absolute bottom-1 left-1 rounded-sm bg-background/90 px-1 text-[10px] leading-4 font-medium tabular-nums shadow-xs">
                  {p.index + 1}
                  {count > 0 && <span className="text-muted-foreground"> · {count}</span>}
                </span>
              </button>
              <PosterMenu
                set={set}
                poster={p}
                router={router}
                className="absolute top-1 right-1 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/ref:opacity-100 has-[[aria-expanded=true]]:opacity-100"
              />
            </div>
          )
        })}
      </div>
      {selected !== null && set.posters[selected]?.label && (
        <p className="text-xs text-muted-foreground">
          Poster {selected + 1}: <span className="text-foreground">{set.posters[selected].label}</span>
        </p>
      )}
      <Photo src={photo} set={set} note={extraction.note} />
    </div>
  )
}

function Photo({ src, set, note }: { src: string; set: GenerationSet; note?: string }) {
  return (
    <a
      href={set.source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group/photo flex items-center gap-2.5 rounded-lg p-1 -m-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
      title="The listing photo — open on Etsy"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="size-10 shrink-0 rounded-md object-cover ring-1 ring-foreground/10" />
      <span className="flex min-w-0 flex-col">
        <span className="font-medium text-foreground">Listing photo</span>
        <span className="truncate">{note ?? set.source.shop ?? "Etsy"}</span>
      </span>
    </a>
  )
}

function PosterMenu({
  set,
  poster,
  router,
  className,
}: {
  set: GenerationSet
  poster: ExtractedPoster
  router: ReturnType<typeof useRouter>
  className?: string
}) {
  const name = poster.label ?? `Poster ${poster.index + 1}`
  return (
    <div className={cn("transition-opacity duration-150 ease-out", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="secondary"
              size="icon-xs"
              aria-label={`${name}: actions`}
              className="bg-background/90 shadow-xs backdrop-blur-sm"
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            render={
              <a href={generationFileUrl(set.id, poster.file!)} download={`${fileBase(set)}-${slug(name)}.jpg`} />
            }
          >
            <DownloadIcon />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => makeMockupPoster(set, poster.file!, name, router)}>
            <ImageUpIcon />
            Use in mockups
          </DropdownMenuItem>
          <AddToStyleMenuItems generation={set.id} file={poster.file!} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** What the AI read from the poster, the basis of every brief. */
function Analysis({ poster }: { poster: ExtractedPoster }) {
  const a = poster.analysis!
  return (
    <details className="group/analysis rounded-lg border bg-card text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium select-none [&::-webkit-details-marker]:hidden">
        What the AI sees
        <span className="ml-auto flex gap-0.5" aria-hidden>
          {a.palette.slice(0, 5).map((hex) => (
            <span key={hex} className="size-3 rounded-full ring-1 ring-foreground/10" style={{ background: hex }} />
          ))}
        </span>
      </summary>
      <dl className="grid gap-2 border-t px-3 py-2.5 leading-relaxed text-muted-foreground [&_dt]:font-medium [&_dt]:text-foreground">
        <div>
          <dt>Shows</dt>
          <dd>{a.summary}</dd>
        </div>
        <div>
          <dt>Why it sells</dt>
          <dd>{a.hook}</dd>
        </div>
        <div>
          <dt>Style</dt>
          <dd>{a.style}</dd>
        </div>
        <div>
          <dt>Buyers</dt>
          <dd>{a.audience}</dd>
        </div>
      </dl>
    </details>
  )
}

// --- Groups ---

function GroupSection({
  set,
  group,
  poster,
  styleName,
  onOpen,
}: {
  set: GenerationSet
  group: Group
  /** Shown when the page has all posters of a set. */
  poster?: ExtractedPoster
  styleName: (id: string | null | undefined) => string | undefined
  onOpen: (output: Output) => void
}) {
  const { batch, mode, outputs } = group
  const options = batch?.options
  const from = options?.from ? set.outputs.find((o) => o.id === options.from) : undefined
  const style = mode === "variant" ? styleName(outputs.find((o) => o.styleId)?.styleId) : undefined
  const undecided = outputs.filter((o) => o.status === "done" && !o.review)
  const working = outputs.filter((o) => o.status === "pending" || o.status === "running").length
  const levels = CREATIVITIES.filter((c) => outputs.some((o) => o.creativity === c))

  const title = from
    ? `More like “${from.title ?? CREATIVITY_LABEL[from.creativity]}”`
    : options?.inspiration
      ? `New ideas after ${options.inspiration.length} approved`
      : mode === "idea"
        ? "New ideas"
        : style
          ? `Variants in ${style}`
          : "Variants"
  const icon = from ? <RepeatIcon /> : mode === "idea" ? <LightbulbIcon /> : style ? <PaletteIcon /> : <SparklesIcon />

  async function decideAll(review: "approved" | "rejected") {
    try {
      await reviewOutputs(
        set.id,
        undecided.map((o) => o.id),
        review
      )
    } catch (error) {
      toast.error(`Couldn't save: ${(error as Error).message}`)
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0" aria-label={title}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {poster?.file && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={generationFileUrl(set.id, poster.file)}
            alt=""
            className="h-9 w-7 rounded-sm object-cover ring-1 ring-foreground/10"
          />
        )}
        <div className="flex min-w-0 flex-col">
          <h3 className="flex items-center gap-1.5 text-sm font-medium [&>svg]:size-3.5 [&>svg]:text-muted-foreground">
            {icon}
            {poster && <span className="text-muted-foreground">Poster {poster.index + 1} ·</span>}
            <span className="truncate">{title}</span>
          </h3>
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums">
            <span>
              {outputs.length} {outputs.length === 1 ? "image" : "images"}
            </span>
            {levels.length > 0 && (
              <span className="flex items-center gap-1">
                ·
                {levels.map((l) => (
                  <CreativityMeter key={l} level={l} />
                ))}
              </span>
            )}
            {batch && <span>· {timeAgo(batch.createdAt)}</span>}
            {working > 0 && (
              <span className="flex items-center gap-1">
                · <LoaderCircleIcon className="size-3 animate-spin" /> {working} drawing
              </span>
            )}
          </p>
        </div>
        {undecided.length > 1 && (
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="xs" onClick={() => decideAll("rejected")} className="text-muted-foreground">
              <XIcon />
              Reject {undecided.length}
            </Button>
            <Button variant="outline" size="xs" onClick={() => decideAll("approved")}>
              <CheckCheckIcon />
              Approve {undecided.length}
            </Button>
          </div>
        )}
        {options?.feedback && (
          <p className="w-full border-l-2 border-brand/40 pl-2 text-xs text-muted-foreground">“{options.feedback}”</p>
        )}
      </header>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-3 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))]">
        {outputs.map((output) => (
          <OutputTile key={output.id} set={set} output={output} onOpen={() => onOpen(output)} frameClassName="w-full" />
        ))}
      </div>
    </section>
  )
}

function DeleteSet({ set, onDeleted }: { set: GenerationSet; onDeleted: () => void }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t pt-4 text-xs text-muted-foreground lg:col-start-2">
      Delete this set and its {set.outputs.length} {set.outputs.length === 1 ? "image" : "images"}
      <DeleteButton
        label="Delete set"
        onDelete={() =>
          deleteGeneration(set.id)
            .then(onDeleted)
            .catch((error: Error) => toast.error(`Couldn't delete: ${error.message}`))
        }
      />
    </div>
  )
}

// --- Filters in the URL (`?review=`, `?poster=` 1-based) ---

function useFilter() {
  const searchParams = useSearchParams()
  const reviewParam = searchParams.get("review")
  const posterParam = searchParams.get("poster")
  const filter = React.useMemo(
    () => ({
      review: (["pending", "approved", "rejected"].includes(reviewParam ?? "") ? reviewParam : "all") as ReviewFilter,
      poster: posterParam && Number(posterParam) >= 1 ? Number(posterParam) - 1 : null,
    }),
    [reviewParam, posterParam]
  )
  const setFilter = React.useCallback((next: Partial<{ review: ReviewFilter; poster: number | null }>) => {
    const params = new URLSearchParams(window.location.search)
    if (next.review !== undefined) {
      if (next.review === "all") params.delete("review")
      else params.set("review", next.review)
    }
    if (next.poster !== undefined) {
      if (next.poster === null) params.delete("poster")
      else params.set("poster", String(next.poster + 1))
    }
    const query = params.toString()
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
  }, [])
  return [filter, setFilter] as const
}
