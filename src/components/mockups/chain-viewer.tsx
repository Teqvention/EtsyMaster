"use client"

import Link from "next/link"
import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon, FrameIcon, PencilIcon, PlayIcon } from "lucide-react"

import { usePoster } from "@/components/mockups/poster-picker"
import { Button } from "@/components/ui/button"
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import type { MockupChain } from "@/lib/mockups/chain-types"
import { fetchScene, fileUrl, toCanvas } from "@/lib/mockups/client"
import { SceneRenderer } from "@/lib/mockups/renderer"
import type { SceneSummary } from "@/lib/mockups/types"
import { cn } from "@/lib/utils"

// A chain as the listing will show it, one picture at a time: the photos in
// order, then the video. ←/→ and the thumbnails switch. Photos show the
// saved thumbnail at once and sharpen into a render with the current poster.

export type ChainItem =
  | { kind: "photo"; scene: SceneSummary; place: number }
  | { kind: "video"; scene: SceneSummary; clipId: string }

/** What the chain shows, in listing order; scenes and clips deleted meanwhile are skipped. */
export function chainItems(chain: MockupChain, scenes: ReadonlyMap<string, SceneSummary>): ChainItem[] {
  const photos = chain.scenes.flatMap((id) => {
    const scene = scenes.get(id)
    return scene ? [scene] : []
  })
  const items: ChainItem[] = photos.map((scene, i) => ({ kind: "photo", scene, place: i + 1 }))
  const { video } = chain
  const videoScene = video && scenes.get(video.sceneId)
  if (video && videoScene?.clips.some((c) => c.id === video.clipId)) {
    items.push({ kind: "video", scene: videoScene, clipId: video.clipId })
  }
  return items
}

export function ChainViewer({
  chain,
  items,
  index,
  onIndex,
}: {
  chain: MockupChain
  items: ChainItem[]
  index: number
  onIndex: (index: number) => void
}) {
  const item = items[index]
  const hasPrev = index > 0
  const hasNext = index < items.length - 1

  // On the popup rather than the window: the panel around the dialog (tabs)
  // keeps arrow keys from bubbling that far.
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === "ArrowLeft" && hasPrev) onIndex(index - 1)
    else if (event.key === "ArrowRight" && hasNext) onIndex(index + 1)
    else if (event.key === "Home" && hasPrev) onIndex(0)
    else if (event.key === "End" && hasNext) onIndex(items.length - 1)
    else return
    event.preventDefault()
  }

  if (!item) return null
  const clip = item.kind === "video" ? item.scene.clips.find((c) => c.id === item.clipId) : null

  return (
    <DialogContent
      onKeyDown={onKeyDown}
      className="flex max-h-[94svh] flex-col gap-3 p-3 sm:max-w-[min(94vw,78rem)]"
    >
      <DialogHeader className="flex-row items-center gap-2 pr-9">
        <DialogTitle className="flex shrink-0 items-center gap-1.5 tabular-nums">
          {item.kind === "photo" ? (
            <>
              Photo {item.place}
              {item.place === 1 && <span className="text-xs font-normal text-muted-foreground">· Thumbnail</span>}
            </>
          ) : (
            <>
              <PlayIcon className="size-3.5 fill-current" />
              Video
            </>
          )}
        </DialogTitle>
        <DialogDescription className="truncate">
          {chain.name} · {item.scene.name}
          {clip && ` · ${clip.name}`}
        </DialogDescription>
      </DialogHeader>

      <div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded-lg bg-muted/50">
        {item.kind === "photo" ? (
          <PhotoPreview key={item.scene.id} scene={item.scene} />
        ) : clip?.preview ? (
          <video
            key={clip.preview}
            src={fileUrl(item.scene.id, clip.preview)}
            autoPlay
            muted
            loop
            playsInline
            controls
            className="max-h-[calc(94svh-9.5rem)] w-auto max-w-full"
          />
        ) : (
          <p className="p-12 text-sm text-muted-foreground">
            This clip has no preview yet — open the mockup and render it once.
          </p>
        )}
        {hasPrev && (
          <Button
            variant="secondary"
            size="icon"
            aria-label="Previous"
            className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-background/90 shadow-sm"
            onClick={() => onIndex(index - 1)}
          >
            <ChevronLeftIcon />
          </Button>
        )}
        {hasNext && (
          <Button
            variant="secondary"
            size="icon"
            aria-label="Next"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-background/90 shadow-sm"
            onClick={() => onIndex(index + 1)}
          >
            <ChevronRightIcon />
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 gap-1.5 overflow-x-auto p-0.5 no-scrollbar">
          {items.map((it, i) => (
            <button
              key={it.kind === "photo" ? it.scene.id : "video"}
              type="button"
              aria-label={it.kind === "photo" ? `Photo ${it.place}` : "Video"}
              aria-current={i === index || undefined}
              onClick={() => onIndex(i)}
              className="relative size-11 shrink-0 overflow-hidden rounded-md bg-muted opacity-60 ring-1 ring-foreground/10 transition-[opacity,transform] duration-150 ease-out outline-none hover:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 aria-current:opacity-100 aria-current:ring-2 aria-current:ring-brand"
            >
              <SceneThumb scene={it.scene} />
              <span className="absolute bottom-0.5 left-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-sm bg-black/60 px-0.5 text-[9px] font-medium text-white tabular-nums">
                {it.kind === "photo" ? it.place : <PlayIcon className="size-2 fill-current" />}
              </span>
            </button>
          ))}
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          <Kbd>←</Kbd> <Kbd>→</Kbd> to switch
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          nativeButton={false}
          render={<Link href={`/mockups/${item.scene.id}`} />}
        >
          <PencilIcon />
          Open mockup
        </Button>
      </div>
    </DialogContent>
  )
}

/** The scene's saved thumbnail, or a frame icon until it has one. */
export function SceneThumb({ scene, className }: { scene: SceneSummary; className?: string }) {
  if (!scene.thumb) {
    return (
      <span className={cn("grid size-full place-items-center bg-muted", className)}>
        <FrameIcon className="size-1/3 max-h-8 max-w-8 text-muted-foreground" />
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={fileUrl(scene.id, scene.thumb)}
      alt=""
      draggable={false}
      className={cn("size-full object-cover", className)}
    />
  )
}

// --- Sharp previews with the current poster ---

/** Long edge of a preview render: sharp in the viewer, far cheaper than an export. */
const PREVIEW_EDGE = 1800
const previews = new Map<string, Promise<string>>()
const posterIds = new WeakMap<ImageBitmap, number>()
let nextPosterId = 0
// One render at a time: each holds a WebGL context while it works.
let queue: Promise<unknown> = Promise.resolve()

function preview(sceneId: string, poster: ImageBitmap) {
  let pid = posterIds.get(poster)
  if (pid === undefined) posterIds.set(poster, (pid = nextPosterId++))
  const key = `${sceneId}:${pid}`
  let url = previews.get(key)
  if (!url) {
    url = (queue = queue.catch(() => {}).then(() => renderPreview(sceneId, poster))) as Promise<string>
    url.catch(() => previews.delete(key))
    previews.set(key, url)
    // Keep the newest few; older ones are freed.
    for (const [old, value] of previews) {
      if (previews.size <= 24) break
      previews.delete(old)
      value.then(URL.revokeObjectURL, () => {})
    }
  }
  return url
}

async function renderPreview(sceneId: string, poster: ImageBitmap) {
  const scene = await fetchScene(sceneId)
  const renderer = await SceneRenderer.create()
  try {
    await renderer.build(scene, { resolve: (src) => fileUrl(scene.id, src), poster })
    const canvas = toCanvas(renderer.pixels(Math.min(1, PREVIEW_EDGE / Math.max(scene.width, scene.height))))
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.9))
    if (!blob) throw new Error("Couldn't encode the preview")
    return URL.createObjectURL(blob)
  } finally {
    renderer.destroy()
  }
}

function PhotoPreview({ scene }: { scene: SceneSummary }) {
  const poster = usePoster()
  const [sharp, setSharp] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!poster) return
    let cancelled = false
    preview(scene.id, poster.bitmap).then(
      (url) => !cancelled && setSharp(url),
      (error) => console.error(`Preview of ${scene.id}:`, error)
    )
    return () => {
      cancelled = true
    }
  }, [scene.id, poster])

  const ratio = `${scene.width} / ${scene.height}`
  return (
    <div
      className="relative max-h-[calc(94svh-9.5rem)] max-w-full"
      style={{ aspectRatio: ratio, height: "calc(94svh - 9.5rem)" }}
    >
      <SceneThumb scene={scene} className="absolute inset-0 object-contain" />
      {sharp && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sharp}
          alt={scene.name}
          className="absolute inset-0 size-full object-contain transition-opacity duration-200 ease-out-strong starting:opacity-0"
        />
      )}
    </div>
  )
}
