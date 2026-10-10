"use client"

import * as React from "react"
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleSlashIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
  RotateCwIcon,
  TrashIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { changeAction, removeAction } from "@/hooks/use-artikel"
import { formatNumber } from "@/lib/etsy/format"
import type { ActionItem, ActionView } from "@/lib/artikel/types"
import { cn } from "@/lib/utils"

import { ago, plural } from "./shared"

// The bulk actions: each with a bar of its listings (done, failed, skipped,
// still to go), why it waits when it does, and listing by listing what
// happened. Finished ones fold away under the open ones.

const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

export function ActionsPanel({ actions }: { actions: ActionView[] }) {
  const [showFinished, setShowFinished] = React.useState(false)
  const open = actions.filter((a) => a.status !== "done" && a.status !== "cancelled")
  const finished = actions.filter((a) => a.status === "done" || a.status === "cancelled")
  if (!actions.length) return null
  return (
    <section aria-labelledby="bulk-actions" className="flex flex-col rounded-lg border">
      <div className="flex min-h-9 items-center justify-between gap-2 px-3 pt-1">
        <h2 id="bulk-actions" className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Bulk actions
        </h2>
        {finished.length > 0 && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setShowFinished(!showFinished)}>
            {showFinished ? "Hide finished" : `Finished (${finished.length})`}
          </Button>
        )}
      </div>
      <ol className="flex flex-col divide-y">
        {[...open, ...(showFinished ? finished : [])].map((action) => (
          <ActionRow key={action.id} action={action} />
        ))}
        {!open.length && !showFinished && (
          <li className="px-3 pb-3 text-xs text-muted-foreground">
            Nothing running. The last one: {finished[0].label} · {finished[0].target}, {ago(finished[0].finishedAt ?? finished[0].updatedAt)}.
          </li>
        )}
      </ol>
    </section>
  )
}

function StatusIcon({ action }: { action: ActionView }) {
  const className = "size-4 shrink-0"
  if (action.status === "done") {
    return action.counts.failed ? (
      <CircleCheckIcon className={cn(className, "text-amber-600 dark:text-amber-400")} />
    ) : (
      <CircleCheckIcon className={cn(className, "text-emerald-600 dark:text-emerald-400")} />
    )
  }
  if (action.status === "cancelled") return <CircleSlashIcon className={cn(className, "text-muted-foreground")} />
  if (action.status === "paused" || action.wakeAt) return <PauseIcon className={cn(className, "text-amber-600 dark:text-amber-400")} />
  return <LoaderCircleIcon className={cn(className, "animate-spin text-muted-foreground motion-reduce:animate-none")} />
}

function lineOf(action: ActionView) {
  const c = action.counts
  const parts = [
    `${formatNumber(c.done)} of ${formatNumber(action.total - c.skipped)} done`,
    c.failed && `${formatNumber(c.failed)} failed`,
    c.skipped && `${formatNumber(c.skipped)} left as they were`,
  ].filter(Boolean)
  if (action.status === "paused") parts.push("paused")
  else if (action.note) parts.push(`${action.note}${action.wakeAt ? `, again at ${clock(action.wakeAt)}` : ""}`)
  return parts.join(" · ")
}

function ActionRow({ action }: { action: ActionView }) {
  const [expanded, setExpanded] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const c = action.counts
  const going = action.status === "queued" || action.status === "running"

  async function run(what: string, work: () => Promise<unknown>) {
    setBusy(true)
    try {
      await work()
    } catch (error) {
      toast.error(`Couldn't ${what}: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <StatusIcon action={action} />
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none",
              expanded && "rotate-90"
            )}
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm">
              <span className="font-medium">{action.label}</span>
              <span className="text-muted-foreground"> · {action.target}</span>
            </span>
            <span className="truncate text-xs text-muted-foreground tabular-nums">{lineOf(action)}</span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {going && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy} onClick={() => run("pause it", () => changeAction(action.id, { status: "paused" }))}>
              <PauseIcon />
              Pause
            </Button>
          )}
          {action.status === "paused" && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => run("go on", () => changeAction(action.id, { status: "running" }))}>
              <PlayIcon />
              Go on
            </Button>
          )}
          {c.failed > 0 && action.status !== "cancelled" && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => run("try again", () => changeAction(action.id, { retry: true }))}>
              <RotateCwIcon />
              Retry {formatNumber(c.failed)}
            </Button>
          )}
          {(going || action.status === "paused") && (
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Cancel what's left" title="Cancel what's left" disabled={busy} onClick={() => run("cancel it", () => changeAction(action.id, { status: "cancelled" }))}>
              <XIcon />
            </Button>
          )}
          {!going && (
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Remove from the list" title="Remove from the list" disabled={busy} onClick={() => run("remove it", () => removeAction(action.id))}>
              <TrashIcon />
            </Button>
          )}
        </div>
      </div>
      <Bar action={action} />
      {expanded && <Results action={action} />}
    </li>
  )
}

function Bar({ action }: { action: ActionView }) {
  const c = action.counts
  const going = action.status === "running" && !action.wakeAt
  const parts = [
    { key: "done", n: c.done, className: "bg-emerald-500" },
    { key: "running", n: c.running, className: "relative overflow-hidden bg-foreground/60" },
    { key: "failed", n: c.failed, className: "bg-destructive" },
    { key: "queued", n: c.queued, className: action.wakeAt || action.status === "paused" ? "bg-amber-500/40" : "bg-muted-foreground/15" },
    { key: "skipped", n: c.skipped, className: "bg-muted-foreground/10" },
  ].filter((p) => p.n > 0)
  return (
    <div
      role="progressbar"
      aria-label="Listings done"
      aria-valuemin={0}
      aria-valuemax={action.total - c.skipped}
      aria-valuenow={c.done}
      className="mx-3 mb-2.5 flex h-1.5 gap-px overflow-hidden rounded-full bg-muted"
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

function Results({ action }: { action: ActionView }) {
  const failedIds = new Set(action.failed.map((i) => i.listingId))
  const items: ActionItem[] = [...action.failed, ...action.recent.filter((i) => !failedIds.has(i.listingId))]
  return (
    <div className="mx-3 mb-3 flex flex-col gap-2 rounded-md bg-muted/40 p-2 text-xs">
      {items.length === 0 && action.skips.length === 0 && <p className="text-muted-foreground">Nothing done yet.</p>}
      {items.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={`${item.listingId}-${item.status}`} className="flex min-w-0 items-baseline gap-2">
              <span
                className={cn(
                  "size-1.5 shrink-0 translate-y-[-1px] rounded-full",
                  item.status === "failed" ? "bg-destructive" : item.status === "running" ? "bg-foreground/60" : "bg-emerald-500"
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              <span className={cn("shrink-0 tabular-nums", item.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                {item.status === "running" ? "at work…" : item.status === "failed" ? item.error : item.result}
              </span>
            </li>
          ))}
        </ul>
      )}
      {action.skips.length > 0 && (
        <p className="text-muted-foreground">
          Left as they were: {action.skips.map((s) => `${s.reason} (${formatNumber(s.count)})`).join(" · ")}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Queued {ago(action.createdAt)} · {plural(action.total, "listing")}
        {action.finishedAt && ` · finished ${ago(action.finishedAt)}`}
      </p>
    </div>
  )
}
