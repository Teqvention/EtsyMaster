"use client"

import * as React from "react"
import { Matrix } from "pixi.js"
import { cn } from "cn"

import type { Player } from "@/components/mockups/use-player"
import { frameAt } from "@/lib/mockups/motion"
import { SceneRenderer, type BuildOptions } from "@/lib/mockups/renderer"
import type { Motion, Point, Quad, Scene } from "@/lib/mockups/types"

export type Tool = "move" | "reveal" | "hide"
export type Phase = "start" | "move" | "end"

type View = { zoom: number; x: number; y: number }

const LOUPE = 180
const LOUPE_ZOOM = 4

// The Pixi view of a scene plus everything drawn over it in screen space:
// poster corners (with a loupe while dragging), layer bounds and the brush.
// With `motion` it is a viewfinder instead: the clip at the playhead, the
// room beyond the frame dimmed.
export function SceneCanvas({
  scene,
  build,
  rebuild,
  selected,
  tool,
  brush,
  loupeSrc,
  fit,
  onQuad,
  onStroke,
  onRenderer,
  onBuilt,
  motion,
}: {
  scene: Scene
  build: Omit<BuildOptions, "exact">
  /** Bump to rebuild with unchanged inputs (pixels changed in place). */
  rebuild: number
  selected: string | null
  tool: Tool
  /** Brush radius in scene px. */
  brush: number
  /** Image for the loupe: the room without the poster. */
  loupeSrc: string | null
  /** Bump to fit the scene into view. */
  fit: number
  onQuad: (id: string, quad: Quad, phase: Phase) => void
  onStroke: (point: Point, phase: Phase) => void
  onRenderer?: (renderer: SceneRenderer | null) => void
  onBuilt?: () => void
  motion?: { clip: Motion; player: Player } | null
}) {
  const host = React.useRef<HTMLDivElement>(null)
  const canvasHost = React.useRef<HTMLDivElement>(null)
  const [renderer, setRenderer] = React.useState<SceneRenderer | null>(null)
  const [size, setSize] = React.useState({ width: 0, height: 0 })
  const [view, setView] = React.useState<View>({ zoom: 0, x: 0, y: 0 })
  const [pointer, setPointer] = React.useState<Point | null>(null)
  const [drag, setDrag] = React.useState<
    | { kind: "corner"; id: string; corner: number; quad: Quad }
    | { kind: "quad"; id: string; quad: Quad; from: Point }
    | { kind: "pan"; from: Point; view: View }
    | { kind: "brush" }
    | null
  >(null)
  const [activeCorner, setActiveCorner] = React.useState<{ id: string; corner: number } | null>(null)
  const [space, setSpace] = React.useState(false)
  const [frame, setFrame] = React.useState(0)

  const onRendererRef = React.useRef(onRenderer)
  const onBuiltRef = React.useRef(onBuilt)
  const animating = React.useRef(false)
  React.useEffect(() => {
    onRendererRef.current = onRenderer
    onBuiltRef.current = onBuilt
    animating.current = !!motion
  })

  React.useEffect(() => {
    let alive = true
    let made: SceneRenderer | null = null
    // A canvas per renderer: destroying one loses its WebGL context for good.
    const canvas = document.createElement("canvas")
    canvas.className = "absolute inset-0"
    canvasHost.current!.appendChild(canvas)
    SceneRenderer.create(canvas).then((r) => {
      if (!alive) return r.destroy()
      made = r
      r.onTexture = () => setFrame((f) => f + 1)
      setRenderer(r)
      onRendererRef.current?.(r)
    })
    return () => {
      alive = false
      setRenderer(null)
      onRendererRef.current?.(null)
      made?.destroy()
      canvas.remove()
    }
  }, [])

  React.useEffect(() => {
    const el = host.current!
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const fitView = React.useCallback(() => {
    if (!size.width || !size.height) return
    const zoom = Math.min(size.width / scene.width, size.height / scene.height) * 0.94
    setView({
      zoom,
      x: (size.width - scene.width * zoom) / 2,
      y: (size.height - scene.height * zoom) / 2,
    })
  }, [size, scene.width, scene.height])

  // Fit on first layout and whenever asked to.
  const fitted = React.useRef(-1)
  React.useEffect(() => {
    if (!size.width || fitted.current === fit) return
    fitted.current = fit
    fitView()
  }, [fit, size.width, fitView])

  const [built, setBuilt] = React.useState(0)
  React.useEffect(() => {
    if (!renderer) return
    renderer.build(scene, build).then((current) => {
      if (!current) return
      setBuilt((b) => b + 1)
      onBuiltRef.current?.()
    })
  }, [renderer, scene, build, rebuild, frame])

  const clip = motion?.clip
  const player = motion?.player
  React.useEffect(() => {
    if (!renderer || !size.width || !view.zoom) return
    const matrix = new Matrix(view.zoom, 0, 0, view.zoom, view.x, view.y)
    let id = 0
    const draw = () => {
      cancelAnimationFrame(id)
      id = requestAnimationFrame(() => {
        const at = clip && player ? frameAt(scene, clip, player.time) : null
        renderer.draw(matrix, size.width, size.height, at)
      })
    }
    draw()
    const unsubscribe = player?.subscribe(draw)
    return () => {
      cancelAnimationFrame(id)
      unsubscribe?.()
    }
  }, [renderer, size, view, built, scene, clip, player])

  // Wheel zooms about the cursor; it must not scroll the page.
  React.useEffect(() => {
    const el = host.current!
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const sx = event.clientX - rect.left
      const sy = event.clientY - rect.top
      if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) >= Math.abs(event.deltaX) * 2) {
        const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015))
        setView((v) => {
          const zoom = Math.min(64, Math.max(0.02, v.zoom * factor))
          const k = zoom / v.zoom
          return { zoom, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k }
        })
      } else {
        setView((v) => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }))
      }
    }
    el.addEventListener("wheel", wheel, { passive: false })
    return () => el.removeEventListener("wheel", wheel)
  }, [])

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const focus = document.activeElement
      if (
        e.code === "Space" &&
        !animating.current &&
        !isTyping(e) &&
        (focus === host.current || focus === document.body)
      ) {
        e.preventDefault()
        setSpace(true)
      }
    }
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpace(false)
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [])

  const toScene = (event: React.PointerEvent): Point => {
    const rect = host.current!.getBoundingClientRect()
    return [
      (event.clientX - rect.left - view.x) / view.zoom,
      (event.clientY - rect.top - view.y) / view.zoom,
    ]
  }
  const toScreen = ([x, y]: Point): Point => [x * view.zoom + view.x, y * view.zoom + view.y]

  const posters = motion ? [] : scene.layers.filter((l) => l.kind === "poster")
  const active = posters.find((p) => p.id === selected)
  const selectedImage = motion ? undefined : scene.layers.find((l) => l.id === selected && l.kind === "image")
  const brushing = !motion && tool !== "move" && !space

  const startPan = (event: React.PointerEvent) => {
    setDrag({ kind: "pan", from: [event.clientX, event.clientY], view })
  }

  const onPointerDown = (event: React.PointerEvent) => {
    host.current!.focus()
    host.current!.setPointerCapture(event.pointerId)
    if (event.button === 1 || space) return startPan(event)
    if (event.button !== 0) return
    if (brushing) {
      setDrag({ kind: "brush" })
      onStroke(toScene(event), "start")
      return
    }
    const target = (event.target as Element).closest<SVGElement>("[data-corner],[data-quad]")
    if (target?.dataset.corner && active) {
      const corner = Number(target.dataset.corner)
      setActiveCorner({ id: active.id, corner })
      setDrag({ kind: "corner", id: active.id, corner, quad: active.quad })
      onQuad(active.id, active.quad, "start")
      return
    }
    if (target?.dataset.quad && active) {
      setDrag({ kind: "quad", id: active.id, quad: active.quad, from: toScene(event) })
      onQuad(active.id, active.quad, "start")
      return
    }
    setActiveCorner(null)
    startPan(event)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const p = toScene(event)
    setPointer(p)
    if (!drag) return
    if (drag.kind === "pan") {
      setView({
        ...drag.view,
        x: drag.view.x + event.clientX - drag.from[0],
        y: drag.view.y + event.clientY - drag.from[1],
      })
    } else if (drag.kind === "corner") {
      const quad = drag.quad.map((c, i) => (i === drag.corner ? round(p) : c)) as Quad
      onQuad(drag.id, quad, "move")
    } else if (drag.kind === "quad") {
      const dx = p[0] - drag.from[0]
      const dy = p[1] - drag.from[1]
      onQuad(drag.id, drag.quad.map(([x, y]) => round([x + dx, y + dy])) as Quad, "move")
    } else {
      onStroke(p, "move")
    }
  }

  const onPointerUp = (event: React.PointerEvent) => {
    if (drag?.kind === "brush") onStroke(toScene(event), "end")
    if (drag?.kind === "corner" || drag?.kind === "quad") {
      const poster = posters.find((p) => p.id === drag.id)
      if (poster) onQuad(drag.id, poster.quad, "end")
    }
    setDrag(null)
  }

  // Arrow keys nudge the last touched corner: 0.25 px, with Shift 2 px.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const keys: Record<string, Point> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const dir = keys[event.key]
    const poster = activeCorner && posters.find((p) => p.id === activeCorner.id)
    if (!dir || !poster || poster.id !== selected) return
    event.preventDefault()
    const step = event.shiftKey ? 2 : 0.25
    const quad = poster.quad.map((c, i) =>
      i === activeCorner.corner ? round([c[0] + dir[0] * step, c[1] + dir[1] * step]) : c
    ) as Quad
    onQuad(poster.id, poster.quad, "start")
    onQuad(poster.id, quad, "end")
  }

  const loupeCorner =
    drag?.kind === "corner" && active ? active.quad[drag.corner] : null

  return (
    <div
      ref={host}
      tabIndex={0}
      className={cn(
        "relative size-full overflow-hidden outline-none select-none",
        "bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-size-[16px_16px]",
        space || drag?.kind === "pan" ? "cursor-grab" : brushing ? "cursor-none" : "cursor-default"
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setPointer(null)}
      onKeyDown={onKeyDown}
    >
      <div ref={canvasHost} className="absolute inset-0" />
      <svg className="absolute inset-0 size-full overflow-visible">
        {selectedImage?.kind === "image" && (
          <rect
            x={toScreen([selectedImage.x, selectedImage.y])[0]}
            y={toScreen([selectedImage.x, selectedImage.y])[1]}
            width={selectedImage.width * view.zoom}
            height={selectedImage.height * view.zoom}
            className="fill-none stroke-sky-500"
            strokeDasharray="4 3"
          />
        )}
        {posters.map((poster) => {
          const pts = poster.quad.map(toScreen)
          const isActive = poster.id === active?.id && tool === "move"
          return (
            <g key={poster.id}>
              <polygon
                data-quad={isActive ? "1" : undefined}
                points={pts.map((p) => p.join(",")).join(" ")}
                className={cn(
                  "fill-transparent",
                  isActive ? "cursor-move stroke-sky-500" : "pointer-events-none stroke-white/60"
                )}
                strokeWidth={1}
                strokeDasharray={isActive ? undefined : "4 4"}
              />
              {isActive &&
                pts.map(([x, y], i) => (
                  <g key={i} data-corner={i} className="cursor-crosshair">
                    <circle cx={x} cy={y} r={10} className="fill-transparent" />
                    <circle
                      cx={x}
                      cy={y}
                      r={5}
                      className={cn(
                        "stroke-sky-500",
                        activeCorner?.id === poster.id && activeCorner.corner === i
                          ? "fill-sky-500"
                          : "fill-white"
                      )}
                      strokeWidth={1.5}
                    />
                  </g>
                ))}
            </g>
          )
        })}
        {motion && <Viewfinder from={toScreen([0, 0])} to={toScreen([scene.width, scene.height])} />}
        {brushing && pointer && (
          <circle
            cx={toScreen(pointer)[0]}
            cy={toScreen(pointer)[1]}
            r={Math.max(1, brush * view.zoom)}
            className={cn("fill-none", tool === "reveal" ? "stroke-emerald-400" : "stroke-rose-400")}
            strokeWidth={1.5}
          />
        )}
      </svg>
      {loupeCorner && loupeSrc && (
        <Loupe src={loupeSrc} scene={scene} at={loupeCorner} />
      )}
      {renderer === null && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          Starting renderer…
        </div>
      )}
    </div>
  )
}

/** Dims everything beyond the frame; the posed room still shows through. */
function Viewfinder({ from: [x0, y0], to: [x1, y1] }: { from: Point; to: Point }) {
  return (
    <>
      <path
        d={`M-1e5 -1e5H1e5V1e5H-1e5Z M${x0} ${y0}H${x1}V${y1}H${x0}Z`}
        fillRule="evenodd"
        className="pointer-events-none fill-background/80"
      />
      <rect
        x={x0}
        y={y0}
        width={x1 - x0}
        height={y1 - y0}
        className="pointer-events-none fill-none stroke-foreground/25"
      />
    </>
  )
}

/** The room around a corner, magnified, with a crosshair on the corner. */
function Loupe({ src, scene, at }: { src: string; scene: Scene; at: Point }) {
  const half = LOUPE / 2
  return (
    <div
      className="pointer-events-none absolute top-3 left-3 overflow-hidden rounded-full border-2 border-sky-500 bg-background shadow-lg"
      style={{
        width: LOUPE,
        height: LOUPE,
        backgroundImage: `url(${src})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${scene.width * LOUPE_ZOOM}px ${scene.height * LOUPE_ZOOM}px`,
        backgroundPosition: `${half - at[0] * LOUPE_ZOOM}px ${half - at[1] * LOUPE_ZOOM}px`,
        imageRendering: "pixelated",
      }}
    >
      <div className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-sky-500/80" />
      <div className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-sky-500/80" />
      <div className="absolute bottom-1.5 w-full text-center font-mono text-[10px] text-white [text-shadow:0_0_2px_black]">
        {at[0].toFixed(2)}, {at[1].toFixed(2)}
      </div>
    </div>
  )
}

const round = ([x, y]: Point): Point => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]

function isTyping(event: KeyboardEvent) {
  const el = event.target as HTMLElement
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
}
