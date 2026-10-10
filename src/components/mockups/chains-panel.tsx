"use client"

import * as React from "react"
import { zipSync } from "fflate"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  FileArchiveIcon,
  ImagePlusIcon,
  ListOrderedIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
  VideoIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { ScenePicker, VideoPicker } from "@/components/mockups/chain-picker"
import { createChain, deleteChain, patchChain, useChains } from "@/components/mockups/chain-store"
import { ChainViewer, chainItems, SceneThumb } from "@/components/mockups/chain-viewer"
import { usePoster } from "@/components/mockups/poster-picker"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { renderChain } from "@/lib/mockups/chain-render"
import { MAX_CHAIN_PHOTOS, type ChainPatch, type MockupChain } from "@/lib/mockups/chain-types"
import { download, fileUrl } from "@/lib/mockups/client"
import type { SceneSummary } from "@/lib/mockups/types"
import { cn } from "@/lib/utils"

// Mockup chains: the picture order of a listing, one chain per row. Photos
// are dragged (or ⌥←/⌥→) into order, the first is the thumbnail; the video
// comes last. The starred chain is the default uploads use.

type Open =
  | { chainId: string; kind: "photos" | "video" }
  | { chainId: string; kind: "view"; index: number }
  | null

export function ChainsPanel({ scenes }: { scenes: SceneSummary[] | null }) {
  const chains = useChains()
  // What the dialog shows stays set while it animates out.
  const [open, setOpenState] = React.useState<Open>(null)
  const [shown, setShown] = React.useState(false)
  // Each opening starts the picker's draft afresh.
  const [opening, setOpening] = React.useState(0)
  const [naming, setNaming] = React.useState(false)
  const byId = React.useMemo(() => new Map((scenes ?? []).map((s) => [s.id, s])), [scenes])
  const openChain = open && chains?.find((c) => c.id === open.chainId)

  function setOpen(next: Open) {
    if (next) {
      if (next.kind !== "view") setOpening((n) => n + 1)
      setOpenState(next)
    }
    setShown(!!next)
  }

  async function create(name: string) {
    setNaming(false)
    try {
      const chain = await createChain(name)
      setOpen({ chainId: chain.id, kind: "photos" })
    } catch (error) {
      toast.error(`Couldn't create the chain: ${(error as Error).message}`)
    }
  }

  const loading = chains === null || scenes === null

  return (
    <section aria-label="Mockup chains" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto max-w-2xl text-sm text-muted-foreground">
          A chain is the picture order of one listing: up to {MAX_CHAIN_PHOTOS} mockups — the first is the
          thumbnail — then an optional video: none picked, none uploaded. Uploads use the <StarIcon className="inline size-3.5 -translate-y-px fill-brand text-brand" /> default.
        </p>
        {!loading && (chains.length > 0 || naming) && (
          <Button size="sm" onClick={() => setNaming(true)} disabled={naming}>
            <PlusIcon />
            New chain
          </Button>
        )}
      </div>

      {naming && <NewChain onCreate={create} onCancel={() => setNaming(false)} />}

      {loading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : chains.length === 0 && !naming ? (
        <Empty className="min-h-[40svh] border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListOrderedIcon />
            </EmptyMedia>
            <EmptyTitle>No chains yet</EmptyTitle>
            <EmptyDescription>
              Put mockups in the order a listing shows them, add a video, and every upload gets the same
              polished set of pictures.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setNaming(true)} disabled={scenes.length === 0}>
              <PlusIcon />
              Create the first chain
            </Button>
            {scenes.length === 0 && (
              <p className="text-xs text-muted-foreground">Make a mockup first, then put it in a chain.</p>
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <ol className="flex flex-col gap-4">
          {chains.map((chain) => (
            <li key={chain.id}>
              <ChainRow
                chain={chain}
                scenes={byId}
                onPickPhotos={() => setOpen({ chainId: chain.id, kind: "photos" })}
                onPickVideo={() => setOpen({ chainId: chain.id, kind: "video" })}
                onView={(index) => setOpen({ chainId: chain.id, kind: "view", index })}
              />
            </li>
          ))}
        </ol>
      )}

      <Dialog
        open={shown && !!openChain}
        onOpenChange={(next) => !next && setOpen(null)}
        onOpenChangeComplete={(next) => !next && setOpenState(null)}
      >
        {openChain && open?.kind === "photos" && (
          <ScenePicker
            key={opening}
            chain={openChain}
            scenes={scenes ?? []}
            onDone={(picked) => {
              setOpen(null)
              if (picked.join() !== openChain.scenes.join()) update(openChain, { scenes: picked })
            }}
          />
        )}
        {openChain && open?.kind === "video" && (
          <VideoPicker
            chain={openChain}
            scenes={scenes ?? []}
            onPick={(video) => {
              setOpen(null)
              update(openChain, { video })
            }}
          />
        )}
        {openChain && open?.kind === "view" && (
          <ChainViewer
            chain={openChain}
            items={chainItems(openChain, byId)}
            index={open.index}
            onIndex={(index) => setOpen({ chainId: openChain.id, kind: "view", index })}
          />
        )}
      </Dialog>
    </section>
  )
}

function update(chain: MockupChain, patch: ChainPatch) {
  return patchChain(chain.id, patch).catch((error) => toast.error(`Couldn't change ${chain.name}: ${error.message}`))
}

function NewChain({ onCreate, onCancel }: { onCreate: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = React.useState("")
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onCreate(name.trim())
      }}
      className="flex items-center gap-2 rounded-xl border border-dashed p-3 transition-[opacity,transform] duration-200 ease-out-strong starting:-translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0"
    >
      <ListOrderedIcon className="size-4 shrink-0 text-muted-foreground" />
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onCancel()}
        placeholder="Name, e.g. Living room set"
        aria-label="Chain name"
        maxLength={60}
        className="h-8 max-w-sm"
      />
      <Button type="submit" size="sm">
        Create &amp; pick photos
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  )
}

// --- One chain ---

function ChainRow({
  chain,
  scenes,
  onPickPhotos,
  onPickVideo,
  onView,
}: {
  chain: MockupChain
  scenes: ReadonlyMap<string, SceneSummary>
  onPickPhotos: () => void
  onPickVideo: () => void
  onView: (index: number) => void
}) {
  const poster = usePoster()
  const [renaming, setRenaming] = React.useState(false)
  const [progress, setProgress] = React.useState<string | null>(null)
  const items = chainItems(chain, scenes)
  const photos = items.filter((i) => i.kind === "photo")
  const video = items.find((i) => i.kind === "video")
  const clip = video?.kind === "video" ? video.scene.clips.find((c) => c.id === video.clipId) : null

  async function exportChain() {
    if (!poster) return
    try {
      const files = await renderChain(chain, poster.bitmap, setProgress)
      const zip = zipSync(
        Object.fromEntries(
          await Promise.all(files.map(async (f) => [f.name, new Uint8Array(await f.blob.arrayBuffer())] as const))
        ),
        { level: 0 }
      )
      const base = poster.test ? "test-poster" : poster.name.replace(/\.[^.]+$/, "")
      download(new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${chain.name} – ${base}.zip`)
    } catch (error) {
      toast.error(`Export failed: ${(error as Error).message}`)
    } finally {
      setProgress(null)
    }
  }

  async function remove() {
    const { name, scenes: ids, video: v, isDefault } = chain
    try {
      await deleteChain(chain.id)
      toast(`Deleted ${name}`, {
        action: {
          label: "Undo",
          onClick: () =>
            createChain(name, ids)
              .then((c) => patchChain(c.id, { video: v, ...(isDefault && { isDefault: true }) }))
              .catch((error) => toast.error(`Couldn't restore it: ${error.message}`)),
        },
      })
    } catch (error) {
      toast.error(`Couldn't delete ${name}: ${(error as Error).message}`)
    }
  }

  return (
    <article
      aria-label={chain.name}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-3 transition-colors duration-150",
        chain.isDefault && "border-brand/40"
      )}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed={chain.isDefault}
          aria-label={chain.isDefault ? "Default chain for uploads" : "Make this the default for uploads"}
          title={chain.isDefault ? "Default chain for uploads" : "Make default for uploads"}
          onClick={() => !chain.isDefault && update(chain, { isDefault: true })}
          className="transition-transform duration-150 ease-out active:scale-[0.9]"
        >
          <StarIcon className={cn(chain.isDefault ? "fill-brand text-brand" : "text-muted-foreground")} />
        </Button>

        {renaming ? (
          <RenameField
            name={chain.name}
            onDone={(name) => {
              setRenaming(false)
              if (name && name !== chain.name) update(chain, { name })
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setRenaming(true)}
            title="Rename"
            className="group/name flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-semibold outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="truncate">{chain.name}</span>
            <PencilIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-focus-visible/name:opacity-100 [@media(hover:hover)]:group-hover/name:opacity-100" />
          </button>
        )}
        {chain.isDefault && (
          <Badge variant="outline" className="border-brand/40 text-brand">
            Default
          </Badge>
        )}
        <span className="text-xs text-muted-foreground tabular-nums">
          {photos.length} / {MAX_CHAIN_PHOTOS} photos · {video ? "1 video" : "no video"}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={onPickPhotos}>
            <ImagePlusIcon />
            Photos
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportChain}
            disabled={!poster || items.length === 0 || !!progress}
            title={poster ? `Render every picture with ${poster.name}` : undefined}
          >
            {progress ? <LoaderCircleIcon className="animate-spin" /> : <FileArchiveIcon />}
            {/* The label's width is kept while progress counts, so nothing shifts. */}
            <span className="grid text-left tabular-nums *:col-start-1 *:row-start-1">
              <span aria-hidden className="invisible">
                Export with poster
              </span>
              <span>{progress ?? "Export with poster"}</span>
            </span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${chain.name}`} />}>
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setRenaming(true)}>
                <PencilIcon />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem disabled={chain.isDefault} onClick={() => update(chain, { isDefault: true })}>
                <StarIcon />
                Make default
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onPickVideo}>
                <VideoIcon />
                {video ? "Change video" : "Add video"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={remove}>
                <Trash2Icon />
                Delete chain
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <PhotoStrip
        chain={chain}
        photos={photos.map((p) => p.scene)}
        onView={onView}
        onPickPhotos={onPickPhotos}
        after={
          <>
            <li aria-hidden className="mx-1 w-px shrink-0 self-stretch bg-border" />
            <li className="shrink-0">
              {video && clip ? (
                <Tile
                  label={`Video: ${clip.name}`}
                  caption={`Video · ${clip.name}`}
                  onOpen={() => onView(items.length - 1)}
                  onRemove={() => update(chain, { video: null })}
                  removeLabel="Remove the video"
                >
                  <VideoThumb scene={video.scene} preview={clip.preview} />
                </Tile>
              ) : (
                <AddTile icon={<VideoIcon />} label="Add video" hint="Optional" onClick={onPickVideo} />
              )}
            </li>
          </>
        }
      />
    </article>
  )
}

/** The video's scene with a play mark; hovering plays the clip, as on Etsy. */
function VideoThumb({ scene, preview }: { scene: SceneSummary; preview: string | null }) {
  const video = React.useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = React.useState(false)
  return (
    <span
      className="block size-full"
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse" || matchMedia("(prefers-reduced-motion: reduce)").matches) return
        video.current?.play().catch(() => {})
      }}
      onPointerLeave={() => {
        video.current?.pause()
        setPlaying(false)
      }}
    >
      <SceneThumb scene={scene} />
      {preview && (
        <video
          ref={video}
          src={fileUrl(scene.id, preview)}
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
      <span
        className={cn(
          "pointer-events-none absolute inset-0 grid place-items-center transition-opacity duration-150 ease-out",
          playing && "opacity-0"
        )}
      >
        <span className="grid size-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
          <PlayIcon className="size-4 translate-x-px fill-current" />
        </span>
      </span>
    </span>
  )
}

function RenameField({ name, onDone }: { name: string; onDone: (name: string) => void }) {
  const [value, setValue] = React.useState(name)
  const done = React.useRef(false)
  const finish = (next: string) => {
    if (done.current) return
    done.current = true
    onDone(next.trim())
  }
  return (
    <Input
      autoFocus
      value={value}
      maxLength={60}
      aria-label="Chain name"
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(value)
        else if (event.key === "Escape") finish(name)
      }}
      className="h-7 w-56 text-sm font-semibold"
    />
  )
}

// --- Photos in order ---

function PhotoStrip({
  chain,
  photos,
  onView,
  onPickPhotos,
  after,
}: {
  chain: MockupChain
  photos: SceneSummary[]
  onView: (index: number) => void
  onPickPhotos: () => void
  after: React.ReactNode
}) {
  // While dragging, the strip shows the order under the pointer; it's saved on
  // drop and shown until the save settles. The ref sees it between renders.
  const drag = React.useRef<{ id: string; order: string[] } | null>(null)
  const [dragging, setDragging] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<string[] | null>(null)
  const list = React.useRef<HTMLOListElement>(null)
  const order = preview ?? photos.map((p) => p.id)
  const byId = new Map(photos.map((p) => [p.id, p]))
  const free = MAX_CHAIN_PHOTOS - photos.length

  function save(next: string[]) {
    return next.join() === chain.scenes.join() ? Promise.resolve() : update(chain, { scenes: next })
  }

  function move(id: string, by: number) {
    const from = order.indexOf(id)
    const to = from + by
    if (from < 0 || to < 0 || to >= order.length) return
    const next = [...order]
    next.splice(to, 0, ...next.splice(from, 1))
    save(next)
    // React moves the tile's node, which drops its focus; put it back.
    requestAnimationFrame(() =>
      list.current?.querySelector<HTMLElement>(`[data-scene="${id}"] [data-open]`)?.focus()
    )
  }

  function startDrag(id: string) {
    drag.current = { id, order }
    setDragging(id)
  }

  function dragOver(id: string) {
    const d = drag.current
    if (!d || d.id === id) return
    const next = d.order.filter((s) => s !== d.id)
    next.splice(d.order.indexOf(id), 0, d.id)
    if (next.join() === d.order.join()) return
    drag.current = { id: d.id, order: next }
    setPreview(next)
  }

  // Drop and dragend both end a drag; only the first counts. Dropped on the
  // strip keeps the new order; dropped elsewhere or Esc puts it back.
  function endDrag(commit: boolean) {
    const d = drag.current
    if (!d) return
    drag.current = null
    setDragging(null)
    if (commit) save(d.order).finally(() => setPreview(null))
    else setPreview(null)
  }

  return (
    <ol
      ref={list}
      aria-label={`Photos of ${chain.name}`}
      onDragOver={(event) => {
        if (!drag.current) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
      }}
      onDrop={(event) => {
        if (!drag.current) return
        event.preventDefault()
        endDrag(true)
      }}
      className="-mx-1 flex items-start gap-2 overflow-x-auto px-1 pt-1 pb-1 no-scrollbar"
    >
      {order.map((id, i) => {
        const scene = byId.get(id)
        if (!scene) return null
        return (
          <li
            key={id}
            data-scene={id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move"
              event.dataTransfer.setData("text/plain", id)
              startDrag(id)
            }}
            onDragEnter={() => dragOver(id)}
            onDragEnd={(event) => endDrag(event.dataTransfer.dropEffect !== "none")}
            className={cn(
              "shrink-0 transition-[opacity,transform] duration-150 ease-out",
              dragging === id && "scale-95 opacity-40"
            )}
          >
            <Tile
              label={`Photo ${i + 1}: ${scene.name}`}
              caption={i === 0 ? "Thumbnail" : scene.name}
              badge={i + 1}
              first={i === 0}
              onOpen={() => onView(i)}
              onRemove={() => save(order.filter((s) => s !== id))}
              removeLabel={`Remove ${scene.name}`}
              onMove={(by) => move(id, by)}
              canMove={[i > 0, i < order.length - 1]}
            >
              <SceneThumb scene={scene} />
            </Tile>
          </li>
        )
      })}
      {free > 0 && (
        <li className="shrink-0">
          <AddTile
            icon={<ImagePlusIcon />}
            label={photos.length ? "Add photos" : "Pick photos"}
            hint={`${free} of ${MAX_CHAIN_PHOTOS} free`}
            onClick={onPickPhotos}
          />
        </li>
      )}
      {after}
    </ol>
  )
}

const TILE = "relative size-28 overflow-hidden rounded-lg lg:size-32"

function Tile({
  label,
  caption,
  badge,
  first = false,
  onOpen,
  onRemove,
  removeLabel,
  onMove,
  canMove = [false, false],
  children,
}: {
  label: string
  caption: string
  badge?: React.ReactNode
  first?: boolean
  onOpen: () => void
  onRemove: () => void
  removeLabel: string
  onMove?: (by: -1 | 1) => void
  canMove?: [boolean, boolean]
  children: React.ReactNode
}) {
  return (
    <div className="group/tile flex w-28 flex-col gap-1 lg:w-32">
      <div
        className={cn(
          TILE,
          "bg-muted ring-1 ring-foreground/10 transition-shadow duration-150",
          first && "ring-2 ring-brand/70",
          // The image covers the button, so its focus shows on the frame.
          "has-[[data-open]:focus-visible]:ring-3 has-[[data-open]:focus-visible]:ring-ring"
        )}
      >
        <button
          type="button"
          data-open
          aria-label={label}
          aria-keyshortcuts={onMove ? "Alt+ArrowLeft Alt+ArrowRight Delete" : "Delete"}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (onMove && event.altKey && event.key === "ArrowLeft" && canMove[0]) onMove(-1)
            else if (onMove && event.altKey && event.key === "ArrowRight" && canMove[1]) onMove(1)
            else if (event.key === "Delete" || event.key === "Backspace") onRemove()
            else return
            event.preventDefault()
          }}
          className="absolute inset-0 cursor-zoom-in outline-none transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none"
        >
          {children}
        </button>
        {badge !== undefined && (
          <span
            className={cn(
              "pointer-events-none absolute top-1.5 left-1.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-semibold tabular-nums shadow-sm",
              first ? "bg-brand text-white" : "bg-background/90 text-foreground backdrop-blur-sm"
            )}
          >
            {badge}
          </span>
        )}
        <Button
          variant="secondary"
          size="icon-xs"
          aria-label={removeLabel}
          onClick={onRemove}
          className="absolute top-1.5 right-1.5 rounded-full bg-background/90 opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-150 group-focus-within/tile:opacity-100 pointer-coarse:opacity-100 [@media(hover:hover)]:group-hover/tile:opacity-100"
        >
          <XIcon />
        </Button>
        {onMove && (
          <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between opacity-0 transition-opacity duration-150 group-focus-within/tile:opacity-100 [@media(hover:hover)]:group-hover/tile:opacity-100">
            {([-1, 1] as const).map((by) => (
              <Button
                key={by}
                variant="secondary"
                size="icon-xs"
                tabIndex={-1}
                aria-label={by < 0 ? "Move earlier" : "Move later"}
                title={by < 0 ? "Move earlier (⌥←)" : "Move later (⌥→)"}
                disabled={!canMove[by < 0 ? 0 : 1]}
                onClick={() => onMove(by)}
                className="rounded-full bg-background/90 shadow-sm backdrop-blur-sm disabled:invisible"
              >
                {by < 0 ? <ChevronLeftIcon /> : <ChevronRightIcon />}
              </Button>
            ))}
          </div>
        )}
      </div>
      <span className={cn("truncate px-0.5 text-xs", first ? "font-medium text-brand" : "text-muted-foreground")}>
        {caption}
      </span>
    </div>
  )
}

function AddTile({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <div className="flex w-28 flex-col gap-1 lg:w-32">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          TILE,
          "flex flex-col items-center justify-center gap-1.5 border border-dashed text-muted-foreground outline-none transition-[color,background-color,border-color,transform] duration-150 ease-out hover:border-foreground/30 hover:bg-muted/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] [&_svg]:size-5"
        )}
      >
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </button>
      <span className="truncate px-0.5 text-xs text-muted-foreground/70">{hint}</span>
    </div>
  )
}

// --- From a mockup card ---

/** Chain menu for one mockup: add it to (or take it out of) any chain, or start one with it. */
export function AddToChainItems({ scene, onShowChains }: { scene: SceneSummary; onShowChains: () => void }) {
  const chains = useChains()

  function toggle(chain: MockupChain) {
    const has = chain.scenes.includes(scene.id)
    const scenes = has ? chain.scenes.filter((s) => s !== scene.id) : [...chain.scenes, scene.id]
    patchChain(chain.id, { scenes })
      .then(() =>
        has
          ? toast(`Took ${scene.name} out of ${chain.name}`)
          : toast.success(`${scene.name} is photo ${scenes.length} in ${chain.name}`, {
              action: { label: "Show", onClick: onShowChains },
            })
      )
      .catch((error) => toast.error(`Couldn't change ${chain.name}: ${error.message}`))
  }

  async function startChain() {
    try {
      const chain = await createChain(scene.name, [scene.id])
      toast.success(`New chain “${chain.name}” with ${scene.name} as thumbnail`, {
        action: { label: "Show", onClick: onShowChains },
      })
    } catch (error) {
      toast.error(`Couldn't create the chain: ${(error as Error).message}`)
    }
  }

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>Add to chain</DropdownMenuLabel>
        {chains === null ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : (
          chains.map((chain) => {
            const place = chain.scenes.indexOf(scene.id) + 1
            const full = !place && chain.scenes.length >= MAX_CHAIN_PHOTOS
            return (
              <DropdownMenuItem
                key={chain.id}
                disabled={full}
                closeOnClick={false}
                onClick={() => toggle(chain)}
              >
                {chain.isDefault ? (
                  <StarIcon className="fill-brand text-brand" />
                ) : (
                  <ListOrderedIcon />
                )}
                <span className="min-w-0 flex-1 truncate">{chain.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {full ? "Full" : place ? `#${place}` : `${chain.scenes.length}/${MAX_CHAIN_PHOTOS}`}
                </span>
                <CheckIcon className={cn("size-3.5!", !place && "invisible")} />
              </DropdownMenuItem>
            )
          })
        )}
      </DropdownMenuGroup>
      {chains && chains.length > 0 && <DropdownMenuSeparator />}
      <DropdownMenuItem onClick={startChain}>
        <PlusIcon />
        New chain with this mockup
      </DropdownMenuItem>
    </>
  )
}
