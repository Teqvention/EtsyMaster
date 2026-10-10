"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import { zipSync } from "fflate"
import {
  CheckIcon,
  ChevronDownIcon,
  FileArchiveIcon,
  FolderIcon,
  FrameIcon,
  LayersIcon,
  ListOrderedIcon,
  ListPlusIcon,
  LoaderCircleIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  StarIcon,
  StoreIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"

import { useChains } from "@/components/mockups/chain-store"
import { AddToChainItems, ChainsPanel } from "@/components/mockups/chains-panel"
import { PosterPicker, usePoster } from "@/components/mockups/poster-picker"
import { RegenerateMockupDialog, useRemaking } from "@/components/mockups/regenerate-dialog"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { refreshCategories, useCategories } from "@/hooks/use-categories"
import { useGenerations } from "@/hooks/use-generations"
import { download, fetchScene, fileUrl } from "@/lib/mockups/client"
import { exportName, exportScene, renderThumb } from "@/lib/mockups/export"
import type { SceneSummary } from "@/lib/mockups/types"
import { clipFileName, exportClip } from "@/lib/mockups/video"

export function MockupsView() {
  const router = useRouter()
  const poster = usePoster()
  const [scenes, setScenes] = React.useState<SceneSummary[] | null>(null)
  const [filter, setFilter] = useCategoryFilter()
  const [shop, setShop] = useShopFilter()
  const [tab, setTab] = useTab()
  const chains = useChains()
  // The categories count what's left of the shop picked.
  const fromShop = React.useMemo(
    () => scenes && (shop ? scenes.filter((s) => s.shop?.toLowerCase() === shop.toLowerCase()) : scenes),
    [scenes, shop]
  )
  const visible = React.useMemo(() => fromShop && fromShop.filter((s) => filter.matches(s)), [fromShop, filter])

  async function remove(scene: SceneSummary) {
    setScenes((all) => all?.filter((s) => s.id !== scene.id) ?? null)
    try {
      const response = await fetch(`/api/mockups/${scene.id}`, { method: "DELETE" })
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? response.statusText)
      toast(`Deleted ${scene.name}`)
    } catch (error) {
      setScenes((all) => all && [...all, scene].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)))
      toast.error(`Couldn't delete ${scene.name}: ${(error as Error).message}`)
    }
  }
  const [progress, setProgress] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState<"room" | "reference" | null>(null)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const referenceInput = React.useRef<HTMLInputElement>(null)
  const [name, setName] = React.useState("")

  const load = React.useCallback(() => {
    fetch("/api/mockups", { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body?.error ?? r.statusText)
        setScenes(body)
      })
      .catch((error) => {
        setScenes((all) => all ?? [])
        toast.error(`Couldn't load the mockups: ${error.message}`)
      })
  }, [])

  // Read again when a mockup made again (by its set) gets its new blank.
  const sets = useGenerations()
  const blanks = sets
    ?.filter((s) => s.kind === "mockup" && s.sceneId)
    .map((s) => `${s.sceneId}:${s.mockup?.file}`)
    .join()
  React.useEffect(load, [load, blanks])

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
        for (const clip of scene.clips?.filter((c) => c.video) ?? []) {
          const video = await exportClip(scene, clip, poster.bitmap, undefined, (p) =>
            setProgress(`${step} · video ${Math.floor(p * 100)} %`)
          )
          files[clipFileName(scene, clip)] = new Uint8Array(await video.arrayBuffer())
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

        {scenes && (
          <div className="flex flex-wrap items-start gap-2">
            <ShopFilter scenes={scenes} shop={shop} onChange={setShop} />
            <div className="min-w-0 flex-1">
              <CategoryFilter scenes={fromShop!} filter={filter} onChange={setFilter} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
          {visible === null
            ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-square rounded-xl" />)
            : visible.map((scene) => (
                <MockupCard
                  key={scene.id}
                  scene={scene}
                  onShowChains={() => setTab(CHAINS)}
                  onShop={setShop}
                  onDelete={() => remove(scene)}
                  onRedrawn={load}
                />
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

// --- Shops ---

/** The shop mockups are shown of, kept in `?shop=` (absent for every shop). */
function useShopFilter() {
  const shop = useSearchParams().get("shop") || null
  const setShop = React.useCallback((next: string | null) => {
    const params = new URLSearchParams(window.location.search)
    if (next) params.set("shop", next)
    else params.delete("shop")
    const query = params.toString()
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
  }, [])
  return [shop, setShop] as const
}

/** Which shop's stolen mockups are shown; only there once any are. */
function ShopFilter({
  scenes,
  shop,
  onChange,
}: {
  scenes: SceneSummary[]
  shop: string | null
  onChange: (shop: string | null) => void
}) {
  const shops = React.useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>()
    for (const { shop } of scenes) {
      if (!shop) continue
      const entry = counts.get(shop.toLowerCase()) ?? { name: shop, count: 0 }
      counts.set(shop.toLowerCase(), { ...entry, count: entry.count + 1 })
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [scenes])
  if (!shops.length && !shop) return null
  const current = !shop ? null : (shops.find((s) => s.name.toLowerCase() === shop.toLowerCase()) ?? { name: shop, count: 0 })

  return (
    <div className="flex items-center" role="group" aria-label="Shop">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className={cn("max-w-56 min-w-0", current && "rounded-r-none border-brand/50 bg-brand/8")}
            />
          }
        >
          <StoreIcon className="text-muted-foreground" />
          <span className="truncate">{current ? current.name : "All shops"}</span>
          {current && <span className="text-xs text-muted-foreground tabular-nums">{current.count}</span>}
          <ChevronDownIcon className="text-muted-foreground" data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Stolen from</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onChange(null)}>
              <LayersIcon />
              <span className="flex-1">All shops</span>
              {!current && <CheckIcon />}
            </DropdownMenuItem>
            {shops.map((s) => (
              <DropdownMenuItem key={s.name} onClick={() => onChange(s.name)}>
                <StoreIcon />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{s.count}</span>
                {current?.name.toLowerCase() === s.name.toLowerCase() && <CheckIcon />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {current && (
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Every shop"
          title="Every shop"
          onClick={() => onChange(null)}
          className="-ml-px rounded-l-none border-brand/50"
        >
          <XIcon />
        </Button>
      )}
    </div>
  )
}

// A mockup in the grid. Like an Etsy listing, hovering plays its video. The
// corner buttons make it again, put it in a chain (so does a right-click)
// and delete it; its shop filters the grid to that shop.
function MockupCard({
  scene,
  onShowChains,
  onShop,
  onDelete,
  onRedrawn,
}: {
  scene: SceneSummary
  onShowChains: () => void
  onShop: (shop: string) => void
  onDelete: () => void
  onRedrawn: () => void
}) {
  const [regenerating, setRegenerating] = React.useState(false)
  const remaking = useRemaking(scene.id)
  const video = React.useRef<HTMLVideoElement>(null)
  const hovered = React.useRef(false)
  const [playing, setPlaying] = React.useState(false)
  const clip = scene.clips.find((c) => c.video && c.preview) ?? scene.clips.find((c) => c.preview)
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
            {remaking && (
              <span className="absolute inset-0 grid place-items-center bg-background/60 backdrop-blur-[2px]">
                <span className="flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium shadow-sm">
                  <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
                  Making it again
                </span>
              </span>
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
        {scene.shop && (
          // Outside the link: it filters the grid instead of opening the editor.
          <button
            type="button"
            onClick={() => onShop(scene.shop!)}
            title={`Only mockups stolen from ${scene.shop}`}
            className="absolute bottom-[2.6rem] left-2 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-black/55 py-0.5 pr-2 pl-1.5 text-[11px] font-medium text-white backdrop-blur-sm transition-colors outline-none hover:bg-black/75 focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3 [&_svg]:shrink-0"
          >
            <StoreIcon />
            <span className="truncate">{scene.shop}</span>
          </button>
        )}
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label={`Regenerate ${scene.name}`}
          title="Regenerate: say what should be different"
          disabled={remaking}
          onClick={() => setRegenerating(true)}
          className={cn(CORNER, "right-20")}
        >
          <RefreshCwIcon />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label={`Add ${scene.name} to a chain`}
                title="Add to chain"
                className={cn(CORNER, "right-11")}
              />
            }
          >
            <ListPlusIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <AddToChainItems scene={scene} onShowChains={onShowChains} />
          </DropdownMenuContent>
        </DropdownMenu>
        <DeleteCorner name={scene.name} inChains={inChains.length} onDelete={onDelete} />
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <AddToChainItems scene={scene} onShowChains={onShowChains} />
        <ContextMenuSeparator />
        <ContextMenuItem disabled={remaking} onClick={() => setRegenerating(true)}>
          <RefreshCwIcon />
          Regenerate…
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          <Trash2Icon />
          Delete mockup
        </ContextMenuItem>
      </ContextMenuContent>
      <RegenerateMockupDialog
        open={regenerating}
        onOpenChange={setRegenerating}
        sceneId={scene.id}
        name={scene.name}
        image={scene.thumb && fileUrl(scene.id, scene.thumb)}
        onRedrawn={onRedrawn}
      />
    </ContextMenu>
  )
}

/** A button in the card's top right, shown on hover. */
const CORNER =
  "absolute top-2 rounded-full bg-background/90 opacity-0 shadow-sm backdrop-blur-sm transition-[opacity,scale] duration-150 ease-out focus-visible:opacity-100 active:scale-[0.97] data-popup-open:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none [@media(hover:hover)]:group-hover/card:opacity-100"

/** The card's bin: a first click arms it, a second deletes. */
function DeleteCorner({ name, inChains, onDelete }: { name: string; inChains: number; onDelete: () => void }) {
  const [armed, setArmed] = React.useState(false)
  React.useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <Button
      variant={armed ? "destructive" : "secondary"}
      size={armed ? "sm" : "icon-sm"}
      aria-label={armed ? `Really delete ${name}` : `Delete ${name}`}
      title={armed ? (inChains ? `Also leaves ${inChains === 1 ? "its chain" : `its ${inChains} chains`}` : undefined) : "Delete"}
      onClick={() => (armed ? onDelete() : setArmed(true))}
      onBlur={() => setArmed(false)}
      className={cn(
        "absolute top-2 right-2 rounded-full shadow-sm backdrop-blur-sm transition-[opacity,scale] duration-150 ease-out focus-visible:opacity-100 active:scale-[0.97] pointer-coarse:opacity-100 motion-reduce:transition-none [@media(hover:hover)]:group-hover/card:opacity-100",
        armed ? "opacity-100" : "bg-background/90 opacity-0 hover:text-destructive"
      )}
    >
      <Trash2Icon />
      {armed && "Delete?"}
    </Button>
  )
}
