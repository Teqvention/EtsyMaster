"use client"

import { CircleAlertIcon, ExternalLinkIcon, LoaderCircleIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { STAGE_LABEL, STAGES, type JobItem } from "@/lib/pipeline/types"
import type { PosterStatus, PosterUpload } from "@/lib/uploads/groups"
import { cn } from "@/lib/utils"

// How far a poster's upload has come, in the shapes the page shows it: a
// badge on its draft, and eight steps in its job's list.

export const etsyListingUrl = (id: number) => `https://www.etsy.com/listing/${id}`

/** "14:05" */
export const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

/** Live, on its way or failed; nothing for a poster no real upload has touched. */
export function UploadBadge({ status, upload }: { status?: PosterStatus; upload?: PosterUpload }) {
  if (!upload) return null
  const { item, job } = upload
  if (status === "live") {
    const label = job.activate ? "Live" : "On Etsy, inactive"
    const className =
      "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 [a]:hover:bg-emerald-500/20"
    return item.etsyListingId ? (
      <Badge
        className={className}
        render={<a href={etsyListingUrl(item.etsyListingId)} target="_blank" rel="noreferrer" />}
      >
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        {label}
        <ExternalLinkIcon />
      </Badge>
    ) : (
      <Badge className={className}>
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        {label}
      </Badge>
    )
  }
  if (status === "uploading") {
    return (
      <Tooltip>
        <TooltipTrigger render={<Badge variant="outline" className="cursor-default text-muted-foreground" />}>
          <LoaderCircleIcon className={cn(item.status === "running" && "animate-spin motion-reduce:animate-none")} />
          Uploading · {STAGE_LABEL[item.stage]}
        </TooltipTrigger>
        <TooltipContent className="max-w-72">
          {item.status === "waiting"
            ? `${item.note ?? "Waiting"}${item.wakeAt ? `, again at ${clock(item.wakeAt)}` : ""}`
            : item.status === "queued" || job.status === "paused"
              ? "Waiting for its turn"
              : `${STAGE_LABEL[item.stage]}…`}
        </TooltipContent>
      </Tooltip>
    )
  }
  if (status === "failed") {
    return (
      <Tooltip>
        <TooltipTrigger render={<Badge variant="destructive" className="cursor-default" />}>
          <CircleAlertIcon />
          Upload failed
        </TooltipTrigger>
        <TooltipContent className="max-w-80">
          {STAGE_LABEL[item.stage]}: {item.error ?? "unknown error"}. Retry it in the upload above.
        </TooltipContent>
      </Tooltip>
    )
  }
  return null
}

type Step = "done" | "running" | "waiting" | "failed" | "cancelled" | "todo"

function stepOf(item: JobItem, index: number, at: number): Step {
  if (item.status === "done" || item.done[STAGES[index]] || index < at) return "done"
  if (index > at) return "todo"
  return item.status === "queued" ? "todo" : item.status
}

const STEP_TONE: Record<Step, string> = {
  done: "bg-emerald-500",
  running: "bg-foreground/70",
  waiting: "bg-amber-500",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground/30",
  todo: "bg-muted",
}

const STEP_WORD: Record<Step, string> = {
  done: "done",
  running: "at work",
  waiting: "waiting",
  failed: "failed",
  cancelled: "cancelled",
  todo: "",
}

/** The eight stages as a row of steps: green behind it, the current one at work, waiting or failed. */
export function StageSteps({ item, className }: { item: JobItem; className?: string }) {
  const at = STAGES.indexOf(item.stage)
  const steps = STAGES.map((stage, index) => ({ stage, step: stepOf(item, index, at) }))
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            role="img"
            aria-label={`${STAGE_LABEL[item.stage]}: ${STEP_WORD[steps[at]?.step ?? "todo"] || "not started"}`}
            className={cn("flex w-24 shrink-0 gap-0.5 py-1", className)}
          />
        }
      >
        {steps.map(({ stage, step }) => (
          <span
            key={stage}
            className={cn(
              "relative h-1.5 flex-1 overflow-hidden rounded-full transition-colors duration-300",
              STEP_TONE[step]
            )}
          >
            {step === "running" && (
              <span
                aria-hidden
                className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-white/50 to-transparent motion-reduce:hidden"
              />
            )}
          </span>
        ))}
      </TooltipTrigger>
      <TooltipContent className="flex-col items-stretch gap-0.5">
        {steps.map(({ stage, step }) => {
          const done = item.done[stage]
          return (
            <span key={stage} className={cn("flex gap-3", step === "todo" && "opacity-50")}>
              <span className="flex-1">{STAGE_LABEL[stage]}</span>
              <span className="tabular-nums opacity-70">
                {done ? clock(done.at) : STEP_WORD[step]}
              </span>
            </span>
          )
        })}
      </TooltipContent>
    </Tooltip>
  )
}
