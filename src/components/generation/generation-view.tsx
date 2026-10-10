"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  ClockIcon,
  DownloadIcon,
  FrameIcon,
  ImagesIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react"
import { toast } from "sonner"

import { CompareViewer, type Viewing } from "@/components/generation/compare-viewer"
import { GenerateDialog } from "@/components/generation/generate-dialog"
import { RegenerateMockupDialog } from "@/components/mockups/regenerate-dialog"
import { RetryButton } from "@/components/generation/retry-button"
import {
  aspectOf,
  AssetImage,
  batchSummary,
  DeleteButton,
  downloadOutputs,
  OutputTile,
  progress,
  shortTitle,
  timeAgo,
  toReview,
} from "@/components/generation/parts"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  deleteGeneration,
  generateMore,
  generationFileUrl,
  isActive,
  markDone,
  useGenerations,
} from "@/hooks/use-generations"
import type { GenerationKind, GenerationSet, Output } from "@/lib/generation/types"
import { cn } from "@/lib/utils"

// Everything generated, newest first, one row per listing photo: the photo,
// the poster(s) taken out of it, then what was drawn from them. Rows show
// the first few results to approve or reject in one click; the set's own
// page has all of them, grouped. "Review" steps through every undecided
// image large, next to its reference.

type KindFilter = "all" | GenerationKind

const KINDS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "poster", label: "Posters" },
  { value: "mockup", label: "Mockups" },
]

const ALL_FOLDERS = "__all__"
/** Results shown in a row; more open the set's page. */
const INLINE = 6

export function GenerationView() {
  const sets = useGenerations()
  const [filter, setFilter] = useFilter()
  const [viewing, setViewing] = React.useState<Viewing>(null)

  const folders = React.useMemo(
    () => [...new Set((sets ?? []).map((s) => s.folder))].sort((a, b) => a.localeCompare(b)),
    [sets]
  )
  const inScope = React.useMemo(
    () =>
      (sets ?? []).filter(
        (s) =>
          (filter.kind === "all" || s.kind === filter.kind) &&
          (!filter.folder || s.folder.toLowerCase() === filter.folder.toLowerCase())
      ),
    [sets, filter.kind, filter.folder]
  )
  // Sets marked done drop out of Everything and To review until more images are made.
  const openSets = React.useMemo(() => inScope.filter((s) => !s.doneAt), [inScope])
  const done = React.useMemo(
    () => inScope.filter((s) => s.doneAt).sort((a, b) => b.doneAt!.localeCompare(a.doneAt!)),
    [inScope]
  )
  const visible =
    filter.show === "done" ? done : filter.show === "pending" ? openSets.filter((s) => toReview(s).length > 0) : openSets
  const queue = React.useMemo(
    () => openSets.flatMap((s) => toReview(s).map((o) => ({ set: s.id, output: o.id }))),
    [openSets]
  )
  // Sets whose only open work is a batch job at Vertex count apart: they take a while.
  const inBatch = (s: GenerationSet) =>
    s.status === "running" && s.outputs.some((o) => o.job) && !s.outputs.some((o) => o.status === "pending" || (o.status === "running" && !o.job))
  const batched = sets?.filter(inBatch).length ?? 0
  const running = (sets?.filter((s) => s.status === "running").length ?? 0) - batched
  // Every set in view with something failed and nothing going on, for Retry all.
  const retryable = React.useMemo(
    () => visible.filter((s) => !isActive(s)).map((s) => ({ id: s.id, failed: progress(s).failed })).filter((s) => s.failed > 0),
    [visible]
  )
  const failedCount = retryable.reduce((n, s) => n + s.failed, 0)
  const waiting = sets?.filter((s) => s.status === "queued").length ?? 0

  const folderItems = [
    { value: ALL_FOLDERS, label: "All folders" },
    ...folders.map((f) => ({ value: f, label: f })),
  ]

  const open = (set: GenerationSet, output: Output) =>
    setViewing({
      items: set.outputs.filter((o) => o.status === "done" && o.file).map((o) => ({ set: set.id, output: o.id })),
      at: { set: set.id, output: output.id },
    })

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[filter.kind]}
          onValueChange={(value) => value[0] && setFilter({ kind: value[0] as KindFilter })}
          aria-label="Kind"
        >
          {KINDS.map((k) => (
            <ToggleGroupItem key={k.value} value={k.value}>
              {k.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Select
          value={filter.folder ?? ALL_FOLDERS}
          items={folderItems}
          onValueChange={(value) => setFilter({ folder: value && value !== ALL_FOLDERS ? value : null })}
        >
          <SelectTrigger size="sm" className="w-44" aria-label="Folder">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {folderItems.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[filter.show]}
          onValueChange={(value) => value[0] && setFilter({ show: value[0] as Show })}
          aria-label="Show"
        >
          <ToggleGroupItem value="all">Everything</ToggleGroupItem>
          <ToggleGroupItem value="pending" className="gap-1.5">
            To review
            {queue.length > 0 && (
              <span className="rounded-full bg-brand px-1.5 text-[11px] leading-4 font-medium text-white tabular-nums">
                {queue.length}
              </span>
            )}
          </ToggleGroupItem>
          <ToggleGroupItem value="done" className="gap-1.5">
            Done
            {done.length > 0 && <span className="text-muted-foreground tabular-nums">{done.length}</span>}
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="ml-auto flex items-center gap-3">
          {running + waiting > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              {running} generating
              {waiting > 0 && <span>· {waiting} waiting</span>}
            </p>
          )}
          {batched > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
              <ClockIcon className="size-3.5" />
              {batched} in batch
            </p>
          )}
          {retryable.length > 0 && (
            <RetryButton
              sets={retryable.map((s) => s.id)}
              count={failedCount}
              label={`Retry all · ${failedCount}`}
            />
          )}
          {queue.length > 0 && (
            <Button
              size="sm"
              className="active:scale-[0.97]"
              onClick={() => setViewing({ items: queue, at: queue[0] })}
              title="Step through every image nobody has decided on yet"
            >
              <CheckIcon />
              Review {queue.length}
            </Button>
          )}
        </div>
      </div>

      {sets === null ? (
        <div className="flex flex-col divide-y">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="grid gap-4 py-4 md:grid-cols-[15rem_minmax(0,1fr)]">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <div className="flex gap-3">
                {Array.from({ length: 5 }, (_, j) => (
                  <Skeleton key={j} className="h-44 w-36 rounded-lg" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">{filter.show !== "all" ? <CheckIcon /> : <SparklesIcon />}</EmptyMedia>
            <EmptyTitle>
              {filter.show === "done"
                ? "Nothing done yet"
                : filter.show === "pending"
                  ? "All reviewed"
                  : sets.length
                    ? "Nothing here"
                    : "Nothing generated yet"}
            </EmptyTitle>
            <EmptyDescription>
              {filter.show === "done"
                ? "Tick a set as done to move it here, out of Everything and To review. Making more images from it brings it back."
                : filter.show === "pending"
                ? "Every finished image has been approved or rejected. Approved ones are ready for uploads."
                : sets.length
                  ? "No sets match these filters."
                  : "Open a folder in Saved and press Generate posters: each steal is taken out of its photo and redrawn at low, medium and high creativity."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {filter.show === "done" ? null : filter.show === "pending" ? (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/uploads" />}>
                Go to uploads
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            ) : sets.length ? (
              <Button variant="outline" size="sm" onClick={() => setFilter({ kind: "all", folder: null })}>
                Show everything
              </Button>
            ) : (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/liked" />}>
                Go to Saved
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex flex-col divide-y">
          {visible.map((set) => (
            <SetRow key={set.id} set={set} onOpen={(output) => open(set, output)} />
          ))}
        </div>
      )}

      <CompareViewer viewing={viewing} onChange={setViewing} />
    </div>
  )
}

// --- A row ---

const CELL = "h-44 2xl:h-52"

function SetRow({ set, onOpen }: { set: GenerationSet; onOpen: (output: Output) => void }) {
  const [generating, setGenerating] = React.useState(false)
  const [regenerating, setRegenerating] = React.useState(false)
  const active = isActive(set)
  const { failed, stage, review, approved, made } = progress(set)
  const batch = batchSummary(set)
  const href = `/generation/${set.id}`
  const many = set.posters.length > 1
  const shown = set.outputs.length > INLINE ? set.outputs.slice(0, INLINE - 1) : set.outputs
  const hidden = set.outputs.length - shown.length

  async function toggleDone() {
    const done = !set.doneAt
    try {
      await markDone(set.id, done)
      if (done)
        toast.success("Moved to Done", {
          description: shortTitle(set.source.title),
          action: { label: "Undo", onClick: () => markDone(set.id, false).catch(() => {}) },
        })
    } catch (error) {
      toast.error(`Couldn't update: ${(error as Error).message}`)
    }
  }

  return (
    <article className="grid gap-4 py-4 md:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-1.5">
        {set.kind === "poster" ? (
          <Link
            href={href}
            className="line-clamp-2 text-sm leading-snug font-medium underline-offset-4 outline-none hover:underline focus-visible:underline"
            title={set.source.title}
          >
            {shortTitle(set.source.title)}
          </Link>
        ) : (
          <a
            href={set.source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-2 text-sm leading-snug font-medium underline-offset-4 hover:underline"
            title={set.source.title}
          >
            {shortTitle(set.source.title)}
          </a>
        )}
        <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground [&>*+*]:before:mr-1.5 [&>*+*]:before:content-['·']">
          {set.source.shop && <span className="truncate">{set.source.shop}</span>}
          <span>{set.folder}</span>
          <time dateTime={set.createdAt} title={new Date(set.createdAt).toLocaleString()}>
            {timeAgo(set.createdAt)}
          </time>
        </div>

        <p
          className={cn(
            "flex items-center gap-1.5 text-xs tabular-nums [&_svg]:size-3.5",
            failed > 0 && !active ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {set.status === "queued" ? (
            <>
              <ClockIcon /> Waiting
            </>
          ) : set.status === "running" ? (
            <>
              <LoaderCircleIcon className="animate-spin" /> {stage}
            </>
          ) : failed > 0 ? (
            <>
              <CircleAlertIcon /> {failed} failed
            </>
          ) : set.kind === "mockup" ? (
            <>
              <CheckIcon className="text-brand" /> Done
            </>
          ) : review > 0 ? (
            <>
              <span className="size-1.5 rounded-full bg-brand" aria-hidden /> {review} to review
              {approved > 0 && <span>· {approved} approved</span>}
            </>
          ) : (
            <>
              <CheckIcon className="text-emerald-600 dark:text-emerald-500" />
              {approved ? `${approved} of ${made} approved` : "Reviewed"}
            </>
          )}
        </p>
        {batch && (
          <p
            className={cn(
              "flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums [&_svg]:size-3.5",
              batch.failed && "text-destructive"
            )}
            title={batch.title}
          >
            <ClockIcon className={cn(batch.running && "animate-pulse")} />
            {batch.text}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Button
            variant={set.doneAt ? "secondary" : "outline"}
            size="icon-xs"
            aria-pressed={!!set.doneAt}
            aria-label={set.doneAt ? "Back to Everything" : "Mark as done"}
            title={set.doneAt ? "Done — click to bring it back" : "Mark as done: out of Everything and To review"}
            disabled={active}
            onClick={toggleDone}
          >
            <CheckIcon className={cn(set.doneAt && "text-emerald-600 dark:text-emerald-500")} />
          </Button>
          {set.kind === "poster" && (
            <>
              <Button variant="outline" size="xs" nativeButton={false} render={<Link href={href} />}>
                Open
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={set.posters.length === 0}
                onClick={() => setGenerating(true)}
                title={set.posters.length ? "More variants or new ideas" : "Needs the poster first"}
              >
                <SparklesIcon />
                More
              </Button>
            </>
          )}
          {failed > 0 && !active && <RetryButton sets={[set.id]} count={failed} label="Retry failed" size="xs" />}
          {set.sceneId && (
            <>
              <Button variant="outline" size="xs" nativeButton={false} render={<Link href={`/mockups/${set.sceneId}`} />}>
                <FrameIcon />
                Open in editor
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={active}
                onClick={() => setRegenerating(true)}
                title="Paint the blank again: say what should be different"
              >
                <RefreshCwIcon />
                Regenerate
              </Button>
            </>
          )}
          {made > 1 && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={approved ? "Download approved" : "Download all"}
              title={approved ? "Download approved" : "Download all"}
              onClick={() =>
                downloadOutputs(set, approved ? set.outputs.filter((o) => o.review === "approved") : set.outputs)
              }
            >
              <DownloadIcon />
            </Button>
          )}
          <DeleteButton
            label="Delete set"
            onDelete={() =>
              deleteGeneration(set.id).catch((error: Error) => toast.error(`Couldn't delete: ${error.message}`))
            }
          />
        </div>
      </div>

      <div className="-mx-1 flex min-w-0 scroll-fade-x scroll-fade-8 items-start gap-3 overflow-x-auto overscroll-x-contain px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <SourceCell set={set} />
        {set.kind === "poster" ? (
          <>
            <Flow />
            <PosterCell set={set} href={href} />
            {set.outputs.length > 0 && <Flow />}
            {shown.map((output) => (
              <OutputTile
                key={output.id}
                set={set}
                output={output}
                onOpen={() => onOpen(output)}
                frameClassName={CELL}
                className="max-w-56"
                badge={many ? output.poster + 1 : undefined}
              />
            ))}
            {hidden > 0 && <MoreCell set={set} output={set.outputs[shown.length]} count={hidden} href={href} />}
          </>
        ) : (
          set.mockup && (
            <>
              <Flow />
              <Cell aspect={aspectOf(set.mockup) ?? aspectOf(set.original) ?? 1} caption="Blank mockup" note={set.mockup.note}>
                {set.sceneId && set.mockup.status === "done" ? (
                  <Link href={`/mockups/${set.sceneId}`} aria-label="Open in editor" className="block size-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                    <AssetImage set={set} asset={set.mockup} />
                  </Link>
                ) : (
                  <AssetImage set={set} asset={set.mockup} working="Emptying frame" />
                )}
              </Cell>
            </>
          )
        )}
      </div>

      {set.sceneId && (
        <RegenerateMockupDialog
          open={regenerating}
          onOpenChange={setRegenerating}
          sceneId={set.sceneId}
          name={shortTitle(set.source.title)}
          image={set.mockup?.file && generationFileUrl(set.id, set.mockup.file)}
        />
      )}
      <GenerateDialog
        open={generating}
        onOpenChange={setGenerating}
        title="Generate more"
        description={shortTitle(set.source.title)}
        thumbs={set.posters.flatMap((p) => (p.file ? [generationFileUrl(set.id, p.file)] : []))}
        references={{ count: Math.max(1, set.posters.length), noun: "poster" }}
        onSubmit={async (options) => {
          try {
            await generateMore(set.id, options)
            toast.success("Added to the queue", {
              description: "The new images appear in this row and on the set's page.",
            })
          } catch (error) {
            toast.error(`Couldn't start: ${(error as Error).message}`)
            throw error
          }
        }}
      />
    </article>
  )
}

function Cell({
  aspect,
  caption,
  note,
  children,
}: {
  aspect: number
  caption: React.ReactNode
  note?: string
  children: React.ReactNode
}) {
  return (
    <figure className="flex shrink-0 flex-col gap-1.5">
      <div className={cn("relative overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/5", CELL)} style={{ aspectRatio: aspect }}>
        {children}
      </div>
      <figcaption className="flex items-center gap-1.5 px-0.5 text-xs text-muted-foreground" title={note}>
        {caption}
        {note && <CircleAlertIcon className="size-3.5 text-amber-600" aria-label={note} />}
      </figcaption>
    </figure>
  )
}

function SourceCell({ set }: { set: GenerationSet }) {
  const [natural, setNatural] = React.useState<number | null>(null)
  const src = set.original.file ? generationFileUrl(set.id, set.original.file) : set.source.image
  return (
    <Cell aspect={aspectOf(set.original) ?? natural ?? 1} caption="Listing photo">
      <a href={set.source.url} target="_blank" rel="noopener noreferrer" aria-label="Open on Etsy" className="block size-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onLoad={(event) => setNatural(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
          className="size-full object-cover"
        />
      </a>
    </Cell>
  )
}

/** The poster taken out of the photo, or the set of them as a small grid. */
function PosterCell({ set, href }: { set: GenerationSet; href: string }) {
  const extraction = set.extraction ?? { status: "pending" as const, file: null }
  if (extraction.status !== "done" || set.posters.length === 0) {
    return (
      <Cell aspect={3 / 4} caption="Poster">
        <AssetImage
          set={set}
          asset={extraction.status === "done" ? { status: "error", file: null, error: "No poster found" } : extraction}
          working="Finding posters"
        />
      </Cell>
    )
  }
  const [first] = set.posters
  const many = set.posters.length > 1
  const caption = many ? `Set of ${set.posters.length}` : set.layout === "flat" ? "Artwork" : "Poster"
  const cols = set.posters.length <= 4 ? 2 : 3
  return (
    <Cell aspect={many ? 3 / 4 : (aspectOf(first) ?? 3 / 4)} caption={caption} note={extraction.note}>
      <Link
        href={href}
        aria-label={`Open ${caption.toLowerCase()}`}
        className={cn(
          "block size-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
          many && "grid content-center gap-1 bg-muted p-1.5"
        )}
        style={many ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
      >
        {set.posters.map((p) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={p.index}
            src={generationFileUrl(set.id, p.file!)}
            alt={p.label ?? `Poster ${p.index + 1}`}
            loading="lazy"
            className={cn(many ? "w-full rounded-sm object-cover shadow-xs" : "size-full object-cover")}
            style={many ? { aspectRatio: aspectOf(p) ?? 3 / 4 } : undefined}
          />
        ))}
      </Link>
    </Cell>
  )
}

/** The rest of a set's results, one click away. */
function MoreCell({ set, output, count, href }: { set: GenerationSet; output: Output; count: number; href: string }) {
  return (
    <figure className="flex shrink-0 flex-col gap-1.5">
      <Link
        href={href}
        className={cn(
          "group/more relative grid place-items-center overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          CELL
        )}
        style={{ aspectRatio: aspectOf(output) ?? 3 / 4 }}
      >
        {output.file && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={generationFileUrl(set.id, output.file)}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full scale-110 object-cover opacity-50 blur-md"
          />
        )}
        <span className="relative flex flex-col items-center gap-1 text-sm font-medium transition-transform duration-150 ease-out group-active/more:scale-[0.97]">
          <ImagesIcon className="size-5" />+{count} more
        </span>
      </Link>
      <figcaption className="px-0.5 text-xs text-muted-foreground">See all</figcaption>
    </figure>
  )
}

function Flow() {
  return (
    <ArrowRightIcon
      aria-hidden
      className="mt-[calc(var(--spacing)*22-0.5rem)] size-4 shrink-0 text-muted-foreground/50 2xl:mt-[calc(var(--spacing)*26-0.5rem)]"
    />
  )
}

// --- Filters in the URL (`?kind=`, `?folder=`, `?review=pending|done`) ---

type Show = "all" | "pending" | "done"

function useFilter() {
  const searchParams = useSearchParams()
  const kindParam = searchParams.get("kind")
  const folder = searchParams.get("folder")
  const reviewParam = searchParams.get("review")
  const show: Show = reviewParam === "pending" || reviewParam === "done" ? reviewParam : "all"
  const filter = React.useMemo(
    () => ({
      kind: (kindParam === "poster" || kindParam === "mockup" ? kindParam : "all") as KindFilter,
      folder: folder || null,
      show,
    }),
    [kindParam, folder, show]
  )
  const setFilter = React.useCallback(
    (next: Partial<{ kind: KindFilter; folder: string | null; show: Show }>) => {
      const params = new URLSearchParams(window.location.search)
      if (next.kind !== undefined) {
        if (next.kind === "all") params.delete("kind")
        else params.set("kind", next.kind)
      }
      if (next.folder !== undefined) {
        if (next.folder === null) params.delete("folder")
        else params.set("folder", next.folder)
      }
      if (next.show !== undefined) {
        if (next.show === "all") params.delete("review")
        else params.set("review", next.show)
      }
      const query = params.toString()
      window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
    },
    []
  )
  return [filter, setFilter] as const
}
