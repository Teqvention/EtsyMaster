"use client"

import * as React from "react"
import { CheckIcon, PlayIcon, VideoOffIcon } from "lucide-react"

import { SceneThumb } from "@/components/mockups/chain-viewer"
import { ALL_TAGS, matchesTagView, TagFilterChips, type TagView } from "@/components/tags/tag-filter-chips"
import { Button } from "@/components/ui/button"
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { MAX_CHAIN_PHOTOS, type ChainVideo, type MockupChain } from "@/lib/mockups/chain-types"
import { fileUrl } from "@/lib/mockups/client"
import type { SceneSummary } from "@/lib/mockups/types"
import { cn } from "@/lib/utils"

// Picking a chain's photos and its video from the mockups, narrowed by their tags.

/**
 * Click a mockup to add it at the end of the chain, click again to take it
 * out; the number on each shows its place. Kept as a draft until Done.
 */
export function ScenePicker({
  chain,
  scenes,
  onDone,
}: {
  chain: MockupChain
  scenes: SceneSummary[]
  onDone: (scenes: string[]) => void
}) {
  const [picked, setPicked] = React.useState(chain.scenes)
  const [view, setView] = React.useState<TagView>(ALL_TAGS)
  const full = picked.length >= MAX_CHAIN_PHOTOS
  const items = React.useMemo(() => scenes.map((s) => s.tags), [scenes])
  const shown = scenes.filter((s) => matchesTagView(s.tags, view))

  function toggle(id: string) {
    setPicked((list) =>
      list.includes(id) ? list.filter((s) => s !== id) : list.length < MAX_CHAIN_PHOTOS ? [...list, id] : list
    )
  }

  return (
    <DialogContent className="flex max-h-[90svh] flex-col gap-3 sm:max-w-[min(92vw,56rem)]">
      <DialogHeader>
        <DialogTitle>Photos for {chain.name}</DialogTitle>
        <DialogDescription>
          Click mockups in the order the listing should show them — the first one is the thumbnail.
        </DialogDescription>
      </DialogHeader>

      <TagFilterChips items={items} view={view} onChange={setView} />

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-1">
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
          {shown.map((scene) => {
            const place = picked.indexOf(scene.id) + 1
            const disabled = !place && full
            return (
              <li key={scene.id}>
                <button
                  type="button"
                  aria-pressed={place > 0}
                  disabled={disabled}
                  onClick={() => toggle(scene.id)}
                  className="group/pick flex w-full flex-col gap-1.5 text-left outline-none disabled:cursor-not-allowed"
                >
                  <span
                    className={cn(
                      "relative block aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10 transition-[box-shadow,opacity,transform] duration-150 ease-out group-focus-visible/pick:ring-3 group-focus-visible/pick:ring-ring/50 group-active/pick:scale-[0.97]",
                      place > 0 && "ring-2 ring-brand",
                      disabled && "opacity-40"
                    )}
                  >
                    <SceneThumb scene={scene} />
                    <span
                      className={cn(
                        "absolute top-1.5 left-1.5 grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums transition-[background-color,opacity] duration-150 ease-out",
                        place > 0
                          ? "bg-brand text-white shadow-sm"
                          : "bg-background/80 text-transparent opacity-0 ring-1 ring-foreground/20 backdrop-blur-sm [@media(hover:hover)]:group-hover/pick:opacity-100"
                      )}
                    >
                      {place > 0 ? place : ""}
                    </span>
                    {scene.clips.some((c) => c.video) && (
                      <span className="absolute right-1.5 bottom-1.5 flex h-5 items-center rounded-full bg-black/55 px-1.5 text-white backdrop-blur-sm [&_svg]:size-2.5 [&_svg]:fill-current">
                        <PlayIcon />
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs font-medium">{scene.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
        {shown.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">No mockups in this category.</p>
        )}
      </div>

      <DialogFooter className="items-center">
        <span className="mr-auto text-sm text-muted-foreground tabular-nums">
          {picked.length} / {MAX_CHAIN_PHOTOS} photos{full && " · the chain is full"}
        </span>
        {picked.length > 0 && (
          <Button variant="ghost" onClick={() => setPicked([])}>
            Clear
          </Button>
        )}
        <Button onClick={() => onDone(picked)}>Done</Button>
      </DialogFooter>
    </DialogContent>
  )
}

/** Every clip saved as a video, playing on hover; picking one sets the chain's video. */
export function VideoPicker({
  chain,
  scenes,
  onPick,
}: {
  chain: MockupChain
  scenes: SceneSummary[]
  onPick: (video: ChainVideo | null) => void
}) {
  const withClips = scenes.filter((s) => s.clips.some((c) => c.video))
  // Mockups already in the chain first: their video matches the photos.
  const ordered = [
    ...withClips.filter((s) => chain.scenes.includes(s.id)),
    ...withClips.filter((s) => !chain.scenes.includes(s.id)),
  ]

  return (
    <DialogContent className="flex max-h-[90svh] flex-col gap-3 sm:max-w-[min(92vw,52rem)]">
      <DialogHeader>
        <DialogTitle>Video for {chain.name}</DialogTitle>
        <DialogDescription>A listing takes one video. It plays after the photos.</DialogDescription>
      </DialogHeader>

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {ordered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No videos yet. Open a mockup, animate it under Animate and click Save as video.
          </p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
            {ordered.flatMap((scene) =>
              scene.clips.filter((clip) => clip.video).map((clip) => (
                <li key={`${scene.id}:${clip.id}`}>
                  <ClipOption
                    scene={scene}
                    clip={clip}
                    current={chain.video?.sceneId === scene.id && chain.video.clipId === clip.id}
                    inChain={chain.scenes.includes(scene.id)}
                    onPick={() => onPick({ sceneId: scene.id, clipId: clip.id })}
                  />
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {chain.video && (
        <DialogFooter>
          <Button variant="outline" onClick={() => onPick(null)}>
            <VideoOffIcon />
            No video
          </Button>
        </DialogFooter>
      )}
    </DialogContent>
  )
}

function ClipOption({
  scene,
  clip,
  current,
  inChain,
  onPick,
}: {
  scene: SceneSummary
  clip: SceneSummary["clips"][number]
  current: boolean
  inChain: boolean
  onPick: () => void
}) {
  const video = React.useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = React.useState(false)

  return (
    <button
      type="button"
      aria-pressed={current}
      onClick={onPick}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse" || matchMedia("(prefers-reduced-motion: reduce)").matches) return
        video.current?.play().catch(() => {})
      }}
      onPointerLeave={() => {
        video.current?.pause()
        setPlaying(false)
      }}
      className="group/clip flex w-full flex-col gap-1.5 text-left outline-none"
    >
      <span
        className={cn(
          "relative block aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10 transition-[box-shadow,transform] duration-150 ease-out group-focus-visible/clip:ring-3 group-focus-visible/clip:ring-ring/50 group-active/clip:scale-[0.97]",
          current && "ring-2 ring-brand"
        )}
      >
        <SceneThumb scene={scene} />
        {clip.preview && (
          <video
            ref={video}
            src={fileUrl(scene.id, clip.preview)}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden
            onPlaying={() => setPlaying(true)}
            className={cn(
              "absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-200 ease-out-strong",
              playing && "opacity-100"
            )}
          />
        )}
        {current && (
          <span className="absolute top-1.5 left-1.5 grid size-6 place-items-center rounded-full bg-brand text-white shadow-sm">
            <CheckIcon className="size-3.5" />
          </span>
        )}
      </span>
      <span className="flex min-w-0 items-baseline gap-1.5 text-xs">
        <span className="truncate font-medium">{clip.name}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{clip.duration.toFixed(0)} s</span>
      </span>
      <span className="-mt-1 truncate text-[11px] text-muted-foreground">
        {scene.name}
        {inChain && " · in this chain"}
      </span>
    </button>
  )
}
