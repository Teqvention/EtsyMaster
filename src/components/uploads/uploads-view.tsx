"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import { ArrowRightIcon, LibraryBigIcon, LoaderCircleIcon, PackageCheckIcon, PenLineIcon } from "lucide-react"
import { toast } from "sonner"

import { DraftRow, STATUS_LABELS } from "@/components/uploads/draft-row"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { createDrafts, isWriting, useUploads } from "@/hooks/use-uploads"
import type { DraftStatus, UploadsState, WaitingPoster } from "@/lib/uploads/types"

// The last step of the pipeline: approved posters get their Etsy listing.
// The copywriter writes title, tags and description for each in the
// background; here they're checked, edited, exported with their mockup chain
// as one package, and moved from Drafts to Ready to Uploaded.

const STATUSES = Object.keys(STATUS_LABELS) as DraftStatus[]
const TAB_LABELS: Record<DraftStatus, string> = { draft: "Drafts", ready: "Ready", uploaded: "Uploaded" }

export function UploadsView() {
  const state = useUploads()
  const [status, setStatus] = useStatus()

  if (!state) return <Loading />

  if (state.drafts.length === 0 && state.waiting.length === 0) {
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
              written here.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link href="/generation?review=pending" />}>
              Review posters
              <ArrowRightIcon />
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  const counts = Object.fromEntries(STATUSES.map((s) => [s, state.drafts.filter((d) => d.status === s).length]))
  const visible = state.drafts.filter((d) => d.status === status)

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <Pipeline state={state} />

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

      {visible.length === 0 ? (
        <Empty className="min-h-[30svh] border border-dashed">
          <EmptyHeader>
            <EmptyTitle>{EMPTY[status].title}</EmptyTitle>
            <EmptyDescription>{EMPTY[status].description}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="flex flex-col divide-y">
          {visible.map((draft) => (
            <li key={draft.id} className="py-5 first:pt-1">
              <DraftRow draft={draft} chains={state.chains} />
            </li>
          ))}
        </ol>
      )}
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

/** The open tab, kept in `?status=` (absent for drafts) so a reload or link lands on it. */
function useStatus() {
  const param = useSearchParams().get("status")
  const status: DraftStatus = STATUSES.includes(param as DraftStatus) ? (param as DraftStatus) : "draft"
  const setStatus = React.useCallback((next: DraftStatus) => {
    const params = new URLSearchParams(window.location.search)
    if (next === "draft") params.delete("status")
    else params.set("status", next)
    const query = params.toString()
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
  }, [])
  return [status, setStatus] as const
}

// --- What's waiting, and what the copy learns from ---

function Pipeline({ state }: { state: UploadsState }) {
  const [busy, setBusy] = React.useState(false)
  const writing = state.drafts.filter(isWriting).length
  const { waiting, library } = state

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
        <Button size="lg" onClick={writeAll} disabled={busy} className="shrink-0 transition-transform duration-150 ease-out-strong active:scale-[0.97] motion-reduce:transition-none">
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
