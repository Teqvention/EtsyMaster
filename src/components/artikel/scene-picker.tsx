"use client"

import Image from "next/image"
import * as React from "react"
import { CheckIcon, ImageIcon } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import { fileUrl } from "@/lib/mockups/client"
import type { SceneSummary } from "@/lib/mockups/types"
import { cn } from "@/lib/utils"

// The mockup scenes to show a poster in instead, as a grid of thumbnails.
// Read once per visit.

let scenes: Promise<SceneSummary[]> | null = null

function loadScenes() {
  scenes ??= fetch("/api/mockups", { cache: "no-store" })
    .then((response) => (response.ok ? (response.json() as Promise<SceneSummary[]>) : []))
    .catch(() => [])
    .then((list) => {
      if (!list.length) scenes = null
      return list.toSorted((a, b) => a.order - b.order)
    })
  return scenes
}

export function ScenePicker({ value, onChange }: { value: string | null; onChange: (sceneId: string) => void }) {
  const [list, setList] = React.useState<SceneSummary[] | null>(null)
  React.useEffect(() => {
    let cancelled = false
    void loadScenes().then((loaded) => !cancelled && setList(loaded))
    return () => {
      cancelled = true
    }
  }, [])

  if (!list) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="aspect-square rounded-md" />
        ))}
      </div>
    )
  }
  if (!list.length) return <p className="text-xs text-muted-foreground">No mockup scenes yet: make some under Mockups.</p>

  return (
    <div className="grid max-h-64 grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2 overflow-y-auto p-0.5" role="radiogroup" aria-label="Scene">
      {list.map((scene) => {
        const picked = scene.id === value
        return (
          <button
            key={scene.id}
            type="button"
            role="radio"
            aria-checked={picked}
            onClick={() => onChange(scene.id)}
            title={scene.category ? `${scene.name} · ${scene.category}` : scene.name}
            className={cn(
              "group/scene flex min-w-0 flex-col gap-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] transition-transform duration-150 ease-out"
            )}
          >
            <span
              className={cn(
                "relative grid aspect-square place-items-center overflow-hidden rounded-md border bg-muted transition-[border-color,box-shadow] duration-150 ease-out",
                picked ? "border-brand ring-2 ring-brand/40" : "[@media(hover:hover)]:group-hover/scene:border-foreground/30"
              )}
            >
              {scene.thumb ? (
                <Image src={fileUrl(scene.id, scene.thumb)} alt="" fill unoptimized sizes="96px" className="object-cover" />
              ) : (
                <ImageIcon className="size-4 text-muted-foreground" />
              )}
              {picked && (
                <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-brand text-white">
                  <CheckIcon className="size-3" strokeWidth={3} />
                </span>
              )}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">{scene.name}</span>
          </button>
        )
      })}
    </div>
  )
}
