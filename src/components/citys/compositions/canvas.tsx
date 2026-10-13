"use client"

import * as React from "react"

import { CANVAS, heightOf, layoutAt, type CompositionData, type CompositionElement, type PlaceFacts } from "@/lib/citys/composition/model"
import { fontsOf, renderSvg, type Palette, type PhotoInput } from "@/lib/citys/composition/render"
import type { SizeKey } from "@/lib/catalog/sizes"
import { useLoadedFonts } from "@/hooks/use-fonts"
import { cn } from "@/lib/utils"

// The editor's canvas: the composition drawn exactly as print files are
// (renderSvg, the fonts' own outlines), with a frame over each element to
// pick it, drag it and pull its edges. Moves snap to the canvas's centre
// and edges and to the other elements' edges, and say so with a guide.
// Rebuilt from a poster, the original can lie over it: on one side of a
// line drawn across (dragged left and right), or in difference, where
// whatever matches goes black and whatever is off lights up; editing goes
// on underneath.

export type Box = { x: number; y: number; w: number; h: number }

/** The original over the canvas: left of `at` (0–1 across) on a slider, or in difference. */
export type Overlay = { src: string; mode: "slider" | "difference"; at: number }

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const
type Handle = (typeof HANDLES)[number]
const SNAP = 6

/** One drag's key in the history, so its steps merge into one undo. */
const dragKey = (id: string) => `drag:${id}:${Date.now()}`

export function CompositionCanvas({
  data,
  ratio,
  size,
  facts,
  photo,
  palette,
  selected,
  onSelect,
  onBox,
  maxHeight,
  overlay,
  onOverlayAt,
}: {
  data: CompositionData
  ratio: number
  size?: SizeKey
  facts: PlaceFacts
  photo: PhotoInput
  palette?: Palette
  selected: string | null
  onSelect: (id: string | null) => void
  /** A move or resize, in canvas units; `merge` groups one drag into one undo step. */
  onBox: (id: string, box: Box, merge: string) => void
  maxHeight: number
  overlay?: Overlay | null
  onOverlayAt?: (at: number) => void
}) {
  const fonts = useLoadedFonts(fontsOf(data))
  const wrap = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(600)
  const H = heightOf(ratio)
  const scale = Math.min(width / CANVAS, maxHeight / H)
  const elements = layoutAt(data, ratio, size)
  const { svg } = React.useMemo(() => renderSvg({ data, ratio, size, facts, fonts, photo, palette, width: CANVAS * scale, editing: true }), [data, ratio, size, facts, fonts, photo, palette, scale])
  const [guides, setGuides] = React.useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const drag = React.useRef<{ id: string; handle: Handle | "move"; start: { x: number; y: number }; box: Box; merge: string } | null>(null)

  React.useEffect(() => {
    const node = wrap.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  function snap(box: Box, moving: Handle | "move", id: string) {
    const xs = [0, CANVAS / 2, CANVAS]
    const ys = [0, H / 2, H]
    for (const e of elements) {
      if (e.id === id || e.hidden) continue
      xs.push(e.x, e.x + e.w / 2, e.x + e.w)
      ys.push(e.y, e.y + e.h / 2, e.y + e.h)
    }
    const hits = { x: [] as number[], y: [] as number[] }
    const near = (value: number, list: number[]) => list.find((t) => Math.abs(t - value) <= SNAP / scale)
    const out = { ...box }
    if (moving === "move") {
      for (const [edge, offset] of [[box.x, 0], [box.x + box.w / 2, box.w / 2], [box.x + box.w, box.w]] as const) {
        const t = near(edge, xs)
        if (t !== undefined) {
          out.x = t - offset
          hits.x.push(t)
          break
        }
      }
      for (const [edge, offset] of [[box.y, 0], [box.y + box.h / 2, box.h / 2], [box.y + box.h, box.h]] as const) {
        const t = near(edge, ys)
        if (t !== undefined) {
          out.y = t - offset
          hits.y.push(t)
          break
        }
      }
    } else {
      if (moving.includes("e")) {
        const t = near(box.x + box.w, xs)
        if (t !== undefined) {
          out.w = t - box.x
          hits.x.push(t)
        }
      }
      if (moving.includes("w")) {
        const t = near(box.x, xs)
        if (t !== undefined) {
          out.w = box.x + box.w - t
          out.x = t
          hits.x.push(t)
        }
      }
      if (moving.includes("s")) {
        const t = near(box.y + box.h, ys)
        if (t !== undefined) {
          out.h = t - box.y
          hits.y.push(t)
        }
      }
      if (moving === "n" || moving === "ne" || moving === "nw") {
        const t = near(box.y, ys)
        if (t !== undefined) {
          out.h = box.y + box.h - t
          out.y = t
          hits.y.push(t)
        }
      }
    }
    setGuides(hits)
    return out
  }

  function start(event: React.PointerEvent, el: CompositionElement, handle: Handle | "move") {
    if (el.locked) return onSelect(el.id)
    event.stopPropagation()
    event.preventDefault()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    onSelect(el.id)
    drag.current = { id: el.id, handle, start: { x: event.clientX, y: event.clientY }, box: { x: el.x, y: el.y, w: el.w, h: el.h }, merge: dragKey(el.id) }
  }

  function move(event: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const dx = (event.clientX - d.start.x) / scale
    const dy = (event.clientY - d.start.y) / scale
    let box: Box = { ...d.box }
    if (d.handle === "move") box = { ...box, x: d.box.x + dx, y: d.box.y + dy }
    else {
      if (d.handle.includes("e")) box.w = Math.max(4, d.box.w + dx)
      if (d.handle.includes("w")) {
        box.x = d.box.x + Math.min(dx, d.box.w - 4)
        box.w = Math.max(4, d.box.w - dx)
      }
      if (d.handle.includes("s")) box.h = Math.max(2, d.box.h + dy)
      if (d.handle === "n" || d.handle === "ne" || d.handle === "nw") {
        box.y = d.box.y + Math.min(dy, d.box.h - 2)
        box.h = Math.max(2, d.box.h - dy)
      }
    }
    const snapped = event.altKey ? box : snap(box, d.handle, d.id)
    onBox(d.id, round(snapped), d.merge)
  }

  function end() {
    drag.current = null
    setGuides({ x: [], y: [] })
  }

  const current = elements.find((e) => e.id === selected)

  function slide(event: React.PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const box = event.currentTarget.parentElement!.getBoundingClientRect()
    onOverlayAt?.(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)))
  }

  return (
    <div ref={wrap} className="flex w-full justify-center">
      <div
        className="relative shadow-[0_1px_3px_rgb(0_0_0/0.08),0_8px_30px_rgb(0_0_0/0.08)] select-none"
        style={{ width: CANVAS * scale, height: H * scale }}
        onPointerDown={() => onSelect(null)}
      >
        <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: svg }} />
        {overlay && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={overlay.src}
            alt=""
            draggable={false}
            className={cn("pointer-events-none absolute inset-0 size-full", overlay.mode === "difference" && "mix-blend-difference")}
            style={overlay.mode === "slider" ? { clipPath: `inset(0 ${(1 - overlay.at) * 100}% 0 0)` } : undefined}
          />
        )}
        {elements.map((el) =>
          el.hidden ? null : (
            <div
              key={el.id}
              role="button"
              aria-label={el.name}
              onPointerDown={(e) => start(e, el, "move")}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              className={cn(
                "absolute outline-offset-0 transition-[outline-color] duration-100",
                el.locked ? "cursor-default" : "cursor-move",
                el.id === selected ? "outline-2 outline-brand" : "outline-1 outline-transparent hover:outline-brand/50"
              )}
              style={{ left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale, outlineStyle: "solid" }}
            />
          )
        )}
        {current && !current.locked && !current.hidden &&
          HANDLES.map((h) => (
            <div
              key={h}
              onPointerDown={(e) => start(e, current, h)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-brand bg-background"
              style={{
                left: (current.x + (h.includes("e") ? current.w : h.includes("w") ? 0 : current.w / 2)) * scale,
                top: (current.y + (h.includes("s") ? current.h : h === "n" || h === "ne" || h === "nw" ? 0 : current.h / 2)) * scale,
                cursor: `${h}-resize`,
              }}
            />
          ))}
        {guides.x.map((x) => (
          <div key={`x${x}`} className="pointer-events-none absolute top-0 bottom-0 w-px bg-pink-500" style={{ left: x * scale }} />
        ))}
        {guides.y.map((y) => (
          <div key={`y${y}`} className="pointer-events-none absolute right-0 left-0 h-px bg-pink-500" style={{ top: y * scale }} />
        ))}
        {overlay?.mode === "slider" && (
          <div
            role="slider"
            aria-label="Original and ours"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(overlay.at * 100)}
            tabIndex={0}
            onKeyDown={(e) => {
              const step = e.key === "ArrowLeft" ? -0.02 : e.key === "ArrowRight" ? 0.02 : 0
              if (!step) return
              e.preventDefault()
              e.stopPropagation()
              onOverlayAt?.(Math.min(1, Math.max(0, overlay.at + step)))
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={slide}
            className="group/slider absolute top-0 bottom-0 z-10 w-5 -translate-x-1/2 cursor-ew-resize touch-none outline-none"
            style={{ left: `${overlay.at * 100}%` }}
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-brand" />
            <div className="absolute top-1/2 left-1/2 flex h-8 w-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-brand bg-background shadow-sm transition-transform duration-150 ease-out group-focus-visible/slider:ring-3 group-focus-visible/slider:ring-ring/50 group-active/slider:scale-95" />
          </div>
        )}
      </div>
    </div>
  )
}

const round = (b: Box): Box => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) })
