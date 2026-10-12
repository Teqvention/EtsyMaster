"use client"

import * as React from "react"
import {
  CircleCheckIcon,
  CircleSlashIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FileSearchIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { timeAgo } from "@/components/generation/parts"
import { clock, etsyListingUrl, StageSteps } from "@/components/uploads/upload-status"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cancelItem, retryItem, retryItems, setJobStatus, setPipelinePaused } from "@/hooks/use-pipeline"
import { SIZE_BY_KEY } from "@/lib/catalog/sizes"
import { formatNumber } from "@/lib/etsy/format"
import { STAGE_LABEL, stagesOf, type JobItem, type PipelineState, type UploadJob } from "@/lib/pipeline/types"
import { isOnEtsy, posterKey } from "@/lib/uploads/groups"
import type { GroupPoster } from "@/lib/uploads/types"
import { cn } from "@/lib/utils"

// The uploads under way and those of the last week: per job how far its
// posters have come, and per poster its eight stages, what it waits for or
// why it failed. Jobs pause, resume and cancel here; failed posters retry.

/** Finished jobs shown before "Show older". */
const FINISHED = 2
/** A job with more posters than this starts folded. */
const OPEN_MAX = 60

const plural = (n: number, word: string) => `${formatNumber(n)} ${word}${n === 1 ? "" : "s"}`

/** A file an item made, by its path under pipeline/ in storage (or already its own folder). */
const itemFile = (item: JobItem, path: string) =>
  `/api/pipeline/items/${item.id}/files/${path.replace(/^(?:.*\/)?items\/[^/]+\//, "")}`

export function JobsPanel({
  pipeline,
  posters,
  accountName,
}: {
  pipeline: PipelineState
  /** Per poster key, its poster: thumbs and titles. */
  posters: Map<string, GroupPoster>
  accountName: (id: string) => string
}) {
  const [older, setOlder] = React.useState(false)
  const items = React.useMemo(() => new Map(pipeline.items.map((i) => [i.id, i])), [pipeline.items])
  const active = pipeline.jobs.filter((j) => j.status === "running" || j.status === "paused")
  const finished = pipeline.jobs.filter((j) => j.status === "done" || j.status === "cancelled")
  const shown = [...active, ...(older ? finished : finished.slice(0, FINISHED))]

  if (pipeline.jobs.length === 0) return null

  async function togglePaused() {
    try {
      await setPipelinePaused(!pipeline.paused)
    } catch (error) {
      toast.error(`Couldn't ${pipeline.paused ? "resume" : "pause"}: ${(error as Error).message}`)
    }
  }

  return (
    <section aria-labelledby="uploads-jobs" className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <h2 id="uploads-jobs" className="text-sm font-medium">
          Uploads
        </h2>
        {pipeline.paused && (
          <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
            <PauseIcon />
            All paused
          </Badge>
        )}
        {active.length > 0 && (
          <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={togglePaused}>
            {pipeline.paused ? <PlayIcon /> : <PauseIcon />}
            {pipeline.paused ? "Resume all" : "Pause all"}
          </Button>
        )}
      </div>
      <ol className="flex flex-col gap-2">
        {shown.map((job) => (
          <li key={job.id}>
            <JobCard
              job={job}
              items={job.items.flatMap((id) => items.get(id) ?? [])}
              posters={posters}
              accountName={accountName}
              paused={pipeline.paused}
            />
          </li>
        ))}
      </ol>
      {finished.length > FINISHED && (
        <button
          type="button"
          onClick={() => setOlder(!older)}
          aria-expanded={older}
          className="flex items-center gap-1 self-start rounded-md px-1 py-0.5 text-xs text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:text-foreground"
        >
          {older ? "Show fewer" : `Show ${finished.length - FINISHED} older`}
          <ChevronDownIcon
            className={cn(
              "size-3 transition-transform duration-200 ease-out-strong motion-reduce:transition-none",
              older && "rotate-180"
            )}
          />
        </button>
      )}
    </section>
  )
}

// --- One job ---

type Tally = { done: number; live: number; running: number; waiting: number; failed: number; queued: number; cancelled: number }

function tally(items: JobItem[]): Tally {
  const t: Tally = { done: 0, live: 0, running: 0, waiting: 0, failed: 0, queued: 0, cancelled: 0 }
  for (const item of items) {
    t[item.status]++
    if (isOnEtsy(item)) t.live++
  }
  return t
}

function JobCard({
  job,
  items,
  posters,
  accountName,
  paused,
}: {
  job: UploadJob
  items: JobItem[]
  posters: Map<string, GroupPoster>
  accountName: (id: string) => string
  /** Every job is held. */
  paused: boolean
}) {
  const t = tally(items)
  const going = job.status === "running" || job.status === "paused"
  const accounts = [...new Set(items.map((i) => i.account))]
  const total = items.length
  const failed = items.filter((i) => i.status === "failed")
  const [busy, setBusy] = React.useState(false)
  const [open, setOpen] = React.useState(going && total <= OPEN_MAX)

  async function run(what: string, action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      toast.error(`Couldn't ${what}: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const reached = job.dryRun ? t.done : t.live
  const words = [
    `${formatNumber(reached)} of ${formatNumber(total)} ${job.dryRun ? "done" : job.activate ? "live" : "on Etsy"}`,
    t.running && `${formatNumber(t.running)} at work`,
    t.waiting && `${formatNumber(t.waiting)} waiting`,
    t.failed && `${formatNumber(t.failed)} failed`,
    t.cancelled && `${formatNumber(t.cancelled)} cancelled`,
  ].filter(Boolean)

  return (
    <article
      aria-label={`Upload of ${plural(total, "poster")}`}
      className="flex flex-col rounded-xl border bg-card text-card-foreground"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <JobIcon job={job} paused={paused} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-medium">
              {plural(total, "poster")} to {plural(accounts.length, "shop")}
            </span>
            {job.dryRun && (
              <Badge variant="outline" className="text-muted-foreground">
                Test run
              </Badge>
            )}
            {!job.activate && (
              <Badge variant="outline" className="text-muted-foreground">
                Stays inactive
              </Badge>
            )}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {job.status === "done"
              ? `Finished ${timeAgo(job.finishedAt ?? job.updatedAt)}`
              : job.status === "cancelled"
                ? `Cancelled ${timeAgo(job.finishedAt ?? job.updatedAt)}`
                : job.status === "paused"
                  ? `Paused · started ${timeAgo(job.createdAt)}`
                  : `Started ${timeAgo(job.createdAt)}`}{" "}
            · {words.join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {failed.length > 0 && job.status !== "cancelled" && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => run("retry", () => retryItems(failed.map((i) => i.id)))}
            >
              <RotateCwIcon />
              Retry {failed.length} failed
            </Button>
          )}
          {going && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                run(job.status === "paused" ? "resume" : "pause", () =>
                  setJobStatus(job.id, job.status === "paused" ? "running" : "paused")
                )
              }
            >
              {job.status === "paused" ? <PlayIcon /> : <PauseIcon />}
              {job.status === "paused" ? "Resume" : "Pause"}
            </Button>
          )}
          {going && <CancelJob job={job} live={t.live} onCancel={() => run("cancel", () => setJobStatus(job.id, "cancelled"))} />}
        </div>
      </div>

      <JobBar tally={t} total={total} going={going && !paused && job.status === "running"} />

      <Collapsible open={open} onOpenChange={setOpen} className="group/items flex flex-col">
        <CollapsibleTrigger className="flex items-center gap-1.5 border-t px-3 py-2 text-left text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset [@media(hover:hover)]:hover:text-foreground">
          {open ? "Hide the posters" : `Show the ${plural(total, "poster")}`}
          <ChevronDownIcon className="size-3.5 transition-transform duration-200 ease-out-strong group-data-open/items:rotate-180 motion-reduce:transition-none" />
        </CollapsibleTrigger>
        <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out-strong data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
          <div className="flex flex-col gap-3 px-3 pb-3">
            {accounts.map((account) => {
              const own = items.filter((i) => i.account === account)
              return (
                <section key={account} aria-label={accountName(account)} className="flex flex-col">
                  <h3 className="flex items-center gap-2 py-1 text-xs font-medium">
                    {accountName(account)}
                    <span className="font-normal text-muted-foreground tabular-nums">
                      {formatNumber(own.filter((i) => (job.dryRun ? i.status === "done" : isOnEtsy(i))).length)} of{" "}
                      {formatNumber(own.length)}
                    </span>
                  </h3>
                  <ul className="flex flex-col divide-y">
                    {own.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        job={job}
                        poster={posters.get(posterKey(item.groupId, item.outputId))}
                        accountName={accountName(account)}
                      />
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </article>
  )
}

function JobIcon({ job, paused }: { job: UploadJob; paused: boolean }) {
  const className = "size-4 shrink-0"
  if (job.status === "done") return <CircleCheckIcon className={cn(className, "text-emerald-600 dark:text-emerald-400")} />
  if (job.status === "cancelled") return <CircleSlashIcon className={cn(className, "text-muted-foreground")} />
  if (job.status === "paused" || paused) return <PauseIcon className={cn(className, "text-amber-600 dark:text-amber-400")} />
  return <LoaderCircleIcon className={cn(className, "animate-spin text-muted-foreground motion-reduce:animate-none")} />
}

/** The job's posters as one bar: done, at work, waiting, failed, still queued. */
function JobBar({ tally: t, total, going }: { tally: Tally; total: number; going: boolean }) {
  const parts = [
    { key: "done", n: t.done, className: "bg-emerald-500" },
    { key: "running", n: t.running, className: "relative overflow-hidden bg-foreground/60" },
    { key: "waiting", n: t.waiting, className: "bg-amber-500/80" },
    { key: "failed", n: t.failed, className: "bg-destructive" },
    { key: "queued", n: t.queued, className: "bg-muted-foreground/15" },
    { key: "cancelled", n: t.cancelled, className: "bg-muted-foreground/10" },
  ].filter((p) => p.n > 0)
  return (
    <div
      role="progressbar"
      aria-label="Posters done"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={t.done}
      className="mx-3 mb-3 flex h-1.5 gap-px overflow-hidden rounded-full bg-muted"
    >
      {parts.map((p) => (
        <span
          key={p.key}
          className={cn("h-full transition-[flex-grow] duration-500 ease-out-strong motion-reduce:transition-none", p.className)}
          style={{ flexGrow: p.n }}
        >
          {p.key === "running" && going && (
            <span
              aria-hidden
              className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-white/45 to-transparent motion-reduce:hidden"
            />
          )}
        </span>
      ))}
    </div>
  )
}

function CancelJob({ job, live, onCancel }: { job: UploadJob; live: number; onCancel: () => void }) {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}>
        <XIcon />
        Cancel
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-0.5">
          <p className="font-medium">Cancel this upload?</p>
          <p className="text-xs text-muted-foreground">
            Posters not started yet stay out; the ones at work stop where they are.
            {live > 0 && !job.dryRun && ` The ${plural(live, "listing")} already on Etsy stay there.`}
          </p>
        </div>
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Keep going
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setOpen(false)
              onCancel()
            }}
          >
            Cancel upload
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// --- One poster ---

function lineOf(item: JobItem, job: UploadJob) {
  if (item.status === "failed") {
    return `${STAGE_LABEL[item.stage]}: ${item.error ?? "failed"}${item.attempts > 1 ? ` (tried ${item.attempts}×)` : ""}`
  }
  if (item.status === "waiting") {
    return `${item.note ?? STAGE_LABEL[item.stage]}${item.wakeAt ? `, again at ${clock(item.wakeAt)}` : ""}`
  }
  if (item.status === "running") return `${STAGE_LABEL[item.stage]}…`
  if (item.status === "queued") return job.status === "paused" ? "Paused" : "Waiting for its turn"
  if (item.status === "cancelled") return "Cancelled"
  return job.dryRun ? "Done: nothing was sent" : job.activate ? "Live" : "On Etsy, inactive"
}

function ItemRow({
  item,
  job,
  poster,
  accountName,
}: {
  item: JobItem
  job: UploadJob
  poster: GroupPoster | undefined
  accountName: string
}) {
  const [details, setDetails] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const title = item.title ?? poster?.title ?? item.outputId
  const going = job.status === "running" || job.status === "paused"
  const cancellable = going && item.status !== "done" && item.status !== "cancelled" && !isOnEtsy(item)

  async function run(what: string, action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      toast.error(`Couldn't ${what}: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex items-center gap-3 py-1.5">
      <span
        className="h-10 shrink-0 overflow-hidden rounded-sm bg-muted ring-1 ring-foreground/10"
        style={{ aspectRatio: poster?.posterWidth && poster.posterHeight ? `${poster.posterWidth} / ${poster.posterHeight}` : "3 / 4" }}
      >
        {poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster.thumb} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm" title={title}>
          {title}
        </span>
        <span
          className={cn(
            "truncate text-xs",
            item.status === "failed"
              ? "text-destructive"
              : item.status === "waiting"
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground"
          )}
          title={item.error ?? item.note}
        >
          {lineOf(item, job)}
        </span>
      </div>
      <StageSteps item={item} className="hidden @xl/main:flex" />
      <div className="flex shrink-0 items-center gap-0.5">
        {item.status === "failed" && going && (
          <Button variant="outline" size="xs" disabled={busy} onClick={() => run("retry", () => retryItem(item.id))}>
            <RotateCwIcon />
            Retry
          </Button>
        )}
        {item.etsyListingId && !job.dryRun && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  nativeButton={false}
                  render={<a href={etsyListingUrl(item.etsyListingId)} target="_blank" rel="noreferrer" />}
                  aria-label="Open on Etsy"
                />
              }
            >
              <ExternalLinkIcon />
            </TooltipTrigger>
            <TooltipContent>Open on Etsy</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-xs" aria-label="Details" onClick={() => setDetails(true)} />}
          >
            <FileSearchIcon />
          </TooltipTrigger>
          <TooltipContent>Stages, files{job.dryRun ? " and what would be sent" : ""}</TooltipContent>
        </Tooltip>
        {cancellable && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Take it out of the upload"
                  disabled={busy}
                  onClick={() => run("cancel it", () => cancelItem(item.id))}
                  className="text-muted-foreground"
                />
              }
            >
              <XIcon />
            </TooltipTrigger>
            <TooltipContent>Take it out of the upload</TooltipContent>
          </Tooltip>
        )}
      </div>
      <ItemDetails
        open={details}
        onOpenChange={setDetails}
        item={item}
        job={job}
        title={title}
        poster={poster}
        accountName={accountName}
      />
    </li>
  )
}

// --- What an item did ---

function ItemDetails({
  open,
  onOpenChange,
  item,
  job,
  title,
  poster,
  accountName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: JobItem
  job: UploadJob
  title: string
  poster: GroupPoster | undefined
  accountName: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-2xl">
        {/* min-w-0: a long title would otherwise widen the dialog's grid past its frame. */}
        <DialogHeader className="min-w-0 flex-row items-center gap-3 border-b p-4 pr-12">
          {poster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster.thumb} alt="" className="h-12 shrink-0 rounded-sm bg-muted object-cover ring-1 ring-foreground/10" />
          )}
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle className="truncate leading-snug">{title}</DialogTitle>
            <DialogDescription className="truncate">
              {accountName}
              {job.dryRun && " · test run"} · {lineOf(item, job)}
            </DialogDescription>
          </div>
        </DialogHeader>
        {open && <Details item={item} job={job} />}
      </DialogContent>
    </Dialog>
  )
}

function Details({ item, job }: { item: JobItem; job: UploadJob }) {
  // The item as the list has it, until the full one (with what would be sent) is read.
  const [full, setFull] = React.useState<JobItem | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const shown = full ?? item

  React.useEffect(() => {
    let live = true
    fetch(`/api/pipeline/items/${item.id}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.error ?? response.statusText)
        if (live) setFull(result as JobItem)
      })
      .catch((e) => live && setError((e as Error).message))
    return () => {
      live = false
    }
  }, [item.id, item.updatedAt])

  const stages = stagesOf(shown)
  const at = stages.indexOf(shown.stage)
  const payloads = Object.entries(shown.payloads ?? {})

  return (
    <div className="flex max-h-[min(75svh,48rem)] min-w-0 flex-col gap-5 overflow-y-auto p-4">
      <ol className="flex flex-col gap-1.5" aria-label="Stages">
        {stages.map((stage, index) => {
          const done = shown.done[stage]
          const current = index === at && shown.status !== "done"
          const state = done || index < at || shown.status === "done" ? "done" : current ? shown.status : "todo"
          return (
            <li key={stage} className="grid grid-cols-[1rem_8.5rem_1fr_auto] items-start gap-2 text-sm">
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-2 rounded-full",
                  state === "done"
                    ? "bg-emerald-500"
                    : state === "failed"
                      ? "bg-destructive"
                      : state === "waiting"
                        ? "bg-amber-500"
                        : state === "running"
                          ? "bg-foreground/70"
                          : "bg-muted"
                )}
              />
              <span className={cn(state === "todo" && "text-muted-foreground")}>{STAGE_LABEL[stage]}</span>
              <span
                className={cn(
                  "min-w-0 text-xs break-words",
                  state === "failed" ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {current && shown.status === "failed"
                  ? shown.error
                  : current && shown.status === "waiting"
                    ? shown.note
                    : done?.note}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">{done ? clock(done.at) : ""}</span>
            </li>
          )
        })}
      </ol>

      {(shown.gelatoProductId || shown.etsyListingId) && (
        <dl className="grid grid-cols-[8.5rem_1fr] gap-x-2 gap-y-1 text-xs">
          {shown.gelatoProductId && (
            <>
              <dt className="text-muted-foreground">Gelato product</dt>
              <dd className="font-mono">{shown.gelatoProductId}</dd>
            </>
          )}
          {shown.etsyListingId && (
            <>
              <dt className="text-muted-foreground">Etsy listing</dt>
              <dd>
                <a
                  href={etsyListingUrl(shown.etsyListingId)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono underline-offset-2 [@media(hover:hover)]:hover:underline [&_svg]:size-3"
                >
                  {shown.etsyListingId}
                  <ExternalLinkIcon />
                </a>
                {shown.imageIds && (
                  <span className="text-muted-foreground"> · {plural(shown.imageIds.length, "photo")}</span>
                )}
                {shown.videoId && <span className="text-muted-foreground"> · video</span>}
              </dd>
            </>
          )}
        </dl>
      )}

      {shown.media && shown.media.photos.length > 0 && (
        <section aria-label="Listing photos" className="flex flex-col gap-2">
          <h3 className="text-xs font-medium">
            Listing photos <span className="font-normal text-muted-foreground">· {shown.media.photos.length}</span>
          </h3>
          <ul className="grid grid-cols-5 gap-1.5">
            {shown.media.photos.map((photo, i) => (
              <li key={photo}>
                <a
                  href={itemFile(shown, photo)}
                  target="_blank"
                  rel="noreferrer"
                  className="block aspect-square overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  aria-label={`Photo ${i + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={itemFile(shown, photo)} alt="" loading="lazy" className="size-full object-cover" />
                </a>
              </li>
            ))}
          </ul>
          {shown.media.video && (
            <a
              href={itemFile(shown, shown.media.video)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 self-start text-xs underline-offset-2 [@media(hover:hover)]:hover:underline [&_svg]:size-3"
            >
              The video
              <ExternalLinkIcon />
            </a>
          )}
        </section>
      )}

      {shown.printFiles && shown.printFiles.length > 0 && (
        <section aria-label="Print files" className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium">Print files</h3>
          <ul className="flex flex-col divide-y text-xs">
            {shown.printFiles.map((f) => (
              <li key={f.bandId} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">{f.sizes.map((s) => SIZE_BY_KEY[s]?.cm ?? s).join(", ")}</span>
                <span className="text-muted-foreground tabular-nums">
                  {f.width}×{f.height} · {f.fit === "exact" ? "fits" : f.fit === "crop" ? "cropped" : "extended"}
                </span>
                <a
                  href={itemFile(shown, f.file)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-2 [@media(hover:hover)]:hover:underline"
                >
                  Open
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {job.dryRun && (
        <section aria-label="What would be sent" className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium">What would be sent</h3>
          {full === null && !error ? (
            <Skeleton className="h-16" />
          ) : payloads.length === 0 ? (
            <p className="text-xs text-muted-foreground">{error ? `Couldn't read it: ${error}` : "Nothing yet."}</p>
          ) : (
            payloads.map(([name, body]) => (
              <Collapsible key={name} className="group/payload flex flex-col">
                <CollapsibleTrigger className="flex items-center gap-1.5 rounded-sm py-1 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:underline">
                  <ChevronDownIcon className="size-3.5 text-muted-foreground transition-transform duration-200 ease-out-strong group-data-open/payload:rotate-180 motion-reduce:transition-none" />
                  <span className="font-mono">{name}</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out-strong data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
                  <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed">
                    {JSON.stringify(body, null, 2)}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            ))
          )}
        </section>
      )}
      {!job.dryRun && error && <p className="text-xs text-muted-foreground">Couldn&apos;t read the details: {error}</p>}
    </div>
  )
}
