"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import {
  ArrowRightIcon,
  LibraryBigIcon,
  LoaderCircleIcon,
  PackageCheckIcon,
  PenLineIcon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"

import { DraftRow, STATUS_LABELS } from "@/components/uploads/draft-row"
import { countGroup, GroupRail } from "@/components/uploads/group-rail"
import { JobsPanel } from "@/components/uploads/jobs-panel"
import { RemovedLog } from "@/components/uploads/removed-log"
import { UploadDialog } from "@/components/uploads/upload-dialog"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Kbd } from "@/components/ui/kbd"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { uploadAccounts, useAccounts, type AccountsState } from "@/hooks/use-accounts"
import { usePipeline } from "@/hooks/use-pipeline"
import { createDrafts, isWriting, refreshUploads, rewriteDraft, useUploads } from "@/hooks/use-uploads"
import { formatNumber } from "@/lib/etsy/format"
import { canUpload, isFinished, posterKey, statusOf, uploadsByPoster, type PosterUploads } from "@/lib/uploads/groups"
import type { DraftStatus, UploadGroup, UploadsState, WaitingPoster } from "@/lib/uploads/types"
import { cn } from "@/lib/utils"

// The last step of the pipeline: approved posters become Etsy listings. At
// the top the one click that uploads them, spread over the upload accounts,
// and the uploads under way. The copywriter writes title, tags and
// description for each poster in the background; below, the drafts are
// checked and edited, narrowed to one reference photo's posters if wanted,
// and moved from Drafts to Ready to Uploaded.

const STATUSES = Object.keys(STATUS_LABELS) as DraftStatus[]
const TAB_LABELS: Record<DraftStatus, string> = { draft: "Drafts", ready: "Ready", uploaded: "Uploaded" }

export function UploadsView() {
  const state = useUploads()
  const { pipeline, available } = usePipeline()
  const accounts = useAccounts()
  const [status, setStatus] = useStatus()
  const [group, setGroup] = useParam("group")
  // `?upload` opens the upload dialog: empty for everything, or a group id or poster key.
  const [upload, setUpload] = useParam("upload")
  const uploads = React.useMemo(() => uploadsByPoster(pipeline), [pipeline])
  const posters = React.useMemo(
    () => new Map(state?.groups.flatMap((g) => g.posters.map((p) => [posterKey(g.id, p.outputId), p] as const))),
    [state?.groups]
  )

  // A poster that's done (or failed) may have changed its draft: read them again.
  const finished = pipeline?.items.filter(isFinished).length ?? 0
  React.useEffect(() => {
    if (finished > 0) refreshUploads()
  }, [finished])

  // U opens the upload dialog; Esc shows every reference photo's drafts again.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement
      if (target.closest("input, textarea, select, [contenteditable], [role=menu], [role=listbox], [role=dialog]")) return
      if (event.key === "u" && upload === null) {
        event.preventDefault()
        setUpload("")
      } else if (event.key === "Escape" && group !== null && upload === null) {
        event.preventDefault()
        setGroup(null)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [upload, group, setUpload, setGroup])

  if (!state) return <Loading />

  if (state.drafts.length === 0 && state.waiting.length === 0 && !pipeline?.jobs.length) {
    return (
      <div className="flex flex-col gap-4 px-4 lg:px-6">
        <Empty className="min-h-[60svh] border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageCheckIcon />
            </EmptyMedia>
            <EmptyTitle>No approved posters yet</EmptyTitle>
            <EmptyDescription>
              Approve the posters you&apos;d sell on Generation. Each one gets its Etsy title, tags and description
              written here, and goes up to the shops in one click.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link href="/generation?review=pending" />}>
              Review posters
              <ArrowRightIcon />
            </Button>
            <RemovedLog removed={state.removed} />
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  // A group that's gone (all its drafts deleted) shows everything again.
  const shownGroup = group && state.groups.some((g) => g.id === group) ? group : null
  const inGroup = state.drafts.filter((d) => !shownGroup || d.generationId === shownGroup)
  const counts = Object.fromEntries(STATUSES.map((s) => [s, inGroup.filter((d) => d.status === s).length]))
  const visible = inGroup.filter((d) => d.status === status)
  const accountName = (id: string) => {
    const account = accounts?.accounts.find((a) => a.id === id)
    return account ? (account.shop?.name ?? account.label) : id
  }

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <Launch
        groups={state.groups}
        uploads={uploads}
        accounts={accounts}
        available={available}
        blockers={pipeline?.blockers ?? []}
        onUpload={() => setUpload("")}
      />

      {pipeline && pipeline.jobs.length > 0 && (
        <JobsPanel pipeline={pipeline} posters={posters} accountName={accountName} />
      )}

      <Waiting state={state} />

      <div
        className={cn(
          "flex flex-col gap-4",
          state.groups.length > 1 && "@5xl/main:grid @5xl/main:grid-cols-[15rem_minmax(0,1fr)] @5xl/main:items-start @5xl/main:gap-6"
        )}
      >
        {state.groups.length > 1 && (
          <aside className="min-w-0 @5xl/main:sticky @5xl/main:top-0">
            <GroupRail
              groups={state.groups}
              uploads={uploads}
              selected={shownGroup}
              onSelect={setGroup}
              onUpload={(id) => setUpload(id)}
            />
          </aside>
        )}

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <Tabs value={status} onValueChange={(value) => setStatus(value as DraftStatus)}>
              <TabsList>
                {STATUSES.map((s) => (
                  <TabsTrigger key={s} value={s} className="px-3">
                    {TAB_LABELS[s]}
                    <span className="min-w-3 text-xs text-muted-foreground tabular-nums">{counts[s]}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <RemovedLog removed={state.removed} />
          </div>

          {visible.length === 0 ? (
            <Empty className="min-h-[30svh] border border-dashed">
              <EmptyHeader>
                <EmptyTitle>{EMPTY[status].title}</EmptyTitle>
                <EmptyDescription>
                  {shownGroup ? "None from this reference photo. " : ""}
                  {EMPTY[status].description}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ol className="flex flex-col divide-y">
              {visible.map((draft) => {
                const key = posterKey(draft.generationId, draft.outputId)
                const stands = posters.get(key)?.state ?? (draft.status === "uploaded" ? "uploaded" : "draft")
                return (
                  <li key={draft.id} className="py-5 first:pt-1">
                    <DraftRow
                      draft={draft}
                      chains={state.chains}
                      upload={uploads.real.get(key)}
                      uploadStatus={statusOf(uploads, key, stands)}
                      uploadable={canUpload(uploads, key, stands)}
                      onUpload={() => setUpload(key)}
                    />
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>

      <UploadDialog
        open={upload !== null}
        onOpenChange={(open) => !open && setUpload(null)}
        groups={state.groups}
        chains={state.chains}
        uploads={uploads}
        start={upload || null}
      />
    </div>
  )
}

const EMPTY: Record<DraftStatus, { title: string; description: string }> = {
  draft: {
    title: "No drafts",
    description: "Write listings for the approved posters above, or check Ready.",
  },
  ready: {
    title: "Nothing ready yet",
    description: "Mark a draft Ready once its title, tags and mockups look right.",
  },
  uploaded: {
    title: "Nothing uploaded yet",
    description: "Mark a listing Uploaded once it's live on Etsy.",
  },
}

/** A search param kept in the address, so a reload or link lands on the same view. */
function useParam(name: string) {
  const value = useSearchParams().get(name)
  const setValue = React.useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(window.location.search)
      if (next === null) params.delete(name)
      else params.set(name, next)
      const query = params.toString()
      window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
    },
    [name]
  )
  return [value, setValue] as const
}

/** The open tab, kept in `?status=` (absent for drafts). */
function useStatus() {
  const [param, setParam] = useParam("status")
  const status: DraftStatus = STATUSES.includes(param as DraftStatus) ? (param as DraftStatus) : "draft"
  const setStatus = React.useCallback((next: DraftStatus) => setParam(next === "draft" ? null : next), [setParam])
  return [status, setStatus] as const
}

// --- The one click ---

function Launch({
  groups,
  uploads,
  accounts,
  available,
  blockers,
  onUpload,
}: {
  groups: UploadGroup[]
  uploads: PosterUploads
  accounts: AccountsState | null
  available: boolean
  blockers: string[]
  onUpload: () => void
}) {
  const counts = groups.map((g) => countGroup(g, uploads))
  const toGo = counts.reduce((sum, c) => sum + c.toGo, 0)
  const from = counts.filter((c) => c.toGo > 0).length
  const shops = uploadAccounts(accounts)
  const ready = shops.filter((a) => a.missing.length === 0)

  return (
    <section
      aria-label="Upload to Etsy"
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm">
          <span className="font-medium">
            {toGo > 0 ? `${formatNumber(toGo)} poster${toGo === 1 ? "" : "s"} to upload` : "Nothing left to upload"}
          </span>
          {toGo > 0 && (
            <span className="text-muted-foreground">
              {" "}
              · from {formatNumber(from)} reference photo{from === 1 ? "" : "s"}
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          {accounts === null ? (
            <Skeleton className="h-4 w-56" />
          ) : shops.length === 0 ? (
            <span>
              No upload accounts yet ·{" "}
              <Link href="/settings" className="underline underline-offset-2 [@media(hover:hover)]:hover:text-foreground">
                add them in Settings
              </Link>
            </span>
          ) : (
            <>
              <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {shops.map((a) => (
                  <li key={a.id}>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Link
                            href="/settings"
                            className="inline-flex items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:text-foreground"
                          />
                        }
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "size-1.5 rounded-full",
                            a.missing.length ? "bg-amber-500" : "bg-emerald-500"
                          )}
                        />
                        {a.shop?.name ?? a.label}
                      </TooltipTrigger>
                      <TooltipContent className="max-w-72">
                        {a.missing.length
                          ? `Test runs only. Still to do in Settings: ${a.missing.join(", ")}`
                          : "Ready for live uploads"}
                      </TooltipContent>
                    </Tooltip>
                  </li>
                ))}
              </ul>
              <span aria-hidden>·</span>
              <span>
                {ready.length === 0
                  ? "No shop is set up for live uploads yet: test runs only"
                  : ready.length < shops.length
                    ? `${ready.length} of ${shops.length} shops ready for live uploads`
                    : "Every shop is ready"}
              </span>
            </>
          )}
        </div>
        {(!available || blockers.length > 0) && (
          <ul className="flex flex-col gap-1 text-xs text-amber-600 dark:text-amber-400">
            {!available && (
              <li className="flex items-start gap-1.5 [&>svg]:mt-px [&>svg]:size-3.5 [&>svg]:shrink-0">
                <TriangleAlertIcon />
                The upload pipeline isn&apos;t running on the server yet
              </li>
            )}
            {blockers.map((b) => (
              <li key={b} className="flex items-start gap-1.5 [&>svg]:mt-px [&>svg]:size-3.5 [&>svg]:shrink-0">
                <TriangleAlertIcon />
                {b}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button
        size="lg"
        onClick={onUpload}
        disabled={toGo === 0}
        className="shrink-0 transition-transform duration-150 ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
      >
        <UploadIcon />
        Upload {toGo > 0 ? formatNumber(toGo) : ""}…
        <Kbd className="bg-primary-foreground/15 text-primary-foreground">U</Kbd>
      </Button>
    </section>
  )
}

// --- What's waiting, and what the copy learns from ---

function Waiting({ state }: { state: UploadsState }) {
  const [busy, setBusy] = React.useState(false)
  const writing = state.drafts.filter(isWriting).length
  const { waiting, library } = state
  // Copy from before the copywriter learned to vary its titles and stories
  // carries no `form`; uploaded listings keep theirs.
  const older = state.drafts.filter((d) => d.copy === "done" && !d.form && d.status !== "uploaded")

  async function rewriteOlder() {
    setBusy(true)
    try {
      for (const draft of older) await rewriteDraft(draft.id)
      toast(`Rewriting ${older.length} listing${older.length === 1 ? "" : "s"}`, {
        description: "Two at a time, with the current copywriter. They fill in below as they're done.",
      })
    } catch (error) {
      toast.error(`Couldn't start: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function writeAll() {
    setBusy(true)
    try {
      const count = waiting.length
      await createDrafts({ all: true })
      toast(`Writing ${count} listing${count === 1 ? "" : "s"}`, {
        description: "Two at a time — they fill in below as they're done.",
      })
    } catch (error) {
      toast.error(`Couldn't start: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label="Waiting for a listing"
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-sm font-medium">
            {waiting.length > 0
              ? `${waiting.length} approved poster${waiting.length === 1 ? "" : "s"} waiting for a listing`
              : "Every approved poster has a listing"}
          </p>
          {writing > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums [&_svg]:size-3">
              <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
              Writing {writing}
            </span>
          )}
        </div>
        {waiting.length > 0 && <WaitingStrip posters={waiting} />}
        {older.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0">
            <PenLineIcon />
            <span>
              {older.length} listing{older.length === 1 ? " still has its" : "s still have their"} copy from the earlier
              copywriter.
            </span>
            <button
              type="button"
              onClick={rewriteOlder}
              disabled={busy}
              className="font-medium text-foreground underline-offset-2 disabled:opacity-50 [@media(hover:hover)]:hover:underline"
            >
              Rewrite {older.length === 1 ? "it" : `all ${older.length}`}
            </button>
          </p>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0">
          <LibraryBigIcon />
          {library.listings > 0 ? (
            <span>
              Copy learns from{" "}
              <Link href="/keywords" className="underline-offset-2 [@media(hover:hover)]:hover:text-foreground [@media(hover:hover)]:hover:underline">
                {library.shops} shop{library.shops === 1 ? "" : "s"} · {library.listings.toLocaleString()} listings ·{" "}
                {library.keywords.toLocaleString()} keywords
              </Link>{" "}
              in the library, and keeps about 70 % of each source listing&apos;s wording.
            </span>
          ) : (
            <span>
              The keyword library is empty —{" "}
              <Link href="/keywords" className="underline underline-offset-2 [@media(hover:hover)]:hover:text-foreground">
                add top-selling shops
              </Link>{" "}
              so titles and tags learn from what sells.
            </span>
          )}
        </p>
      </div>
      {waiting.length > 0 ? (
        <Button
          variant="outline"
          onClick={writeAll}
          disabled={busy}
          className="shrink-0 transition-transform duration-150 ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
        >
          {busy ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <PenLineIcon />}
          Write listings for {waiting.length} approved
        </Button>
      ) : (
        <Button
          variant="outline"
          className="shrink-0"
          nativeButton={false}
          render={<Link href="/generation?review=pending" />}
        >
          Review more posters
          <ArrowRightIcon />
        </Button>
      )}
    </section>
  )
}

const STRIP = 14

function WaitingStrip({ posters }: { posters: WaitingPoster[] }) {
  const more = posters.length - STRIP
  return (
    <ul className="flex flex-wrap gap-1.5">
      {posters.slice(0, STRIP).map((p) => (
        <li key={`${p.generationId}/${p.outputId}`}>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`Write the listing for ${p.designTitle ?? p.sourceTitle}`}
                  onClick={() =>
                    createDrafts({ generationId: p.generationId, outputId: p.outputId }).catch((error) =>
                      toast.error(`Couldn't start: ${error.message}`)
                    )
                  }
                  className="block h-14 overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10 transition-transform duration-150 ease-out-strong outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] motion-reduce:transition-none"
                  style={{ aspectRatio: p.posterWidth && p.posterHeight ? `${p.posterWidth} / ${p.posterHeight}` : "2 / 3" }}
                />
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.poster} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              <span className="font-medium">{p.designTitle ?? p.folder}</span>
              <span className="block opacity-70">From: {p.sourceTitle}</span>
              <span className="block opacity-70">Click to write just this one</span>
            </TooltipContent>
          </Tooltip>
        </li>
      ))}
      {more > 0 && (
        <li className="grid h-14 place-items-center rounded-md bg-muted px-2.5 text-xs text-muted-foreground tabular-nums">
          +{more}
        </li>
      )}
    </ul>
  )
}

function Loading() {
  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6" aria-busy aria-label="Loading uploads">
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-8 w-64" />
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="grid grid-cols-[5.5rem_1fr] gap-3 py-5 @2xl/main:grid-cols-[9rem_1fr] @2xl/main:gap-4">
          <Skeleton className="aspect-[2/3]" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-5 w-11/12" />
            <Skeleton className="h-16" />
          </div>
        </div>
      ))}
    </div>
  )
}
