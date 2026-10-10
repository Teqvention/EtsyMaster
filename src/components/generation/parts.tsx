"use client"

import type { useRouter } from "next/navigation"
import * as React from "react"
import { zipSync } from "fflate"
import { CheckIcon, LoaderCircleIcon, Trash2Icon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { generationFileUrl, isActive, reviewOutputs } from "@/hooks/use-generations"
import { download } from "@/lib/mockups/client"
import {
  CREATIVITY_LABEL,
  type Asset,
  type Creativity,
  type GenerationSet,
  type Output,
  type Review,
} from "@/lib/generation/types"
import { cn } from "@/lib/utils"

// Pieces the Generation list, a set's page and the compare viewer share.

const LEVEL: Record<Creativity, number> = { minimal: 1, subtle: 2, low: 3, medium: 4, high: 5 }

/** How far an image strays from its reference, as one to five bars. */
export function CreativityMeter({ level, className }: { level: Creativity; className?: string }) {
  const n = LEVEL[level]
  return (
    <span
      role="img"
      aria-label={`Creativity ${CREATIVITY_LABEL[level].toLowerCase()}`}
      title={`Creativity: ${CREATIVITY_LABEL[level]}`}
      className={cn("inline-flex items-end gap-px", className)}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn("w-[3px] rounded-full", i <= n ? "bg-brand" : "bg-foreground/15")}
          style={{ height: 2 + i * 2 }}
        />
      ))}
    </span>
  )
}

/** An image of a set, or what's happening to it while there is none yet. */
export function AssetImage({
  set,
  asset,
  working = "Drawing",
  alt = "",
  className,
  fit = "cover",
}: {
  set: GenerationSet
  asset: Asset
  working?: string
  alt?: string
  className?: string
  fit?: "cover" | "contain"
}) {
  if (asset.file && asset.status !== "error") {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={generationFileUrl(set.id, asset.file)}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={cn(
            "size-full transition-opacity duration-200 ease-out",
            fit === "cover" ? "object-cover" : "object-contain",
            asset.status === "running" && "opacity-40",
            className
          )}
        />
        {asset.status === "running" && <Working label={working} />}
      </>
    )
  }
  if (asset.status === "error") {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-1 bg-destructive/5 p-3 text-center">
        <XIcon className="size-4 text-destructive" />
        <p className="line-clamp-3 text-[11px] leading-snug text-muted-foreground">{asset.error ?? "Failed"}</p>
      </div>
    )
  }
  return (
    <div className="relative size-full overflow-hidden bg-muted">
      {asset.status === "running" && (
        <div className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-foreground/6 to-transparent motion-reduce:animate-none" />
      )}
      <Working label={asset.status === "running" ? working : "Waiting"} quiet={asset.status !== "running"} />
    </div>
  )
}

function Working({ label, quiet }: { label: string; quiet?: boolean }) {
  return (
    <span className="absolute inset-0 grid place-items-center">
      <span
        className={cn(
          "flex items-center gap-1.5 rounded-full bg-background/90 px-2 py-1 text-[11px] font-medium shadow-xs backdrop-blur-sm",
          quiet && "text-muted-foreground"
        )}
      >
        {!quiet && <LoaderCircleIcon className="size-3 animate-spin" />}
        {label}
      </span>
    </span>
  )
}

/** Approve / reject, one click each; clicking the active one undecides. */
export function ReviewButtons({
  set,
  output,
  size = "sm",
  onDecide,
  className,
}: {
  set: GenerationSet
  output: Output
  size?: "sm" | "lg"
  /** Takes over deciding, e.g. to move on to the next image too. */
  onDecide?: (review: Review) => void
  className?: string
}) {
  const disabled = output.status !== "done"
  const decide = (review: Review) =>
    onDecide
      ? onDecide(review)
      : reviewOutputs(set.id, [output.id], output.review === review ? null : review).catch((error) =>
          toast.error(`Couldn't save: ${(error as Error).message}`)
        )
  const big = size === "lg"
  if (big) {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        <Button
          variant="outline"
          size="sm"
          title="Reject (X)"
          aria-pressed={output.review === "rejected"}
          disabled={disabled}
          onClick={() => decide("rejected")}
          className={cn(
            "transition-[transform,background-color,color] duration-150 ease-out active:scale-[0.97]",
            output.review === "rejected" && "border-destructive bg-destructive text-white hover:bg-destructive/90 hover:text-white"
          )}
        >
          <XIcon />
          {output.review === "rejected" ? "Rejected" : "Reject"}
        </Button>
        <Button
          size="sm"
          title="Approve (A)"
          aria-pressed={output.review === "approved"}
          disabled={disabled}
          onClick={() => decide("approved")}
          className={cn(
            "min-w-24 transition-[transform,background-color] duration-150 ease-out active:scale-[0.97]",
            output.review === "approved" && "bg-emerald-600 text-white hover:bg-emerald-600/90 dark:bg-emerald-500"
          )}
        >
          <CheckIcon />
          {output.review === "approved" ? "Approved" : "Approve"}
        </Button>
      </div>
    )
  }
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        variant="secondary"
        size="icon-xs"
        aria-label="Reject"
        title="Reject (X)"
        aria-pressed={output.review === "rejected"}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          decide("rejected")
        }}
        className={cn(
          "bg-background/90 shadow-xs backdrop-blur-sm transition-[transform,background-color,color] duration-150 ease-out active:scale-95",
          output.review === "rejected" && "bg-destructive text-white hover:bg-destructive/90"
        )}
      >
        <XIcon />
      </Button>
      <Button
        variant="secondary"
        size="icon-xs"
        aria-label="Approve"
        title="Approve (A)"
        aria-pressed={output.review === "approved"}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          decide("approved")
        }}
        className={cn(
          "bg-background/90 shadow-xs backdrop-blur-sm transition-[transform,background-color,color] duration-150 ease-out active:scale-95",
          output.review === "approved" && "bg-emerald-600 text-white hover:bg-emerald-600/90 dark:bg-emerald-500"
        )}
      >
        <CheckIcon />
      </Button>
    </div>
  )
}

/** A check or cross in the corner of a reviewed image. */
export function ReviewMark({ review }: { review: Review | null }) {
  if (!review) return null
  return (
    <span
      aria-label={review === "approved" ? "Approved" : "Rejected"}
      className={cn(
        "pointer-events-none absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-full text-white shadow-sm [&_svg]:size-3 [&_svg]:stroke-3",
        review === "approved" ? "bg-emerald-600 dark:bg-emerald-500" : "bg-destructive"
      )}
    >
      {review === "approved" ? <CheckIcon /> : <XIcon />}
    </span>
  )
}

// Two clicks to delete: the first arms the button for a few seconds.
export function DeleteButton({ onDelete, label = "Delete" }: { onDelete: () => void; label?: string }) {
  const [armed, setArmed] = React.useState(false)
  React.useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])
  return armed ? (
    <Button variant="destructive" size="xs" onClick={onDelete} autoFocus>
      <Trash2Icon />
      {label}?
    </Button>
  ) : (
    <Button variant="ghost" size="icon-xs" aria-label={label} title={label} onClick={() => setArmed(true)}>
      <Trash2Icon />
    </Button>
  )
}

/**
 * One new poster: the image (opens large), its review in the corner and the
 * approve / reject buttons on hover (always on touch screens), its name below.
 */
export function OutputTile({
  set,
  output,
  onOpen,
  className,
  frameClassName,
  badge,
}: {
  set: GenerationSet
  output: Output
  onOpen: () => void
  className?: string
  /** Sizes the image: a height in rows, a width in grids. */
  frameClassName?: string
  /** Which poster of a set it's from. */
  badge?: React.ReactNode
}) {
  const poster = set.posters.find((p) => p.index === output.poster)
  const aspect = aspectOf(output) ?? aspectOf(poster) ?? 3 / 4
  const done = output.status === "done" && !!output.file
  const waiting = output.status === "pending" && !isActive(set)
  const name = outputName(output)
  return (
    <figure className={cn("group/tile flex shrink-0 flex-col gap-1.5", className)}>
      <div
        data-review={output.review ?? undefined}
        className={cn(
          "relative overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/5 transition-shadow duration-150 ease-out",
          "data-[review=approved]:ring-2 data-[review=approved]:ring-emerald-600/70 dark:data-[review=approved]:ring-emerald-500/70",
          frameClassName
        )}
        style={{ aspectRatio: aspect }}
      >
        <button
          type="button"
          onClick={onOpen}
          disabled={!done}
          aria-label={`View ${name}`}
          className={cn(
            "absolute inset-0 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:cursor-default",
            "transition-[opacity,filter] duration-200 ease-out",
            output.review === "rejected" && "opacity-45 grayscale [@media(hover:hover)]:group-hover/tile:opacity-80 [@media(hover:hover)]:group-hover/tile:grayscale-0"
          )}
        >
          <AssetImage
            set={set}
            asset={waiting ? { ...output, status: "error", error: "Didn't run — retry the set" } : output}
            alt={`${name}: new poster from ${set.source.title}`}
          />
        </button>
        <ReviewMark review={output.review} />
        {badge && (
          <span className="pointer-events-none absolute top-1.5 right-1.5 rounded-sm bg-background/90 px-1 text-[10px] leading-4 font-medium tabular-nums shadow-xs backdrop-blur-sm">
            {badge}
          </span>
        )}
        {done && (
          <ReviewButtons
            set={set}
            output={output}
            className={cn(
              "absolute right-1.5 bottom-1.5 transition-[opacity,transform] duration-150 ease-out-strong",
              "[@media(hover:hover)]:translate-y-0.5 [@media(hover:hover)]:opacity-0",
              "[@media(hover:hover)]:group-hover/tile:translate-y-0 [@media(hover:hover)]:group-hover/tile:opacity-100",
              "focus-within:translate-y-0 focus-within:opacity-100"
            )}
          />
        )}
      </div>
      <figcaption className="flex min-w-0 items-center gap-1.5 px-0.5 text-xs" title={output.title ?? undefined}>
        <span className="truncate font-medium">{name}</span>
        <CreativityMeter level={output.creativity} className="shrink-0" />
        {output.from && <span className="shrink-0 text-muted-foreground">· reworked</span>}
      </figcaption>
    </figure>
  )
}

/** Where a set stands, in a few words. */
export function progress(set: GenerationSet) {
  const failed = [set.original, set.extraction, set.mockup, ...set.outputs].filter((a) => a?.status === "error").length
  const made = set.outputs.filter((o) => o.status === "done").length
  const stage =
    set.original.status !== "done"
      ? "Fetching photo"
      : set.kind === "mockup"
        ? "Emptying the frame"
        : set.extraction?.status !== "done"
          ? "Finding the posters"
          : set.outputs.some((o) => o.status === "running" && !o.job)
            ? `Drawing ${made} of ${set.outputs.length}`
            : set.outputs.some((o) => o.job)
              ? "In a batch job"
            : set.outputs.some((o) => o.status === "pending")
              ? "Writing the briefs"
              : "Finishing"
  return {
    failed,
    made,
    stage,
    review: toReview(set).length,
    approved: set.outputs.filter((o) => o.review === "approved").length,
  }
}

/** A zip of `outputs` (or the one image as it is). */
export async function downloadOutputs(set: GenerationSet, outputs: Output[]) {
  const ready = outputs.filter((o) => o.status === "done" && o.file)
  if (!ready.length) return
  try {
    const images = await Promise.all(
      ready.map(async (o) => {
        const response = await fetch(generationFileUrl(set.id, o.file!))
        if (!response.ok) throw new Error(response.statusText)
        return new Uint8Array(await response.arrayBuffer())
      })
    )
    const base = fileBase(set)
    if (ready.length === 1) {
      download(new Blob([images[0] as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }), `${base}-${slug(outputName(ready[0]))}.jpg`)
      return
    }
    const files: Record<string, Uint8Array> = {}
    ready.forEach((o, i) => {
      files[`${String(i + 1).padStart(2, "0")}-${slug(outputName(o))}.jpg`] = images[i]
    })
    download(new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${base}.zip`)
  } catch (error) {
    toast.error(`Couldn't download: ${(error as Error).message}`)
  }
}

// --- Helpers ---

/** What an output is called in captions: its idea's title, or its creativity. */
export function outputName(output: Output) {
  if (output.mode === "idea") return output.title ?? "New idea"
  return output.styleId ? `Styled · ${CREATIVITY_LABEL[output.creativity]}` : CREATIVITY_LABEL[output.creativity]
}

/** What the mockups' poster is called when it's this image of a set. */
export const generationPosterKey = (set: GenerationSet, file: string) => `${set.id}/${file}`

/** Makes an image of a set the design every mockup shows. */
export async function chooseGenerationPoster(set: GenerationSet, file: string, name: string) {
  const response = await fetch(generationFileUrl(set.id, file))
  if (!response.ok) throw new Error(response.statusText)
  const blob = await response.blob()
  const { choosePoster } = await import("@/lib/mockups/poster-store")
  await choosePoster(
    new File([blob], `${fileBase(set)}-${slug(name)}.jpg`, { type: blob.type }),
    generationPosterKey(set, file)
  )
}

/** Makes an image the design every mockup shows, as if picked on the Mockups page. */
export async function makeMockupPoster(
  set: GenerationSet,
  file: string,
  name: string,
  router: ReturnType<typeof useRouter>
) {
  try {
    await chooseGenerationPoster(set, file, name)
    toast.success("The mockups now show this poster", {
      action: {
        label: "Open mockups",
        onClick: () => router.push(`/mockups?category=${encodeURIComponent(set.folder)}`),
      },
    })
  } catch (error) {
    toast.error(`Couldn't use it: ${(error as Error).message}`)
  }
}

export const aspectOf = (asset: { width?: number; height?: number } | undefined) =>
  asset?.width && asset.height ? asset.width / asset.height : null

export function slug(text: string) {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "poster"
  )
}

/** Etsy titles are keyword lists; the first phrase names the thing. */
export function shortTitle(title: string) {
  return title.split(/\s*[,|•·–—]\s*|\s+-\s+/)[0]?.trim() || title
}

export const fileBase = (set: GenerationSet) => slug(shortTitle(set.source.title))

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
]

export function timeAgo(iso: string) {
  const seconds = (Date.parse(iso) - Date.now()) / 1000
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return "just now"
}

/** A span of time in one or two short units: "40 s", "12 min", "1 h 5 min". */
export function duration(ms: number) {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))} s`
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
}

/** The set's newest batch job, in words: how many images, and how long it has taken (or took). */
export function batchSummary(set: GenerationSet) {
  const job = set.jobs?.at(-1)
  if (!job) return null
  const running = job.status === "running"
  const took = (job.finishedAt ? Date.parse(job.finishedAt) : Date.now()) - Date.parse(job.submittedAt)
  const n = job.outputs.length
  const images = `${n} ${n === 1 ? "image" : "images"}`
  return {
    running,
    failed: job.status === "error",
    text: running ? `Batch · ${images} · ${duration(took)} so far` : `Batch · ${images} in ${duration(took)}`,
    title: running
      ? `Sent to Vertex ${new Date(job.submittedAt).toLocaleString()}; checked every 30 s`
      : `Sent ${new Date(job.submittedAt).toLocaleString()}, back ${new Date(job.finishedAt!).toLocaleString()}${job.error ? ` — ${job.error}` : ""}`,
  }
}

/** Done outputs nobody has decided on yet. */
export const toReview = (set: GenerationSet) =>
  set.outputs.filter((o) => o.status === "done" && !o.review)
