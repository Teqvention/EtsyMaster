"use client"

import * as React from "react"
import { ChevronRightIcon, ClockIcon, FlaskConicalIcon, LoaderCircleIcon, ThumbsDownIcon, ThumbsUpIcon, TriangleAlertIcon, ZapIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import type { Round } from "@/hooks/use-city-style"
import { LAB_BLOCKS, LAB_CITIES, type LabBlock, type LabImage, type StyleCandidate } from "@/lib/citys/studio-types"
import { cn } from "@/lib/utils"

// The lab's test rounds. A round paints the style in three blocks: cities
// from words (seven kinds of place, New York to a lake), real city photos
// repainted, and new cities after the board's own images. The newest round
// of what's selected at the top shows in full; older ones fold away. With
// variants being tried, the same cities sit side by side, main against
// each variant.

export const BLOCK_LABEL: Record<LabBlock, { label: string; hint: string; count: number }> = {
  prompt: { label: "From words", hint: "Seven places painted from their names alone: a metropolis, a capital, a small German city, a US small town, a beach, a lake", count: LAB_CITIES.prompt.length },
  photo: { label: "From photos", hint: "Five real city photos repainted in the style", count: LAB_CITIES.photo.length },
  references: { label: "After the board", hint: "Five new cities after one or two of the board's own images each", count: LAB_CITIES.references.length },
}

const fileUrl = (set: string, file: string, width?: number) => `/api/generations/${set}/files/${file}${width ? `?w=${width}` : ""}`

export function RoundRunner({ onRun, disabled, running }: { onRun: (blocks: LabBlock[], delivery: "now" | "batch") => Promise<void>; disabled?: boolean; running?: boolean }) {
  const [blocks, setBlocks] = React.useState<LabBlock[]>([...LAB_BLOCKS])
  // Batch by default: online while Vertex has room, the rest in a batch job, so nothing fails on a busy quota.
  const [delivery, setDelivery] = React.useState<"now" | "batch">("batch")
  const [busy, setBusy] = React.useState(false)
  const count = blocks.reduce((n, b) => n + BLOCK_LABEL[b].count, 0)
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2">
      <FlaskConicalIcon className="ml-1 size-4 text-muted-foreground" />
      <span className="text-sm font-medium">Test round</span>
      <div className="flex flex-wrap gap-1">
        {LAB_BLOCKS.map((b) => {
          const on = blocks.includes(b)
          return (
            <button
              key={b}
              type="button"
              aria-pressed={on}
              title={BLOCK_LABEL[b].hint}
              onClick={() => setBlocks((list) => (on ? list.filter((x) => x !== b) : [...list, b]))}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs outline-none transition-[border-color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97]",
                on ? "border-brand/60 bg-brand/10" : "border-border bg-background text-muted-foreground"
              )}
            >
              {BLOCK_LABEL[b].label}
              <span className="text-muted-foreground tabular-nums">{BLOCK_LABEL[b].count}</span>
            </button>
          )
        })}
      </div>
      <div className="flex rounded-md border bg-background p-0.5">
        {(["now", "batch"] as const).map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={delivery === d}
            onClick={() => setDelivery(d)}
            title={d === "now" ? "Painted right away, full price" : "Half the price, back in minutes to hours"}
            className={cn("inline-flex h-6 items-center gap-1 rounded px-2 text-xs outline-none [&_svg]:size-3", delivery === d ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
          >
            {d === "now" ? <ZapIcon /> : <ClockIcon />}
            {d === "now" ? "Now" : "Batch"}
          </button>
        ))}
      </div>
      <Button
        size="sm"
        className="ml-auto active:scale-[0.97]"
        disabled={disabled || busy || !blocks.length}
        onClick={async () => {
          setBusy(true)
          try {
            await onRun(blocks, delivery)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy || running ? <LoaderCircleIcon className="animate-spin" /> : <FlaskConicalIcon />}
        Paint {count}
      </Button>
    </div>
  )
}

export function RoundView({
  round,
  onRate,
  onOpen,
  onRetry,
}: {
  round: Round
  onRate: (image: LabImage, rating: "up" | "down" | null) => void
  onOpen: (image: LabImage) => void
  onRetry?: () => void
}) {
  const blocks = LAB_BLOCKS.filter((b) => round.images.some((i) => i.block === b))
  const failed = round.images.filter((i) => i.status === "error").length
  if (round.status === "preparing") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <LoaderCircleIcon className="size-3.5 animate-spin" />
        Getting the round ready{round.images.length === 0 ? ": taking the city photos out of their posters" : ""}…
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {failed > 0 && round.status === "done" && onRetry && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <TriangleAlertIcon className="size-3.5 text-amber-600" />
          {failed} couldn&apos;t be painted (Vertex was busy).
          <button type="button" onClick={onRetry} className="font-medium text-foreground underline underline-offset-2">
            Paint them again
          </button>
        </p>
      )}
      {blocks.map((b) => (
        <div key={b} className="flex flex-col gap-2">
          <h4 className="text-xs font-medium text-muted-foreground" title={BLOCK_LABEL[b].hint}>
            {BLOCK_LABEL[b].label}
          </h4>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
            {round.images
              .filter((i) => i.block === b)
              .map((image) => (
                <li key={image.id}>
                  <LabTile set={round.set} image={image} onRate={(r) => onRate(image, r)} onOpen={() => onOpen(image)} />
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function LabTile({ set, image, onRate, onOpen }: { set: string; image: LabImage; onRate: (rating: "up" | "down" | null) => void; onOpen: () => void }) {
  const painting = image.status === "pending" || image.status === "running"
  return (
    <div className="group/tile flex min-w-0 flex-col gap-1">
      <div className="relative">
        <button
          type="button"
          disabled={!image.file}
          onClick={onOpen}
          className={cn(
            "relative block aspect-[3/4] w-full overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            image.rating === "up" && "ring-2 ring-emerald-500/70",
            image.rating === "down" && "opacity-60"
          )}
          aria-label={image.city}
        >
          {image.file ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(set, image.file, 480)} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
          ) : painting ? (
            <span className="absolute inset-0 overflow-hidden">
              <span className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-foreground/5 to-transparent motion-reduce:animate-none" />
            </span>
          ) : (
            <span className="absolute inset-0 grid place-items-center p-2 text-center text-[11px] text-destructive" title={image.error}>
              <TriangleAlertIcon className="size-4" />
            </span>
          )}
        </button>
        {image.file && (
          <div className="absolute right-1.5 bottom-1.5 flex gap-1 opacity-0 transition-opacity duration-150 group-hover/tile:opacity-100 focus-within:opacity-100">
            <RateButton up={false} on={image.rating === "down"} onClick={() => onRate(image.rating === "down" ? null : "down")} />
            <RateButton up on={image.rating === "up"} onClick={() => onRate(image.rating === "up" ? null : "up")} />
          </div>
        )}
      </div>
      <span className="truncate px-0.5 text-[11px] text-muted-foreground" title={image.city}>
        {image.city}
      </span>
    </div>
  )
}

function RateButton({ up, on, onClick }: { up: boolean; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={up ? "Good" : "Not good"}
      className={cn(
        "grid size-6 place-items-center rounded-full border bg-background/90 shadow-sm outline-none active:scale-[0.92] [&_svg]:size-3",
        on && (up ? "border-emerald-600 bg-emerald-600 text-white" : "border-destructive bg-destructive text-white")
      )}
    >
      {up ? <ThumbsUpIcon /> : <ThumbsDownIcon />}
    </button>
  )
}

/** Main against each variant, city by city: what each variant changes, at a glance. */
export function CompareView({
  main,
  candidates,
  rounds,
  onOpen,
}: {
  main: Round | undefined
  candidates: StyleCandidate[]
  rounds: Round[]
  onOpen: (set: string, image: LabImage) => void
}) {
  const columns = [
    { id: "main", label: "Main", round: main },
    ...candidates.map((c, i) => ({ id: c.id, label: `${i + 1}`, title: c.label, round: rounds.find((r) => r.id === c.round) })),
  ]
  const cities = [...new Set(columns.flatMap((c) => (c.round?.images ?? []).filter((i) => i.block === "prompt").map((i) => i.city)))].slice(0, 7)
  if (!cities.length) return null
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-2">
        <thead>
          <tr>
            <th />
            {columns.map((c) => (
              <th key={c.id} className="w-36 text-left text-xs font-medium" title={"title" in c ? c.title : undefined}>
                {c.id === "main" ? "Main" : <span className="inline-grid size-5 place-items-center rounded-md bg-brand/15 text-brand">{c.label}</span>}
                {"title" in c && <span className="ml-1.5 line-clamp-2 text-[11px] font-normal text-muted-foreground">{c.title}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cities.map((city) => (
            <tr key={city}>
              <td className="w-24 pr-2 align-middle text-xs text-muted-foreground">{city}</td>
              {columns.map((c) => {
                const image = c.round?.images.find((i) => i.city === city && i.block === "prompt")
                return (
                  <td key={c.id}>
                    <button
                      type="button"
                      disabled={!image?.file || !c.round}
                      onClick={() => image && c.round && onOpen(c.round.set, image)}
                      className="relative block aspect-[3/4] w-36 overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {image?.file && c.round ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={fileUrl(c.round.set, image.file, 480)} alt="" className="absolute inset-0 size-full object-cover" />
                      ) : image && (image.status === "pending" || image.status === "running") ? (
                        <span className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-foreground/5 to-transparent motion-reduce:animate-none" />
                      ) : null}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function OlderRounds({ rounds, onRate, onOpen }: { rounds: Round[]; onRate: (round: Round, image: LabImage, rating: "up" | "down" | null) => void; onOpen: (set: string, image: LabImage) => void }) {
  if (!rounds.length) return null
  return (
    <Collapsible>
      <CollapsibleTrigger className="group/older flex items-center gap-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:underline">
        <ChevronRightIcon className="size-3.5 transition-transform duration-150 ease-out group-data-panel-open/older:rotate-90" />
        {rounds.length} earlier {rounds.length === 1 ? "round" : "rounds"}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3 flex flex-col gap-6">
          {rounds.map((r) => (
            <div key={r.id} className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Version {r.version}
                {r.candidate && " · a variant"} · {new Date(r.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
              <RoundView round={r} onRate={(image, rating) => onRate(r, image, rating)} onOpen={(image) => onOpen(r.set, image)} />
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function LabImageDialog({ image, set, onClose }: { image: LabImage | null; set: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!image} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-2 p-3 sm:max-w-3xl">
        {image && set && image.file && (
          <>
            <DialogTitle className="text-sm">{image.city}</DialogTitle>
            <DialogDescription className="text-xs">{BLOCK_LABEL[image.block].label}</DialogDescription>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(set, image.file)} alt={image.city} className="max-h-[78svh] w-full rounded-md object-contain" />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function rateError(error: unknown) {
  toast.error(`Couldn't save the rating: ${(error as Error).message}`)
}
