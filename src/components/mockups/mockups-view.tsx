"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import { zipSync } from "fflate"
import {
  FileArchiveIcon,
  FolderIcon,
  FrameIcon,
  ListOrderedIcon,
  ListPlusIcon,
  LoaderCircleIcon,
  PlayIcon,
  PlusIcon,
  SparklesIcon,
  StarIcon,
} from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"

import { useChains } from "@/components/mockups/chain-store"
import { AddToChainItems, ChainsPanel } from "@/components/mockups/chains-panel"
import { PosterPicker, usePoster } from "@/components/mockups/poster-picker"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { refreshCategories, useCategories } from "@/hooks/use-categories"
import { download, fetchScene, fileUrl } from "@/lib/mockups/client"
import { exportName, exportScene, renderThumb } from "@/lib/mockups/export"
import type { SceneSummary } from "@/lib/mockups/types"
import { clipFileName, exportClip } from "@/lib/mockups/video"

export function MockupsView() {
  const router = useRouter()
  const poster = usePoster()
  const [scenes, setScenes] = React.useState<SceneSummary[] | null>(null)
  const [filter, setFilter] = useCategoryFilter()
  const [tab, setTab] = useTab()
  const chains = useChains()
  const visible = React.useMemo(() => scenes && scenes.filter(filter.matches), [scenes, filter])
  const [progress, setProgress] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState<"room" | "reference" | null>(null)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const referenceInput = React.useRef<HTMLInputElement>(null)
  const [name, setName] = React.useState("")

  React.useEffect(() => {
    fetch("/api/mockups", { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body?.error ?? r.statusText)
        setScenes(body)
      })
      .catch((error) => {
        setScenes([])
        toast.error(`Couldn't load the mockups: ${error.message}`)
      })
  }, [])

  // Scenes made on the server (from a reference) have no thumbnail until
  // saved in the editor, so render the missing ones here, one at a time.
  const missing = scenes?.filter((s) => !s.thumb).map((s) => s.id).join()
  React.useEffect(() => {
    if (!poster || !missing) return
    let cancelled = false
    ;(async () => {
      for (const id of missing.split(",")) {
        if (cancelled) return
        try {
          await renderThumb(await fetchScene(id), poster.bitmap)
          const thumb = `thumb.jpg?v=${Date.now()}`
          if (!cancelled) setScenes((all) => all?.map((s) => (s.id === id ? { ...s, thumb } : s)) ?? null)
        } catch (e) {
          console.error(`Thumbnail for ${id}:`, e)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [poster, missing])

  // A room with a blank sheet as is, or a finished mockup ("reference") that
  // Nano Banana redraws blank before corners, light and shine are set up.
  async function create(file: File, kind: "room" | "reference") {
    setCreating(kind)
    try {
      const body = new FormData()
      body.set("name", name.trim() || file.name.replace(/\.[^.]+$/, ""))
      body.set("image", file)
      if (filter.category) body.set("category", filter.category)
      const url = kind === "room" ? "/api/mockups" : "/api/mockups/reference"
      const response = await fetch(url, { method: "POST", body })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? response.statusText)
      if (result.located === false) toast.warning("Couldn't find the sheet — set the four corners by hand")
      router.push(`/mockups/${result.id}`)
    } catch (e) {
      toast.error(`Couldn't create the mockup: ${(e as Error).message}`)
      setCreating(null)
    }
  }

  // Every mockup shown (all, or one category's) with the current poster, as
  // 01.jpg … in one zip.
  async function exportAll() {
    if (!poster || !visible) return
    const files: Record<string, Uint8Array> = {}
    try {
      for (const [i, summary] of visible.entries()) {
        const step = `${i + 1} / ${visible.length}`
        setProgress(step)
        const scene = await fetchScene(summary.id)
        const jpeg = await exportScene(scene, poster.bitmap)
        files[exportName(scene)] = new Uint8Array(await jpeg.arrayBuffer())
        const listing = scene.clips?.find((c) => c.listing)
        if (listing) {
          const video = await exportClip(scene, listing, poster.bitmap, undefined, (p) =>
            setProgress(`${step} · video ${Math.floor(p * 100)} %`)
          )
          files[clipFileName(scene, listing)] = new Uint8Array(await video.arrayBuffer())
        }
      }
      const zip = zipSync(files, { level: 0 })
      const base = poster.test ? "mockups" : poster.name.replace(/\.[^.]+$/, "")
      const suffix = filter.category ? ` – ${filter.category}` : ""
      download(new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${base}${suffix}.zip`)
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`)
    } finally {
      setProgress(null)
    }
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-4 px-4 lg:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <TabsList className="mr-auto">
          <TabsTrigger value={MOCKUPS} className="px-3">
            <FrameIcon />
            Mockups
            <TabCount value={scenes?.length} />
          </TabsTrigger>
          <TabsTrigger value={CHAINS} className="px-3">
            <ListOrderedIcon />
            Chains
            <TabCount value={chains?.length} />
          </TabsTrigger>
        </TabsList>
        <PosterPicker />
        {tab === MOCKUPS && (
          <Button size="sm" onClick={exportAll} disabled={!poster || !visible?.length || !!progress}>
            {progress ? <LoaderCircleIcon className="animate-spin" /> : <FileArchiveIcon />}
            {progress ? `Rendering ${progress}` : filter.category ? `Export ${filter.category}` : "Export all"}
          </Button>
        )}
      </div>

      <TabsContent value={CHAINS}>
        <ChainsPanel scenes={scenes} />
      </TabsContent>

      <TabsContent value={MOCKUPS} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Rooms your poster is placed into. Exports are 2000 px on the short edge plus each listing
          video, numbered in listing order. Right-click a mockup to put it in a chain.
        </p>

        {scenes && <CategoryFilter scenes={scenes} filter={filter} onChange={setFilter} />}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
          {visible === null
            ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-square rounded-xl" />)
            : visible.map((scene) => (
                <MockupCard key={scene.id} scene={scene} onShowChains={() => setTab(CHAINS)} />
              ))}

          <div className="flex aspect-square flex-col justify-center gap-3 rounded-xl border border-dashed p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <PlusIcon className="size-4" /> New mockup
            </div>
            <p className="text-xs text-muted-foreground">
              Upload a room photo or AI render with a blank white sheet in the frame. Then set the
              four corners and generate light &amp; shine. Or start from someone else&apos;s finished
              mockup and let AI empty the frame.
            </p>
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={!!creating}>
              {creating === "room" && <LoaderCircleIcon className="animate-spin" />}
              Choose room image…
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => referenceInput.current?.click()}
              disabled={!!creating}
              title="Upload a finished mockup: it's redrawn with a blank sheet, then corners, light and shine are set up"
            >
              {creating === "reference" ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
              {creating === "reference" ? "Generating… (~1 min)" : "Generate from reference…"}
            </Button>
            {[
              { ref: fileInput, kind: "room" as const },
              { ref: referenceInput, kind: "reference" as const },
            ].map(({ ref, kind }) => (
              <input
                key={kind}
                ref={ref}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) create(file, kind)
                  e.target.value = ""
                }}
              />
            ))}
          </div>
        </div>
      </TabsContent>
    </Tabs>
  )
}

// --- Tabs ---

const MOCKUPS = "mockups"
const CHAINS = "chains"

/** The open tab, kept in `?tab=` (absent for mockups) so a reload or link lands on it. */
function useTab() {
  const tab = useSearchParams().get("tab") === CHAINS ? CHAINS : MOCKUPS
  const setTab = React.useCallback((next: string) => {
    const params = new URLSearchParams(window.location.search)
    if (next === CHAINS) params.set("tab", CHAINS)
    else params.delete("tab")
    const query = params.toString()
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
  }, [])
  return [tab, setTab] as const
}

function TabCount({ value }: { value: number | undefined }) {
  return (
    <span className="min-w-3 text-xs text-muted-foreground tabular-nums">{value ?? ""}</span>
  )
}

// --- Categories ---

// Which mockups are shown: all (no `?category=`), one category, or the ones
// in none (`?category=` left empty).
type Filter = {
  key: string
  category: string | null
  matches: (scene: SceneSummary) => boolean
}

const ALL = "all"
const UNSORTED = "unsorted"

function useCategoryFilter() {
  const searchParams = useSearchParams()
  const param = searchParams.get("category")
  const filter = React.useMemo<Filter>(() => {
    if (param === null) return { key: ALL, category: null, matches: () => true }
    if (param === "") return { key: UNSORTED, category: null, matches: (s) => !s.category }
    const needle = param.toLowerCase()
    return {
      key: `c:${needle}`,
      category: param,
      matches: (s) => s.category?.toLowerCase() === needle,
    }
  }, [param])

  const setFilter = React.useCallback((category: string | null) => {
    const params = new URLSearchParams(window.location.search)
    if (category === null) params.delete("category")
    else params.set("category", category)
    const query = params.toString()
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
  }, [])

  return [filter, setFilter] as const
}

function CategoryFilter({
  scenes,
  filter,
  onChange,
}: {
  scenes: SceneSummary[]
  filter: Filter
  onChange: (category: string | null) => void
}) {
  const saved = useCategories("mockups")
  React.useEffect(() => {
    refreshCategories("mockups")
  }, [])

  // Counted here rather than taken from the list, so they follow deletions.
  const categories = React.useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>()
    for (const { name } of saved) counts.set(name.toLowerCase(), { name, count: 0 })
    for (const { category } of scenes) {
      if (!category) continue
      const key = category.toLowerCase()
      const entry = counts.get(key) ?? { name: category, count: 0 }
      counts.set(key, { ...entry, count: entry.count + 1 })
    }
    return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [saved, scenes])
  const unsorted = scenes.filter((s) => !s.category).length

  if (categories.length === 0) return null

  const chips = [
    { key: ALL, label: "All", count: scenes.length, value: null },
    ...categories.map((c) => ({ key: `c:${c.name.toLowerCase()}`, label: c.name, count: c.count, value: c.name })),
    ...(unsorted > 0 ? [{ key: UNSORTED, label: "Uncategorized", count: unsorted, value: "" }] : []),
  ]

  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      spacing={1}
      value={[filter.key]}
      onValueChange={(value) => {
        const chip = chips.find((c) => c.key === value[0])
        if (chip) onChange(chip.value)
      }}
      aria-label="Category"
      className="w-full flex-wrap"
    >
      {chips.map((chip) => (
        <ToggleGroupItem key={chip.key} value={chip.key} className="gap-1.5">
          {chip.key !== ALL && chip.key !== UNSORTED && <FolderIcon />}
          {chip.label}
          <span className="text-xs text-muted-foreground tabular-nums">{chip.count}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

// A mockup in the grid. Like an Etsy listing, hovering plays its video. The
// corner button (or a right-click) puts it in a chain.
function MockupCard({ scene, onShowChains }: { scene: SceneSummary; onShowChains: () => void }) {
  const video = React.useRef<HTMLVideoElement>(null)
  const hovered = React.useRef(false)
  const [playing, setPlaying] = React.useState(false)
  const clip = scene.clips.find((c) => c.listing && c.preview) ?? scene.clips.find((c) => c.preview)
  const count = scene.clips.length
  const inChains = (useChains() ?? []).filter((c) => c.scenes.includes(scene.id))

  const enter = (event: React.PointerEvent) => {
    const v = video.current
    if (!v || event.pointerType !== "mouse" || matchMedia("(prefers-reduced-motion: reduce)").matches) return
    hovered.current = true
    v.currentTime = 0
    v.play().catch(() => {})
  }
  const leave = () => {
    hovered.current = false
    video.current?.pause()
    setPlaying(false)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div className="group/card relative" />}>
        <Link
          href={`/mockups/${scene.id}`}
          onPointerEnter={enter}
          onPointerLeave={leave}
          className="group block overflow-hidden rounded-xl border bg-card transition-colors hover:border-foreground/30"
        >
          <div className="relative grid aspect-square place-items-center overflow-hidden bg-muted">
            {scene.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl(scene.id, scene.thumb)} alt="" className="size-full object-cover" />
            ) : (
              <FrameIcon className="size-8 text-muted-foreground" />
            )}
            {clip?.preview && (
              <video
                ref={video}
                src={fileUrl(scene.id, clip.preview)}
                muted
                loop
                playsInline
                preload="none"
                aria-hidden
                // Shown once frames arrive, so a slow start never flashes black.
                onPlaying={() => (hovered.current ? setPlaying(true) : video.current?.pause())}
                className={cn(
                  "absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-200 ease-out-strong",
                  playing && "opacity-100"
                )}
              />
            )}
            {count > 0 && (
              <span
                aria-label={count === 1 ? "1 animation" : `${count} animations`}
                className={cn(
                  "pointer-events-none absolute bottom-2 left-2 flex h-5 items-center gap-0.5 rounded-full bg-black/55 px-1.5 text-[11px] font-medium text-white tabular-nums backdrop-blur-sm transition-opacity duration-200 ease-out-strong [&_svg]:size-2.5 [&_svg]:fill-current",
                  playing && "opacity-0"
                )}
              >
                <PlayIcon />
                {count > 1 && count}
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2 px-3 py-2">
            <span className="text-xs text-muted-foreground tabular-nums">{String(scene.order).padStart(2, "0")}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{scene.name}</span>
            {inChains.length > 0 && (
              <span
                title={`In ${inChains.map((c) => `${c.name} (#${c.scenes.indexOf(scene.id) + 1})`).join(", ")}`}
                className="flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums [&_svg]:size-3"
              >
                {inChains.some((c) => c.isDefault) ? <StarIcon className="fill-brand text-brand" /> : <ListOrderedIcon />}
                {inChains.length}
              </span>
            )}
            <span className="text-xs text-muted-foreground tabular-nums">
              {scene.width}×{scene.height}
            </span>
          </div>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label={`Add ${scene.name} to a chain`}
                title="Add to chain"
                className="absolute top-2 right-2 rounded-full bg-background/90 opacity-0 shadow-sm backdrop-blur-sm transition-[opacity,scale] duration-150 ease-out focus-visible:opacity-100 active:scale-[0.97] data-popup-open:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none [@media(hover:hover)]:group-hover/card:opacity-100"
              />
            }
          >
            <ListPlusIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <AddToChainItems scene={scene} onShowChains={onShowChains} />
          </DropdownMenuContent>
        </DropdownMenu>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <AddToChainItems scene={scene} onShowChains={onShowChains} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
