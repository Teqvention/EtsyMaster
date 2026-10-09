"use client"

import * as React from "react"
import { DiamondPlusIcon, PauseIcon, PlayIcon, Trash2Icon } from "lucide-react"
import { cn } from "cn"

import { IconButton } from "@/components/mockups/layers-panel"
import { usePlayerTime, usePlaying, type Player } from "@/components/mockups/use-player"
import type { Clip } from "@/lib/mockups/types"

/** Keys can't be dragged closer than this share of the clip. */
const GAP = 0.01

// Transport under the canvas: play, the playhead and the clip's keyframes.
export function Timeline({
  clip,
  player,
  selected,
  onSelect,
  onRetime,
  onAdd,
  onDelete,
}: {
  clip: Clip
  player: Player
  selected: number | null
  onSelect: (index: number) => void
  onRetime: (index: number, t: number, merge: string) => void
  onAdd: () => void
  onDelete: () => void
}) {
  const time = usePlayerTime(player)
  const playing = usePlaying(player)
  const track = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<{ kind: "scrub" } | { kind: "key"; index: number; from: number; token: string } | null>(
    null
  )
  const duration = clip.duration

  const at = (event: React.PointerEvent) => {
    const rect = track.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  }

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    track.current!.setPointerCapture(event.pointerId)
    const diamond = (event.target as Element).closest<HTMLElement>("[data-key]")
    if (diamond) {
      const index = Number(diamond.dataset.key)
      onSelect(index)
      drag.current = { kind: "key", index, from: event.clientX, token: `retime:${clip.id}:${performance.now()}` }
      return
    }
    player.pause()
    player.seek(at(event) * duration)
    drag.current = { kind: "scrub" }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.kind === "scrub") return player.seek(at(event) * duration)
    // A click on a key shouldn't nudge it.
    if (Math.abs(event.clientX - d.from) < 3) return
    const keys = clip.keys
    const lo = d.index > 0 ? keys[d.index - 1].t + GAP : 0
    const hi = d.index < keys.length - 1 ? keys[d.index + 1].t - GAP : 1
    const t = Math.round(Math.min(hi, Math.max(lo, at(event))) * 1000) / 1000
    onRetime(d.index, t, d.token)
    player.seek(t * duration)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 1 : 1 / 10
    if (event.key === " ") {
      event.preventDefault()
      return player.toggle()
    }
    if (event.key === "ArrowLeft") player.seek(player.time - step)
    else if (event.key === "ArrowRight") player.seek(player.time + step)
    else if (event.key === "Home") player.seek(0)
    else if (event.key === "End") player.seek(duration)
    else return
    event.preventDefault()
    player.pause()
  }

  const every = duration > 10 ? 2 : 1
  const seconds = Array.from({ length: Math.floor(duration / every) + 1 }, (_, i) => i * every)

  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-t px-2">
      <IconButton label={playing ? "Pause (Space)" : "Play (Space)"} onClick={() => player.toggle()}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </IconButton>
      <span className="w-[4.5rem] shrink-0 text-xs text-muted-foreground tabular-nums">
        <span className="text-foreground">{time.toFixed(1)}</span> / {duration} s
      </span>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.round(time * 10) / 10}
        aria-valuetext={`${time.toFixed(1)} of ${duration} seconds`}
        className="relative h-10 min-w-0 flex-1 cursor-pointer touch-none rounded-sm outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onKeyDown}
      >
        {seconds.map((s) => (
          <span
            key={s}
            className="pointer-events-none absolute top-0 h-1.5 w-px bg-border"
            style={{ left: `${(s / duration) * 100}%` }}
          >
            <span className="absolute top-1 left-1 text-[10px] leading-none text-muted-foreground tabular-nums">
              {s}
            </span>
          </span>
        ))}
        <div className="pointer-events-none absolute inset-x-0 top-6 h-px bg-border" />
        {clip.keys.map((k, i) => (
          <button
            key={i}
            type="button"
            data-key={i}
            aria-label={`Keyframe ${i + 1} at ${(k.t * duration).toFixed(1)} s`}
            aria-pressed={i === selected}
            tabIndex={-1}
            className={cn(
              "absolute top-6 size-2.5 -translate-1/2 rotate-45 rounded-[2px] border after:absolute after:-inset-2",
              "cursor-ew-resize transition-transform duration-150 ease-out-strong active:scale-90",
              i === selected ? "border-primary bg-primary" : "border-foreground/50 bg-background hover:border-foreground"
            )}
            style={{ left: `${k.t * 100}%` }}
          />
        ))}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ transform: `translateX(${(time / duration) * 100}%)` }}
        >
          <div className="absolute inset-y-0 -left-px w-0.5 rounded-full bg-sky-500" />
        </div>
      </div>
      <IconButton label="Add keyframe at playhead" onClick={onAdd}>
        <DiamondPlusIcon />
      </IconButton>
      <IconButton
        label="Delete keyframe"
        disabled={selected === null || clip.keys.length < 2}
        onClick={onDelete}
      >
        <Trash2Icon />
      </IconButton>
    </div>
  )
}
