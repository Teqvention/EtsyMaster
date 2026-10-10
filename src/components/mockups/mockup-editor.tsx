"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import {
  ArrowLeftIcon,
  BrushIcon,
  CheckIcon,
  DownloadIcon,
  EraserIcon,
  FilmIcon,
  LayersIcon,
  LoaderCircleIcon,
  MaximizeIcon,
  MousePointer2Icon,
  Redo2Icon,
  SaveIcon,
  Trash2Icon,
  Undo2Icon,
  VideoIcon,
} from "lucide-react"
import { toast } from "sonner"

import { ClipsPanel, useTemplates } from "@/components/mockups/clips-panel"
import { IconButton, LayersPanel } from "@/components/mockups/layers-panel"
import { MotionPanel, type KeyPatch } from "@/components/mockups/motion-panel"
import { PosterPicker, usePoster } from "@/components/mockups/poster-picker"
import { PropertiesPanel } from "@/components/mockups/properties-panel"
import { SceneCanvas, type Phase, type Tool } from "@/components/mockups/scene-canvas"
import { Timeline } from "@/components/mockups/timeline"
import { useHistory } from "@/components/mockups/use-history"
import { usePlayer } from "@/components/mockups/use-player"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  canvas as makeCanvas,
  download,
  extractSheetInWorker,
  fetchScene,
  fileUrl,
  pngBlob,
  putFile,
  putScene,
  toCanvas,
} from "@/lib/mockups/client"
import {
  findLayer,
  freshFile,
  insertLayer,
  isImage,
  moveLayer,
  parentOf,
  posterBelow,
  removeLayer,
  uniqueId,
  updateLayer,
  type AnyLayer,
} from "@/lib/mockups/edit"
import { exportName, exportScene, thumbJpeg } from "@/lib/mockups/export"
import { clipFrom, hash, motionOf, shotAt } from "@/lib/mockups/motion"
import { decode, SceneRenderer, type Source } from "@/lib/mockups/renderer"
import type {
  Clip,
  ImageLayer,
  Keyframe,
  Layer,
  Motion,
  Point,
  PosterChild,
  PosterLayer,
  Quad,
  Scene,
  Template,
} from "@/lib/mockups/types"
import { clipFileName, encodeMotion, exportClip, PREVIEW } from "@/lib/mockups/video"

export function MockupEditor({ id }: { id: Promise<string> }) {
  const sceneId = React.use(id)
  const [scene, setScene] = React.useState<Scene | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let alive = true
    fetchScene(sceneId)
      .then((s) => alive && setScene(s))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [sceneId])

  if (error) {
    return (
      <div className="px-4 text-sm text-muted-foreground lg:px-6">
        Couldn&apos;t open this mockup: {error}.{" "}
        <Link href="/mockups" className="underline">
          Back to all mockups
        </Link>
      </div>
    )
  }
  if (!scene) {
    return (
      <div className="px-4 lg:px-6">
        <Skeleton className="h-[calc(100svh-var(--header-height)-3rem)] w-full rounded-xl" />
      </div>
    )
  }
  return <Editor key={scene.id} initial={scene} />
}

type Busy = "save" | "video" | "export" | "generate" | "brush" | null
type Mode = "layers" | "animate"

const sheetKey = (p: PosterLayer) => JSON.stringify([p.quad, p.sheet?.flat])

/** The whole room, still: what the viewfinder shows before any animation. */
const IDLE: Motion = { duration: 1, shake: 0, keys: [] }

function Editor({ initial }: { initial: Scene }) {
  const router = useRouter()
  const history = useHistory(initial)
  const scene = history.value
  const sceneRef = React.useRef(scene)
  React.useEffect(() => {
    sceneRef.current = scene
  })
  const poster = usePoster()

  // Pixels made in the browser (uploads, brush canvases, light maps) until saved.
  const local = React.useRef(new Map<string, Source>())
  const originals = React.useRef(new Map<string, Blob>())
  const uploaded = React.useRef(new Set<string>())
  const [localSrcs, setLocalSrcs] = React.useState<ReadonlySet<string>>(() => new Set())
  const addLocal = (src: string, source: Source, original?: Blob) => {
    local.current.set(src, source)
    if (original) originals.current.set(src, original)
    setLocalSrcs((s) => new Set(s).add(src))
  }

  const [saved, setSaved] = React.useState(initial)
  const [unsavedPixels, setUnsavedPixels] = React.useState(false)
  const dirty = scene !== saved || unsavedPixels

  const [selected, setSelected] = React.useState<string | null>(
    () => initial.layers.find((l) => l.kind === "poster")?.id ?? null
  )
  const [chosenTool, setTool] = React.useState<Tool>("move")
  const [brush, setBrush] = React.useState(() => Math.round(initial.width / 120))
  const [fit, setFit] = React.useState(0)
  const [rebuild, setRebuild] = React.useState(0)
  const [busy, setBusy] = React.useState<Busy>(null)
  /** Percent done of a long save or export. */
  const [progress, setProgress] = React.useState<number | null>(null)
  const display = React.useRef<SceneRenderer | null>(null)

  const [mode, setMode] = React.useState<Mode>("layers")
  const clips = scene.clips ?? []
  const [clipId, setClipId] = React.useState<string | null>(
    () => (initial.clips?.find((c) => c.video) ?? initial.clips?.[0])?.id ?? null
  )
  const clip = clips.find((c) => c.id === clipId) ?? null
  const [keyIndex, setKeyIndex] = React.useState<number | null>(0)
  const player = usePlayer()
  const templates = useTemplates()
  const [still, setStill] = React.useState<string | null>(null)

  // Light maps that came with the scene count as made for its corners.
  const [generatedFor, setGeneratedFor] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(
      initial.layers
        .filter((l): l is PosterLayer => l.kind === "poster" && l.children.some((c) => c.role === "light"))
        .map((p) => [p.id, sheetKey(p)])
    )
  )

  const resolve = React.useCallback(
    (src: string): Source => local.current.get(src) ?? fileUrl(initial.id, src),
    // A new function whenever the local pixels change, so the canvas rebuilds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initial.id, localSrcs]
  )
  const build = React.useMemo(
    () => ({ resolve, poster: poster?.bitmap ?? null }),
    [resolve, poster]
  )

  const layer = findLayer(scene, selected)
  const selectedPoster = layer?.kind === "poster" ? layer : null
  const canBrush = isImage(layer) && layer.role === "front"
  const tool: Tool = canBrush && mode === "layers" ? chosenTool : "move"

  const patch = (id: string, p: Partial<AnyLayer>, merge?: string) =>
    history.commit((s) => updateLayer(s, id, p), merge)

  const loadDrawable = async (src: string): Promise<CanvasImageSource> => {
    const source = resolve(src)
    if (typeof source !== "string") return source
    const response = await fetch(source)
    if (!response.ok) throw new Error(`${src}: ${response.status}`)
    return decode(await response.blob())
  }

  // ── Corners ──────────────────────────────────────────────────────────────
  const dragToken = React.useRef("")
  const onQuad = (id: string, quad: Quad, phase: Phase) => {
    if (phase === "start") dragToken.current = `drag:${id}:${performance.now()}`
    const current = findLayer(sceneRef.current, id)
    if (current?.kind === "poster" && JSON.stringify(current.quad) === JSON.stringify(quad)) return
    patch(id, { quad } as Partial<PosterLayer>, dragToken.current)
  }

  // ── Front brush ─────────────────────────────────────────────────────────
  const brushState = React.useRef<{
    layerId: string
    canvas: HTMLCanvasElement
    ctx: CanvasRenderingContext2D
    source: HTMLCanvasElement
    stamp: HTMLCanvasElement
    last: Point | null
  } | null>(null)

  async function prepareBrush(layerId: string) {
    const s = sceneRef.current
    const front = s.layers.find((l): l is ImageLayer => l.id === layerId && l.kind === "image")
    if (!front) return
    // What Reveal copies: the room as rendered under the poster, without the lift.
    const below = posterBelow(s, layerId)
    const from = below >= 0 ? below : s.layers.indexOf(front)
    const hide = new Set(s.layers.slice(from).map((l) => l.id))
    s.layers.forEach((l) => l.kind === "image" && l.role === "lift" && hide.add(l.id))
    const r = await SceneRenderer.create()
    let source: HTMLCanvasElement
    try {
      await r.build(s, { resolve, poster: null, exact: true, hide })
      source = toCanvas(r.pixels())
    } finally {
      r.destroy()
    }

    let canvas = local.current.get(front.src)
    const full =
      canvas instanceof HTMLCanvasElement &&
      front.x === 0 && front.y === 0 && front.width === s.width && front.height === s.height
    if (!full) {
      const c = makeCanvas(s.width, s.height)
      c.getContext("2d")!.drawImage(await loadDrawable(front.src), front.x, front.y, front.width, front.height)
      const src = freshFile(front.id)
      addLocal(src, c)
      patch(front.id, { src, x: 0, y: 0, width: s.width, height: s.height })
      canvas = c
    }
    const c = canvas as HTMLCanvasElement
    brushState.current = {
      layerId,
      canvas: c,
      ctx: c.getContext("2d")!,
      source,
      stamp: makeCanvas(1, 1),
      last: null,
    }
  }

  const brushSrc = canBrush ? layer.src : null
  React.useEffect(() => {
    if (tool === "move" || !canBrush || !selected) return
    const b = brushState.current
    if (b && b.layerId === selected && local.current.get(brushSrc!) === b.canvas) return
    let alive = true
    setBusy("brush")
    prepareBrush(selected)
      .catch((e: Error) => toast.error(`Brush: ${e.message}`))
      .finally(() => alive && setBusy(null))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, selected, brushSrc, canBrush])

  const refreshPending = React.useRef(false)
  const onStroke = (p: Point, phase: Phase) => {
    const b = brushState.current
    if (!b || busy === "brush" || b.layerId !== selected) return
    if (phase === "start") b.last = null
    const spacing = Math.max(1, brush * 0.2)
    const from = b.last ?? p
    const steps = Math.max(1, Math.ceil(Math.hypot(p[0] - from[0], p[1] - from[1]) / spacing))
    for (let i = b.last ? 1 : 0; i <= steps; i++) {
      const t = i / steps
      stamp(b, [from[0] + (p[0] - from[0]) * t, from[1] + (p[1] - from[1]) * t])
    }
    b.last = p
    if (!refreshPending.current) {
      refreshPending.current = true
      requestAnimationFrame(() => {
        refreshPending.current = false
        display.current?.refresh(b.canvas).then(() => setRebuild((n) => n + 1))
      })
    }
    if (phase === "end") {
      const src = [...local.current].find(([, v]) => v === b.canvas)?.[0]
      if (src) uploaded.current.delete(src)
      setUnsavedPixels(true)
    }
  }

  function stamp(b: NonNullable<typeof brushState.current>, [x, y]: Point) {
    const r = brush
    const soft = (ctx: CanvasRenderingContext2D, cx: number, cy: number) => {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      g.addColorStop(0, "rgba(0,0,0,1)")
      g.addColorStop(0.6, "rgba(0,0,0,1)")
      g.addColorStop(1, "rgba(0,0,0,0)")
      return g
    }
    if (tool === "reveal") {
      const size = Math.ceil(2 * r) + 2
      const s = b.stamp
      if (s.width !== size) s.width = s.height = size
      const sx = Math.floor(x - r) - 1
      const sy = Math.floor(y - r) - 1
      const sc = s.getContext("2d")!
      sc.globalCompositeOperation = "copy"
      sc.drawImage(b.source, sx, sy, size, size, 0, 0, size, size)
      sc.globalCompositeOperation = "destination-in"
      sc.fillStyle = soft(sc, x - sx, y - sy)
      sc.fillRect(0, 0, size, size)
      b.ctx.drawImage(s, sx, sy)
    } else {
      b.ctx.globalCompositeOperation = "destination-out"
      b.ctx.fillStyle = soft(b.ctx, x, y)
      b.ctx.beginPath()
      b.ctx.arc(x, y, r, 0, Math.PI * 2)
      b.ctx.fill()
      b.ctx.globalCompositeOperation = "source-over"
    }
  }

  // ── Light & shine ───────────────────────────────────────────────────────
  async function generate() {
    const p = selectedPoster
    const sheet = p?.sheet
    if (!p || !sheet) return
    const src = scene.layers.find((l): l is ImageLayer => l.id === sheet.source && l.kind === "image")
    if (!src) return toast.error("Choose the layer that holds the empty sheet")
    setBusy("generate")
    try {
      const room = makeCanvas(scene.width, scene.height)
      const ctx = room.getContext("2d", { willReadFrequently: true })!
      ctx.drawImage(await loadDrawable(src.src), src.x, src.y, src.width, src.height)
      const { data } = ctx.getImageData(0, 0, scene.width, scene.height)
      const result = await extractSheetInWorker(
        { data, width: scene.width, height: scene.height },
        p.quad,
        sheet.flat
      )
      const { width, height } = result
      const lightSrc = freshFile("light")
      const shineSrc = freshFile("shine")
      addLocal(lightSrc, toCanvas({ data: result.light, width, height }))
      addLocal(shineSrc, toCanvas({ data: result.shine, width, height }))
      history.commit((s) => {
        const current = findLayer(s, p.id) as PosterLayer
        const children = [...current.children]
        const put = (role: "light" | "shine", make: () => PosterChild) => {
          const i = children.findIndex((c) => c.role === role)
          const src = role === "light" ? lightSrc : shineSrc
          if (i >= 0) children[i] = { ...children[i], src, width, height }
          else children.push({ ...make(), src, width, height })
        }
        put("light", () => ({
          id: uniqueId(s, "light"), kind: "image", name: "Light", src: "", width, height,
          blend: "multiply", opacity: 1, visible: true, role: "light",
        }))
        put("shine", () => ({
          id: uniqueId(s, "shine"), kind: "image", name: "Glass reflection", src: "", width, height,
          blend: "add", opacity: current.sheet?.shine ?? 0.45, visible: true, role: "shine",
        }))
        return updateLayer(s, p.id, { children, fit: "cover", aspect: height / width } as Partial<PosterLayer>)
      })
      setGeneratedFor((g) => ({ ...g, [p.id]: sheetKey(p) }))
      toast.success(`Light & shine from a ${width} × ${height} px sheet`)
    } catch (e) {
      toast.error(`Couldn't read the sheet: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  // ── Layers ──────────────────────────────────────────────────────────────
  async function addImage(file: File) {
    const bitmap = await decode(file)
    const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png"
    const src = freshFile(file.name.replace(/\.[^.]+$/, ""), ext)
    addLocal(src, bitmap, file)
    const s = sceneRef.current
    const f = Math.min(1, s.width / bitmap.width, s.height / bitmap.height)
    const width = Math.round(bitmap.width * f)
    const height = Math.round(bitmap.height * f)
    const id = uniqueId(s, "layer")
    const layer: Layer = {
      id, kind: "image", name: file.name.replace(/\.[^.]+$/, ""), src,
      x: Math.round((s.width - width) / 2), y: Math.round((s.height - height) / 2), width, height,
      blend: "normal", opacity: 1, visible: true,
    }
    const above = s.layers.some((l) => l.id === selected) ? selected : null
    history.commit((s) => insertLayer(s, layer, above))
    setSelected(id)
  }

  async function replaceImage(file: File) {
    if (!layer || layer.kind !== "image") return
    const bitmap = await decode(file)
    const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png"
    const src = freshFile(layer.id, ext)
    addLocal(src, bitmap, file)
    patch(layer.id, isImage(layer) ? { src } : { src, width: bitmap.width, height: bitmap.height })
  }

  function addPoster() {
    const s = sceneRef.current
    const h = s.height * 0.4
    const w = h / 1.4
    const x = (s.width - w) / 2
    const y = (s.height - h) / 2
    const id = uniqueId(s, "poster")
    history.commit((s) =>
      insertLayer(s, {
        id, kind: "poster", name: "Poster",
        quad: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
        overscan: 0, fit: "cover", aspect: 1.4, tone: true,
        blend: "normal", opacity: 1, visible: true, children: [],
      })
    )
    setSelected(id)
    setTool("move")
  }

  function addFront() {
    const s = sceneRef.current
    const picked = s.layers.findIndex((l) => l.kind === "poster" && l.id === selected)
    const target = picked >= 0 ? picked : s.layers.findLastIndex((l) => l.kind === "poster")
    if (target < 0) return
    const c = makeCanvas(s.width, s.height)
    const src = freshFile("front")
    addLocal(src, c)
    const id = uniqueId(s, "front")
    history.commit((s) =>
      insertLayer(
        s,
        {
          id, kind: "image", name: "In front of poster", src,
          x: 0, y: 0, width: s.width, height: s.height,
          blend: "normal", opacity: 1, visible: true, role: "front",
        },
        s.layers[target].id
      )
    )
    setSelected(id)
    setTool("reveal")
  }

  function duplicate(id: string) {
    const s = sceneRef.current
    const original = findLayer(s, id)
    if (!original) return
    const copy = { ...original, id: uniqueId(s, `${id}-copy`), name: `${original.name} copy` }
    const parent = parentOf(s, id)
    if (parent) {
      const children = [...parent.children]
      children.splice(children.findIndex((c) => c.id === id) + 1, 0, copy as PosterChild)
      history.commit((s) => updateLayer(s, parent.id, { children } as Partial<PosterLayer>))
    } else {
      const layer = copy as Layer
      if (layer.kind === "poster") {
        layer.children = layer.children.map((c) => ({ ...c, id: uniqueId(s, `${c.id}-copy`) }))
      }
      history.commit((s) => insertLayer(s, layer, id))
    }
    setSelected(copy.id)
  }

  // ── Animations ──────────────────────────────────────────────────────────
  React.useEffect(() => {
    player.setDuration(clip?.duration ?? 1)
  }, [player, clip?.duration])

  const stillTimer = React.useRef(0)
  const makeStill = () => {
    window.clearTimeout(stillTimer.current)
    stillTimer.current = window.setTimeout(() => {
      const r = display.current
      const s = sceneRef.current
      if (!r) return
      try {
        // Twice the tile size; the browser scales it down more cleanly than Pixi.
        const c = toCanvas(r.pixels(Math.min(1, 720 / Math.min(s.width, s.height))))
        setStill(c.toDataURL("image/jpeg", 0.85))
      } catch {
        // Not built yet; the next build tries again.
      }
    }, 150)
  }

  function switchMode(next: Mode) {
    setMode(next)
    if (next === "animate") {
      makeStill()
      player.seek(0)
    } else player.pause()
  }

  function selectClip(id: string, play = false) {
    setClipId(id)
    setKeyIndex(0)
    player.pause()
    player.seek(0)
    if (play) player.play()
  }

  const commitClips = (fn: (clips: Clip[]) => Clip[], merge?: string) =>
    history.commit((s) => ({ ...s, clips: fn(s.clips ?? []) }), merge)

  const patchClip = (id: string, p: Partial<Clip>, merge?: string) =>
    commitClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)), merge)

  function addClip(template: Template) {
    const c = clipFrom(template, sceneRef.current)
    commitClips((cs) => [...cs, c])
    selectClip(c.id, true)
  }

  function duplicateClip(id: string) {
    const original = clips.find((c) => c.id === id)
    if (!original) return
    const c = clipFrom({ ...original, name: `${original.name} copy` }, sceneRef.current)
    commitClips((cs) => {
      const next = [...cs]
      next.splice(cs.findIndex((x) => x.id === id) + 1, 0, c)
      return next
    })
    selectClip(c.id)
  }

  function deleteClip(id: string) {
    const i = clips.findIndex((c) => c.id === id)
    commitClips((cs) => cs.filter((c) => c.id !== id))
    const next = clips.filter((c) => c.id !== id)[Math.min(i, clips.length - 2)]
    if (next) selectClip(next.id)
    else setClipId(null)
  }


  const patchKeys = (fn: (keys: Keyframe[]) => Keyframe[], merge?: string) =>
    clip && commitClips((cs) => cs.map((c) => (c.id === clip.id ? { ...c, keys: fn(c.keys) } : c)), merge)

  function selectKey(index: number) {
    if (!clip) return
    setKeyIndex(index)
    player.pause()
    player.seek(clip.keys[index].t * clip.duration)
  }

  function patchKey(index: number, p: KeyPatch, merge?: string) {
    patchKeys(
      (keys) => keys.map((k, i) => (i === index ? { ...k, ...p, shot: { ...k.shot, ...p.shot } } : k)),
      merge
    )
    // Show the key being edited.
    if (clip) {
      player.pause()
      player.seek(clip.keys[index].t * clip.duration)
    }
  }

  function addKey() {
    if (!clip) return
    const t = Math.round((player.time / clip.duration) * 1000) / 1000
    const near = clip.keys.findIndex((k) => Math.abs(k.t - t) < 0.01)
    if (near >= 0) return selectKey(near)
    const at = clip.keys.findIndex((k) => k.t > t)
    const index = at < 0 ? clip.keys.length : at
    const key: Keyframe = { t, ease: clip.keys[index - 1]?.ease ?? "smooth", shot: shotAt(clip, t) }
    patchKeys((keys) => [...keys.slice(0, index), key, ...keys.slice(index)])
    setKeyIndex(index)
    player.pause()
  }

  function deleteKey() {
    if (!clip || keyIndex === null || clip.keys.length < 2) return
    patchKeys((keys) => keys.filter((_, i) => i !== keyIndex))
    setKeyIndex(Math.min(keyIndex, clip.keys.length - 2))
  }

  async function saveTemplate(id: string) {
    const c = clips.find((x) => x.id === id)
    if (c) await templates.save(c).catch((e: Error) => toast.error(`Couldn't save template: ${e.message}`))
  }

  /** Hover previews for the mockups page, re-made only for clips whose look changed. */
  async function withPreviews(r: SceneRenderer, s: Scene, posterKey: string): Promise<Scene> {
    if (!s.clips?.length) return s
    const named = s.clips.map((c) => ({
      clip: c,
      name: `motion-${hash(JSON.stringify([motionOf(c), s.layers, s.width, s.height, posterKey]))}.mp4`,
    }))
    const todo = named.filter(({ clip, name }) => clip.preview !== name)
    try {
      for (const [i, { name, clip }] of todo.entries()) {
        const video = await encodeMotion(r, s, clip, PREVIEW, (p) =>
          setProgress(Math.floor(((i + p) / todo.length) * 100))
        )
        await putFile(s.id, name, video)
      }
      return { ...s, clips: named.map(({ clip, name }) => ({ ...clip, preview: name })) }
    } catch (e) {
      toast.warning(`Saved without hover previews: ${(e as Error).message}`)
      return s
    }
  }

  // ── Save / export ───────────────────────────────────────────────────────
  async function save(s = sceneRef.current, as: "save" | "video" = "save") {
    if (busy) return
    setBusy(as)
    try {
      const srcs = new Set<string>()
      for (const l of s.layers) {
        if (l.kind === "image") srcs.add(l.src)
        else l.children.forEach((c) => srcs.add(c.src))
      }
      for (const src of srcs) {
        const source = local.current.get(src)
        if (!source || uploaded.current.has(src)) continue
        const blob = originals.current.get(src) ?? (await pngBlob(asCanvas(source)))
        await putFile(s.id, src, blob)
        uploaded.current.add(src)
      }
      let out = s
      if (poster) {
        const r = await SceneRenderer.create()
        try {
          await r.build(s, { resolve, poster: poster.bitmap })
          await putFile(s.id, "thumb.jpg", await thumbJpeg(r, s))
          // Painted pixels keep their file names, so they need fresh previews.
          const { name, bitmap } = poster
          out = await withPreviews(r, s, [name, bitmap.width, bitmap.height, unsavedPixels && Date.now()].join())
        } finally {
          r.destroy()
        }
      }
      // After the previews: saving drops files the scene doesn't name.
      await putScene(out)
      history.replace(s, out)
      setSaved(out)
      setUnsavedPixels(false)
      toast.success(as === "video" ? "Saved as a video — chains can pick it now" : "Saved")
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`)
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  /** Makes the clip one of the videos a chain can pick, and saves the mockup. */
  function saveAsVideo() {
    if (!clip || busy) return
    const s = sceneRef.current
    const next = clip.video
      ? s
      : { ...s, clips: (s.clips ?? []).map((c) => (c.id === clip.id ? { ...c, video: true } : c)) }
    history.commit(next)
    save(next, "video")
  }

  async function exportJpeg() {
    if (!poster || busy) return
    setBusy("export")
    try {
      const s = sceneRef.current
      download(await exportScene(s, poster.bitmap, resolve), exportName(s))
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  async function exportVideo() {
    if (!poster || !clip || busy) return
    setBusy("export")
    setProgress(0)
    try {
      const s = sceneRef.current
      const video = await exportClip(s, clip, poster.bitmap, resolve, (p) => setProgress(Math.floor(p * 100)))
      download(video, clipFileName(s, clip))
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`)
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  async function deleteScene() {
    if (!confirm(`Delete “${scene.name}” and all its layer images?`)) return
    const response = await fetch(`/api/mockups/${scene.id}`, { method: "DELETE" })
    if (!response.ok) return toast.error("Delete failed")
    setSaved(scene)
    setUnsavedPixels(false)
    router.push("/mockups")
  }

  // ── Keyboard ────────────────────────────────────────────────────────────
  // What the pointer focused last. :focus-visible can't tell: any key press
  // makes the focused element match it.
  const clicked = React.useRef<EventTarget | null>(null)
  React.useEffect(() => {
    let pointer = false
    const down = () => {
      pointer = true
      setTimeout(() => (pointer = false))
    }
    const focus = (e: FocusEvent) => (clicked.current = pointer ? e.target : null)
    window.addEventListener("pointerdown", down, true)
    window.addEventListener("focusin", focus)
    return () => {
      window.removeEventListener("pointerdown", down, true)
      window.removeEventListener("focusin", focus)
    }
  }, [])

  const keys = React.useRef<(e: KeyboardEvent) => void>(() => {})
  React.useEffect(() => {
    keys.current = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const range = el instanceof HTMLInputElement && el.type === "range"
      if (el.isContentEditable || (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && !range)) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && key === "z") {
        e.preventDefault()
        if (e.shiftKey) history.redo()
        else history.undo()
      } else if (mod && key === "y") {
        e.preventDefault()
        history.redo()
      } else if (mod && key === "s") {
        e.preventDefault()
        save()
      } else if (mod) {
        return
      } else if (key === "f") setFit((f) => f + 1)
      else if (mode === "animate") {
        if (key !== " " || e.defaultPrevented) return
        // Space belongs to a control the keyboard reached. One that was just
        // clicked (a template, a clip, a slider) hands it back to playback.
        if (el !== document.body && el !== clicked.current) return
        e.preventDefault()
        el.blur()
        player.toggle()
      } else if (key === "v") setTool("move")
      else if (key === "b" && canBrush) setTool("reveal")
      else if (key === "e" && canBrush) setTool("hide")
      else if (key === "[") setBrush((b) => Math.max(1, Math.round(b / 1.2)))
      else if (key === "]") setBrush((b) => Math.min(800, Math.round(b * 1.2) + 1))
    }
  })
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  React.useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  const loupeLayer =
    scene.layers.find(
      (l): l is ImageLayer => l.kind === "image" && l.id === (selectedPoster?.sheet?.source ?? "")
    ) ?? scene.layers.find((l): l is ImageLayer => l.kind === "image" && l.role === "background")
  const loupeSrc =
    loupeLayer && !localSrcs.has(loupeLayer.src) ? fileUrl(scene.id, loupeLayer.src) : null

  const stale =
    !!selectedPoster?.sheet &&
    selectedPoster.children.some((c) => c.role === "light") &&
    generatedFor[selectedPoster.id] !== sheetKey(selectedPoster)

  return (
    <div className="flex h-[calc(100svh-var(--header-height)-3.5rem)] min-h-[520px] flex-col gap-3 px-4 lg:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="All mockups"
          nativeButton={false}
          render={<Link href="/mockups" />}
        >
          <ArrowLeftIcon />
        </Button>
        <span className="truncate text-sm font-medium">{scene.name}</span>
        {dirty && <span className="size-1.5 rounded-full bg-amber-500" aria-label="Unsaved changes" />}
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[mode]}
          onValueChange={(v) => v[0] && switchMode(v[0] as Mode)}
          aria-label="Mode"
          className="ml-2"
        >
          <ToggleGroupItem value="layers">
            <LayersIcon /> Layers
          </ToggleGroupItem>
          <ToggleGroupItem value="animate">
            <FilmIcon /> Animate
          </ToggleGroupItem>
        </ToggleGroup>
        {mode === "layers" && (
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            value={[tool]}
            onValueChange={(v) => v[0] && setTool(v[0] as Tool)}
            aria-label="Tool"
          >
            <ToggleGroupItem value="move" aria-label="Move (V)">
              <MousePointer2Icon />
            </ToggleGroupItem>
            <ToggleGroupItem value="reveal" aria-label="Reveal brush (B)" disabled={!canBrush}>
              <BrushIcon /> Reveal
            </ToggleGroupItem>
            <ToggleGroupItem value="hide" aria-label="Hide brush (E)" disabled={!canBrush}>
              <EraserIcon /> Hide
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        {tool !== "move" && (
          <div className="flex w-44 items-center gap-2 text-xs text-muted-foreground">
            <Slider
              value={brush}
              min={1}
              max={Math.round(scene.width / 10)}
              onValueChange={(v) => setBrush(Array.isArray(v) ? v[0] : v)}
            />
            <span className="w-12 tabular-nums">{brush} px</span>
          </div>
        )}
        {busy === "brush" && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <LoaderCircleIcon className="size-3.5 animate-spin" /> Preparing brush…
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <PosterPicker />
          <IconButton label="Undo (⌘Z)" onClick={history.undo} disabled={!history.canUndo}>
            <Undo2Icon />
          </IconButton>
          <IconButton label="Redo (⇧⌘Z)" onClick={history.redo} disabled={!history.canRedo}>
            <Redo2Icon />
          </IconButton>
          <IconButton label="Fit to view (F)" onClick={() => setFit((f) => f + 1)}>
            <MaximizeIcon />
          </IconButton>
          <IconButton label="Delete mockup" onClick={deleteScene}>
            <Trash2Icon />
          </IconButton>
          {mode === "layers" ? (
            <Button variant="outline" size="sm" onClick={exportJpeg} disabled={!poster || !!busy}>
              {busy === "export" ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
              {exportName(scene)}
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={exportVideo} disabled={!poster || !clip || !!busy}>
                {busy === "export" ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
                {clip ? clipFileName(scene, clip) : "Export MP4"}
                {busy === "export" && progress !== null && (
                  <span className="text-muted-foreground tabular-nums">{progress} %</span>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={saveAsVideo}
                disabled={!clip || !!busy || (clip.video && !dirty)}
                title={clip?.video ? "Chains can pick this animation as their video" : "Save this animation as a video chains can pick"}
              >
                {busy === "video" ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : clip?.video && !dirty ? (
                  <CheckIcon />
                ) : (
                  <VideoIcon />
                )}
                {clip?.video && !dirty ? "Saved as video" : "Save as video"}
                {busy === "video" && progress !== null && (
                  <span className="text-muted-foreground tabular-nums">{progress} %</span>
                )}
              </Button>
            </>
          )}
          <Button size="sm" onClick={() => save()} disabled={!dirty || !!busy}>
            {busy === "save" ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />}
            Save
            {busy === "save" && progress !== null && <span className="tabular-nums opacity-70">{progress} %</span>}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[15rem_minmax(0,1fr)_17rem] overflow-hidden rounded-xl border bg-card">
        {mode === "animate" ? (
          <ClipsPanel
            scene={scene}
            selected={clip?.id ?? null}
            still={still}
            saved={templates.saved}
            onSelect={(id) => selectClip(id)}
            onAdd={addClip}
            onDuplicate={duplicateClip}
            onDelete={deleteClip}
            onSaveTemplate={saveTemplate}
            onRemoveTemplate={(t) => templates.remove(t).catch((e: Error) => toast.error(e.message))}
          />
        ) : (
          <LayersPanel
            scene={scene}
            selected={selected}
            onSelect={setSelected}
            onToggle={(id, visible) => patch(id, { visible })}
            onMove={(id, by) => history.commit((s) => moveLayer(s, id, by))}
            onDuplicate={duplicate}
            onDelete={(id) => {
              history.commit((s) => removeLayer(s, id))
              setSelected(null)
            }}
            onAddImage={(file) => addImage(file).catch((e: Error) => toast.error(e.message))}
            onAddPoster={addPoster}
            onAddFront={addFront}
          />
        )}
        <div className="flex min-h-0 flex-col border-x">
          <div className="min-h-0 flex-1">
            <SceneCanvas
              scene={scene}
              build={build}
              rebuild={rebuild}
              selected={selected}
              tool={tool}
              brush={brush}
              loupeSrc={loupeSrc}
              fit={fit}
              onQuad={onQuad}
              onStroke={onStroke}
              onRenderer={(r) => (display.current = r)}
              onBuilt={() => mode === "animate" && makeStill()}
              motion={mode === "animate" ? { clip: clip ?? IDLE, player } : null}
            />
          </div>
          {mode === "animate" && clip && (
            <Timeline
              clip={clip}
              player={player}
              selected={keyIndex}
              onSelect={selectKey}
              onRetime={(index, t, merge) =>
                patchKeys((keys) => keys.map((k, i) => (i === index ? { ...k, t } : k)), merge)
              }
              onAdd={addKey}
              onDelete={deleteKey}
            />
          )}
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="px-3 py-2 text-sm font-medium">
            {mode === "animate" ? "Animation" : layer ? (layer.kind === "poster" ? "Poster" : "Layer") : "Mockup"}
          </div>
          {mode === "animate" ? (
            <MotionPanel
              clip={clip}
              keyIndex={keyIndex}
              onClip={(p, merge) => clip && patchClip(clip.id, p, merge)}
              onVideo={(on) => clip && patchClip(clip.id, { video: on })}
              onKey={patchKey}
            />
          ) : (
            <PropertiesPanel
              scene={scene}
              layer={layer}
              stale={stale}
              generating={busy === "generate"}
              onScene={(p, merge) => history.commit((s) => ({ ...s, ...p }), merge)}
              onPatch={(p, merge) => selected && patch(selected, p, merge)}
              onReplace={(file) => replaceImage(file).catch((e: Error) => toast.error(e.message))}
              onGenerate={generate}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function asCanvas(source: Source): HTMLCanvasElement {
  if (source instanceof HTMLCanvasElement) return source
  if (typeof source === "string") throw new Error("Not local")
  const c = makeCanvas(source.width, source.height)
  c.getContext("2d")!.drawImage(source, 0, 0)
  return c
}
