"use client"

import Image from "next/image"
import * as React from "react"

import { cn } from "@/lib/utils"

// Photos in a row to drag into a new order (or move with ← and → once
// focused). `order` holds the current ranks (1 is the thumbnail) in their
// new sequence, the way a reorder action takes it.

export function PhotoOrder({
  photos,
  order,
  onChange,
  renderExtra,
}: {
  /** By current rank; a photo without url shows its number. */
  photos: { rank: number; url: string | null }[]
  order: number[]
  onChange: (order: number[]) => void
  /** Something under a photo, e.g. a swap button. */
  renderExtra?: (rank: number, position: number) => React.ReactNode
}) {
  const [dragging, setDragging] = React.useState<number | null>(null)
  const list = React.useRef<HTMLOListElement>(null)
  const byRank = new Map(photos.map((p) => [p.rank, p]))

  function move(from: number, to: number) {
    const next = [...order]
    const [rank] = next.splice(from, 1)
    next.splice(to, 0, rank)
    onChange(next)
  }

  return (
    <ol ref={list} className="flex flex-wrap gap-2" aria-label="Photo order: drag, or focus a photo and use the arrow keys">
      {order.map((rank, i) => {
        const photo = byRank.get(rank)
        const moved = rank !== i + 1
        return (
          <li
            key={rank}
            draggable
            tabIndex={0}
            aria-label={`Photo ${rank}${moved ? `, now ${i + 1}` : ""}`}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move"
              setDragging(i)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              if (dragging === null || dragging === i) return
              move(dragging, i)
              setDragging(i)
            }}
            onDragEnd={() => setDragging(null)}
            onKeyDown={(event) => {
              const to = event.key === "ArrowLeft" ? i - 1 : event.key === "ArrowRight" ? i + 1 : -1
              if (to < 0 || to >= order.length) return
              event.preventDefault()
              move(i, to)
              requestAnimationFrame(() => (list.current?.children[to] as HTMLElement | undefined)?.focus())
            }}
            className={cn(
              "group/photo flex w-20 cursor-grab flex-col gap-1 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing",
              dragging === i && "opacity-40"
            )}
          >
            <span className="relative grid aspect-square place-items-center overflow-hidden rounded-md border bg-muted text-sm font-medium text-muted-foreground">
              {photo?.url ? (
                <Image src={photo.url} alt="" fill unoptimized sizes="80px" draggable={false} className="object-cover" />
              ) : (
                rank
              )}
              <span
                className={cn(
                  "absolute top-1 left-1 grid h-4 min-w-4 place-items-center rounded px-1 text-[10px] font-semibold tabular-nums",
                  i === 0 ? "bg-brand text-white" : "bg-background/90 text-foreground"
                )}
              >
                {i + 1}
              </span>
            </span>
            <span className="flex h-4 items-center justify-between text-[10px] text-muted-foreground tabular-nums">
              {moved ? <span>was {rank}</span> : <span>{i === 0 ? "Thumbnail" : " "}</span>}
              {renderExtra?.(rank, i + 1)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
