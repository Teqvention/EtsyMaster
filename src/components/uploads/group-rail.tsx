"use client"

import * as React from "react"
import { LayersIcon, UploadIcon } from "lucide-react"

import { shortTitle } from "@/components/generation/parts"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatNumber } from "@/lib/etsy/format"
import { describeFolder } from "@/lib/saved/folders"
import { canUpload, posterKey, statusOf, type PosterUploads } from "@/lib/uploads/groups"
import type { UploadGroup } from "@/lib/uploads/types"
import { cn } from "@/lib/utils"

// The reference photos the approved posters were drawn from, each with how
// far its posters have come: live, uploading, failed, still to go. Picking
// one narrows the drafts below to its posters; ↑ ↓ walk the list, Esc shows
// all again.

const STRIP = 6

export type GroupCounts = { total: number; live: number; uploading: number; failed: number; toGo: number }

export function countGroup(group: UploadGroup, uploads: PosterUploads): GroupCounts {
  const counts: GroupCounts = { total: group.posters.length, live: 0, uploading: 0, failed: 0, toGo: 0 }
  for (const p of group.posters) {
    const key = posterKey(group.id, p.outputId)
    const status = statusOf(uploads, key, p.state)
    if (status === "live") counts.live++
    else if (status === "uploading") counts.uploading++
    else if (status === "failed") counts.failed++
    else if (canUpload(uploads, key, p)) counts.toGo++
  }
  return counts
}

function summary({ total, live, uploading, failed, toGo }: GroupCounts) {
  if (live === total) return total === 1 ? "Live" : `All ${formatNumber(total)} live`
  return [
    live && `${formatNumber(live)} live`,
    uploading && `${formatNumber(uploading)} uploading`,
    failed && `${formatNumber(failed)} failed`,
    toGo && `${formatNumber(toGo)} to go`,
  ]
    .filter(Boolean)
    .join(" · ")
}

export function GroupRail({
  groups,
  uploads,
  selected,
  onSelect,
  onUpload,
}: {
  groups: UploadGroup[]
  uploads: PosterUploads
  selected: string | null
  onSelect: (group: string | null) => void
  onUpload: (group: string) => void
}) {
  const navRef = React.useRef<HTMLElement>(null)
  const counts = React.useMemo(() => new Map(groups.map((g) => [g.id, countGroup(g, uploads)])), [groups, uploads])
  const all = React.useMemo(() => {
    const sum: GroupCounts = { total: 0, live: 0, uploading: 0, failed: 0, toGo: 0 }
    for (const c of counts.values()) {
      for (const k of Object.keys(sum) as (keyof GroupCounts)[]) sum[k] += c[k]
    }
    return sum
  }, [counts])

  // ↑ ↓ (and ← → where the list runs sideways) move the pick along.
  function onKeyDown(event: React.KeyboardEvent) {
    const step =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0
    if (!step || event.metaKey || event.ctrlKey || event.altKey) return
    const ids = [null, ...groups.map((g) => g.id)]
    const next = ids[ids.indexOf(selected) + step]
    if (next === undefined) return
    event.preventDefault()
    onSelect(next)
    const id = next ?? ""
    requestAnimationFrame(() => {
      const item = navRef.current?.querySelector<HTMLElement>(`[data-group="${CSS.escape(id)}"]`)
      item?.focus()
      item?.scrollIntoView({ block: "nearest", inline: "nearest" })
    })
  }

  return (
    <nav
      ref={navRef}
      aria-label="Reference photos"
      onKeyDown={onKeyDown}
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] @5xl/main:mx-0 @5xl/main:flex-col @5xl/main:overflow-visible @5xl/main:px-0 [&::-webkit-scrollbar]:hidden"
    >
      <Item
        id=""
        current={selected === null}
        onSelect={() => onSelect(null)}
        image={
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
            <LayersIcon />
          </span>
        }
        title="All reference photos"
        meta={`${formatNumber(groups.length)} · ${formatNumber(all.total)} posters`}
        counts={all}
      />
      {groups.map((group) => {
        const c = counts.get(group.id)!
        return (
          <Item
            key={group.id}
            id={group.id}
            current={selected === group.id}
            onSelect={() => onSelect(group.id)}
            image={
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={group.image ?? group.posters[0]?.thumb}
                alt=""
                loading="lazy"
                draggable={false}
                className="size-10 shrink-0 rounded-md bg-muted object-cover ring-1 ring-foreground/10"
              />
            }
            title={shortTitle(group.source.title)}
            fullTitle={group.source.title}
            meta={`${describeFolder(group.folder)} · ${formatNumber(c.total)} poster${c.total === 1 ? "" : "s"}`}
            counts={c}
            strip={group.posters.map((p) => p.thumb)}
            action={
              c.toGo > 0 && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="secondary"
                        size="icon-xs"
                        aria-label={`Upload the posters of ${shortTitle(group.source.title)}`}
                        onClick={() => onUpload(group.id)}
                        className="shadow-xs"
                      />
                    }
                  >
                    <UploadIcon />
                  </TooltipTrigger>
                  <TooltipContent>Upload its {formatNumber(c.toGo)}…</TooltipContent>
                </Tooltip>
              )
            }
          />
        )
      })}
    </nav>
  )
}

function Item({
  id,
  current,
  onSelect,
  image,
  title,
  fullTitle,
  meta,
  counts,
  strip,
  action,
}: {
  /** The group's id, "" for all. */
  id: string
  current: boolean
  onSelect: () => void
  image: React.ReactNode
  title: string
  fullTitle?: string
  meta: string
  counts: GroupCounts
  strip?: string[]
  action?: React.ReactNode
}) {
  const more = (strip?.length ?? 0) - STRIP
  return (
    <div
      className={cn(
        "group/item relative flex w-60 shrink-0 flex-col gap-2 rounded-xl p-2 transition-colors duration-150 @5xl/main:w-auto",
        current ? "bg-muted" : "[@media(hover:hover)]:hover:bg-muted/50"
      )}
    >
      <button
        type="button"
        data-group={id}
        aria-current={current ? "true" : undefined}
        tabIndex={current ? 0 : -1}
        onClick={onSelect}
        title={fullTitle}
        // Stretched over the whole item, so the strip and bar click too.
        className="flex min-w-0 items-center gap-2.5 rounded-lg text-left outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
      >
        {image}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate text-sm", current && "font-medium")}>{title}</span>
          <span className="truncate text-xs text-muted-foreground">{meta}</span>
        </span>
      </button>

      <Progress counts={counts} />

      {strip && strip.length > 0 && (
        <ul aria-hidden className="hidden gap-1 @5xl/main:flex">
          {strip.slice(0, STRIP).map((src) => (
            <li key={src} className="h-9 overflow-hidden rounded-sm bg-muted ring-1 ring-foreground/5" style={{ aspectRatio: "3 / 4" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
            </li>
          ))}
          {more > 0 && (
            <li className="grid h-9 place-items-center rounded-sm bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">
              +{more}
            </li>
          )}
        </ul>
      )}

      {action && (
        <div className="absolute top-2 right-2 z-10 opacity-0 transition-opacity duration-150 group-focus-within/item:opacity-100 [@media(hover:hover)]:group-hover/item:opacity-100 [@media(hover:none)]:opacity-100">
          {action}
        </div>
      )}
    </div>
  )
}

/** Live, uploading, failed and to go as one bar, with the same in words. */
function Progress({ counts }: { counts: GroupCounts }) {
  const { total, live, uploading, failed, toGo } = counts
  const parts = [
    { n: live, className: "bg-emerald-500" },
    { n: uploading, className: "relative overflow-hidden bg-foreground/60", shimmer: true },
    { n: failed, className: "bg-destructive" },
    { n: toGo, className: "bg-muted-foreground/25" },
  ].filter((p) => p.n > 0)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-1 gap-px overflow-hidden rounded-full bg-muted" aria-hidden>
        {parts.map((p) => (
          <span
            key={p.className}
            className={cn("h-full transition-[flex-grow] duration-300 ease-out-strong motion-reduce:transition-none", p.className)}
            style={{ flexGrow: p.n }}
          >
            {p.shimmer && (
              <span className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-white/50 to-transparent motion-reduce:hidden" />
            )}
          </span>
        ))}
      </div>
      <span className="truncate text-[11px] text-muted-foreground tabular-nums">
        {total === 0 ? "No posters" : summary(counts) || "Nothing to upload"}
      </span>
    </div>
  )
}
