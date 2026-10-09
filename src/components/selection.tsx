"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { CheckIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

// The look of picking tiles in a grid (see `useSelection`): a check in the
// tile's corner, and a bar floating at the bottom of the page while
// anything is picked, with what can be done to the pick.

/**
 * Check in the top-left corner of a `group/tile`. Empty circles show on
 * hover, and on every tile once something is picked, to say a click picks.
 */
export function SelectMark({ selected, selecting }: { selected: boolean; selecting: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-2 left-2 z-10 grid size-5 place-items-center rounded-full border-[1.5px] shadow-sm transition-[opacity,transform,background-color,border-color] duration-150 ease-out-strong",
        selected
          ? "scale-100 border-brand bg-brand text-white"
          : cn(
              "scale-90 border-white bg-black/20 text-transparent",
              selecting ? "opacity-100" : "opacity-0 [@media(hover:hover)]:group-hover/tile:opacity-100"
            )
      )}
    >
      <CheckIcon className="size-3" strokeWidth={3} />
    </span>
  )
}

const noSubscribe = () => () => {}

/**
 * Floats at the bottom of the page, in the shell's `#floating-bar` slot: that
 * sits at the end of a column at least as tall as the view, so the bar rests
 * at the bottom on short pages too, and leaves room for itself at the end of
 * long ones rather than covering the last row.
 */
export function SelectionBar({
  count,
  total,
  onSelectAll,
  onClear,
  children,
}: {
  count: number
  total: number
  onSelectAll: () => void
  onClear: () => void
  /** Actions on the selection. */
  children: React.ReactNode
}) {
  const slot = React.useSyncExternalStore(
    noSubscribe,
    () => document.getElementById("floating-bar"),
    () => null
  )
  if (count === 0 || !slot) return null
  return createPortal(
    <div
      role="toolbar"
      aria-label="Selection"
      className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-popover/95 p-1 pl-3 text-sm text-popover-foreground shadow-lg backdrop-blur-sm transition-[opacity,transform] duration-200 ease-out-strong starting:translate-y-2 starting:opacity-0 motion-reduce:starting:translate-y-0"
    >
      <span className="font-medium whitespace-nowrap tabular-nums">{count} selected</span>
      {count < total && (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onSelectAll}>
          Select all {total}
        </Button>
      )}
      <Separator orientation="vertical" className="mx-1 h-5 data-vertical:self-auto" />
      {children}
      <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Deselect all" title="Deselect (Esc)">
        <XIcon />
      </Button>
    </div>,
    slot
  )
}
