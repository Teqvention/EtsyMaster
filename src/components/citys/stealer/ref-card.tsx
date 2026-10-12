"use client"

import * as React from "react"
import { LoaderCircleIcon, SlidersHorizontalIcon } from "lucide-react"

import { SelectMark } from "@/components/selection"
import type { StealerRef } from "@/lib/citys/stealer"
import { formatCompact, formatRate } from "@/lib/etsy/format"
import { cn } from "@/lib/utils"

// One reference photo in the Stealer: the city photo taken out of the
// competitor's poster once it's in (the listing photo until then), the shop
// small beneath it, and how it sells. A click opens it (or picks it, while
// scaling); hovering shows a button for settings of its own.

export function RefCard({
  item,
  selecting,
  selected,
  custom,
  onClick,
  onSettings,
  size = "md",
}: {
  item: StealerRef
  selecting: boolean
  selected: boolean
  /** It has settings of its own. */
  custom: boolean
  onClick: (event: React.MouseEvent) => void
  onSettings: () => void
  size?: "sm" | "md"
}) {
  const print = item.crop.prints[0]
  const cropping = item.crop.status === "running" || item.crop.status === "pending"
  return (
    <div className="group/tile relative flex min-w-0 flex-col gap-1.5">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "relative block overflow-hidden rounded-lg bg-muted outline-none transition-[box-shadow,transform] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]",
          size === "sm" ? "aspect-[4/5]" : "aspect-[4/5]",
          selected && "ring-2 ring-brand ring-offset-2 ring-offset-background"
        )}
        aria-pressed={selecting ? selected : undefined}
        aria-label={`${item.title} · ${item.shop}`}
      >
        {print ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={print.thumb} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
        ) : item.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image} alt="" loading="lazy" className={cn("absolute inset-0 size-full object-cover", cropping && "opacity-70")} />
        ) : null}
        {cropping && (
          <span className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-black/40 text-white" title="Taking the photo out of the poster">
            <LoaderCircleIcon className="size-3 animate-spin motion-reduce:animate-none" />
          </span>
        )}
        {item.crop.prints.length > 1 && (
          <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-1.5 text-[10px] font-medium text-white tabular-nums">
            {item.crop.prints.length} prints
          </span>
        )}
        <span className="absolute top-2 right-2 rounded-full bg-black/55 px-1.5 text-[10px] font-medium text-white opacity-0 transition-opacity duration-150 group-hover/tile:opacity-100">
          {item.photo ? "Photo" : item.look === "unknown" ? "Art" : item.look}
        </span>
      </button>
      {selecting && <SelectMark selected={selected} selecting={selecting} />}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onSettings()
        }}
        aria-label="Settings for this photo"
        title="Settings for this photo"
        className={cn(
          "absolute right-2 bottom-[2.6rem] grid size-7 place-items-center rounded-full border bg-background/90 shadow-sm backdrop-blur-sm outline-none transition-[opacity,transform] duration-150 ease-out focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.95]",
          custom ? "border-brand text-brand opacity-100" : "text-foreground opacity-0 [@media(hover:hover)]:group-hover/tile:opacity-100"
        )}
      >
        <SlidersHorizontalIcon className="size-3.5" />
      </button>
      <div className="flex min-w-0 items-baseline justify-between gap-2 px-0.5">
        <span className="truncate text-[11px] text-muted-foreground" title={item.title}>
          {item.shop}
          {item.via && <span className="text-foreground/70"> · {item.via}</span>}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums" title={`${formatRate(item.spm)} sales a month · ${formatCompact(item.fav)} favorites`}>
          {formatRate(item.spm)}/mo
        </span>
      </div>
    </div>
  )
}
