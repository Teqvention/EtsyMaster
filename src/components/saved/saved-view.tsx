"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import {
  CircleAlertIcon,
  CheckIcon,
  ExternalLinkIcon,
  FolderIcon,
  FolderInputIcon,
  FolderOpenIcon,
  FrameIcon,
  HeartIcon,
  LayersIcon,
  LoaderCircleIcon,
  PaletteIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { GenerateDialog } from "@/components/generation/generate-dialog"
import { LikedView } from "@/components/listings/liked-view"
import { CategoryPicker } from "@/components/mockups/category-picker"
import { SelectionBar, SelectMark } from "@/components/selection"
import { StyleFromSavedDialog } from "@/components/styles/style-from-saved"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { generate, isActive, retryGeneration, useGenerations } from "@/hooks/use-generations"
import { useLikes } from "@/hooks/use-likes"
import { createCategory, refreshCategories, useCategories } from "@/hooks/use-categories"
import { removeFromSaved, saveToFolder, useSaved } from "@/hooks/use-saved"
import { useSelection } from "@/hooks/use-selection"
import { formatCurrency } from "@/lib/etsy/format"
import type { GenerateOptions, GenerationKind, GenerationSet } from "@/lib/generation/types"
import type { SavedListing } from "@/lib/saved/types"
import { MAX_IMAGES } from "@/lib/styles/types"
import { cn } from "@/lib/utils"

// Saved: liked listings, and the folders listings are filed into from a
// shop's gallery. A folder's posters are where generation starts: its
// mockups (a blank mockup scene per photo, in a mockup category picked for
// them: folders aren't mockup categories), its posters (taken out of the photo and redrawn as new designs) and
// a style (their look, read off a moodboard of them).
// What's open lives in the URL: `?folder=` a folder, `?liked` the likes,
// neither every folder at once ("All", where Generate all starts from).

type Folder = { name: string; count: number; busy: boolean }

export function SavedView({ currency }: { currency: string }) {
  const saved = useSaved()
  const categories = useCategories("saved")
  const likes = useLikes()
  const sets = useGenerations()
  const [param, open] = useOpenFolder()
  const [collapsed, storeCollapsed] = useFoldersCollapsed()
  // The bar slides only when toggled here, not when the remembered state
  // arrives after hydration.
  const [animated, setAnimated] = React.useState(false)
  const setCollapsed = (next: boolean) => {
    setAnimated(true)
    storeCollapsed(next)
  }

  React.useEffect(() => {
    refreshCategories("saved")
  }, [])

  const folders = React.useMemo(() => {
    const byKey = new Map<string, Folder>()
    for (const { name } of categories) byKey.set(name.toLowerCase(), { name, count: 0, busy: false })
    for (const { folder } of saved ?? []) {
      const entry = byKey.get(folder.toLowerCase()) ?? { name: folder, count: 0, busy: false }
      byKey.set(folder.toLowerCase(), { ...entry, count: entry.count + 1 })
    }
    // Busy by where the listing is saved: a mockup set's folder is its mockup category.
    const folderOf = new Map((saved ?? []).map((s) => [s.listingId, s.folder]))
    for (const set of sets ?? []) {
      const entry = byKey.get((folderOf.get(set.source.listingId) ?? set.folder).toLowerCase())
      if (entry && isActive(set)) entry.busy = true
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [categories, saved, sets])
  const counts = React.useMemo(() => new Map(folders.map((f) => [f.name.toLowerCase(), f.count])), [folders])

  const current =
    param === LIKED || param === null
      ? param
      : (folders.find((f) => f.name.toLowerCase() === param.toLowerCase())?.name ?? param)
  const items = React.useMemo(
    () =>
      current === LIKED
        ? []
        : current === null
          ? // Folder by folder, as All shows them (and Shift-click runs over them).
            (saved ?? []).toSorted((a, b) => a.folder.localeCompare(b.folder, undefined, { sensitivity: "base" }))
          : (saved ?? []).filter((s) => s.folder.toLowerCase() === current.toLowerCase()),
    [saved, current]
  )

  const expand = collapsed ? (
    <Button variant="ghost" size="icon-sm" aria-label="Show folders" title="Show folders" onClick={() => setCollapsed(false)}>
      <PanelLeftOpenIcon />
    </Button>
  ) : null

  return (
    <div className="flex items-start">
      <FolderBar
        folders={folders}
        total={saved?.length ?? 0}
        liked={Object.keys(likes).length}
        current={current}
        onOpen={open}
        collapsed={collapsed}
        animated={animated}
        onCollapse={() => setCollapsed(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {current === LIKED ? (
          <>
            <PaneHeader icon={<HeartIcon />} title="Liked" before={expand} />
            <LikedView currency={currency} />
          </>
        ) : saved === null ? (
          <div className="flex flex-col gap-3 px-4 lg:px-6">
            <Skeleton className="h-8 w-48 rounded-lg" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-4">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="aspect-[4/5] rounded-xl" />
              ))}
            </div>
          </div>
        ) : (
          <FolderView key={current ?? ALL_KEY} folder={current} items={items} sets={sets} counts={counts} expand={expand} />
        )}
      </div>
    </div>
  )
}

function PaneHeader({
  icon,
  title,
  count,
  before,
  children,
}: {
  icon: React.ReactNode
  title: string
  count?: number
  before?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <header className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-2 px-4 lg:px-6">
      {before}
      <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
        {icon}
        <span className="truncate">{title}</span>
        {count !== undefined && <span className="text-sm font-normal text-muted-foreground tabular-nums">{count}</span>}
      </h2>
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </header>
  )
}

// --- Folder bar ---

function FolderBar({
  folders,
  total,
  liked,
  current,
  onOpen,
  collapsed,
  animated,
  onCollapse,
}: {
  folders: Folder[]
  /** Listings saved in any folder. */
  total: number
  liked: number
  /** A folder, all of them (null) or `LIKED`. */
  current: string | null
  onOpen: (folder: string | null) => void
  collapsed: boolean
  animated: boolean
  onCollapse: () => void
}) {
  const [adding, setAdding] = React.useState(false)

  return (
    <div
      inert={collapsed}
      className={cn(
        "sticky top-6 shrink-0 overflow-hidden",
        animated && "transition-[width,opacity] duration-200 ease-out-strong motion-reduce:transition-none",
        collapsed ? "w-0 opacity-0" : "w-60 opacity-100 lg:w-62"
      )}
    >
      <nav
        aria-label="Folders"
        className="ml-4 flex max-h-[calc(100svh-var(--header-height)-4rem)] w-56 flex-col gap-0.5 overflow-y-auto rounded-xl border bg-muted/40 p-1.5 lg:ml-6"
      >
        <div className="flex items-center justify-between py-0.5 pr-0.5 pl-2">
          <span className="text-xs font-medium text-muted-foreground">Saved</span>
          <Button variant="ghost" size="icon-xs" aria-label="Hide folders" title="Hide folders" onClick={onCollapse}>
            <PanelLeftCloseIcon />
          </Button>
        </div>
        <FolderButton
          icon={<LayersIcon />}
          name="All"
          count={total}
          busy={folders.some((f) => f.busy)}
          current={current === null}
          onClick={() => onOpen(null)}
        />
        <FolderButton
          icon={<HeartIcon />}
          name="Liked"
          count={liked}
          current={current === LIKED}
          onClick={() => onOpen(LIKED)}
        />

        <div className="mt-2 flex items-center justify-between py-0.5 pr-0.5 pl-2">
          <span className="text-xs font-medium text-muted-foreground">Folders</span>
          <Button variant="ghost" size="icon-xs" aria-label="New folder" title="New folder" onClick={() => setAdding(true)}>
            <PlusIcon />
          </Button>
        </div>
        {adding && (
          <NewFolder
            onDone={(name) => {
              setAdding(false)
              if (name) onOpen(name)
            }}
          />
        )}
        {folders.map((folder) => (
          <FolderButton
            key={folder.name}
            icon={current?.toLowerCase() === folder.name.toLowerCase() ? <FolderOpenIcon /> : <FolderIcon />}
            name={folder.name}
            count={folder.count}
            busy={folder.busy}
            current={current?.toLowerCase() === folder.name.toLowerCase()}
            onClick={() => onOpen(folder.name)}
          />
        ))}
        {folders.length === 0 && !adding && (
          <p className="px-2 py-1.5 text-xs text-pretty text-muted-foreground">
            Select listings in a shop and right-click to file them into a folder.
          </p>
        )}
      </nav>
    </div>
  )
}

function FolderButton({
  icon,
  name,
  count,
  busy = false,
  current,
  onClick,
}: {
  icon: React.ReactNode
  name: string
  count: number
  busy?: boolean
  current: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-current={current || undefined}
      onClick={onClick}
      className="flex h-8 w-full shrink-0 items-center gap-2 rounded-lg px-2 text-left text-sm outline-none transition-[background-color,transform] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] aria-current:bg-background aria-current:font-medium aria-current:shadow-sm aria-current:ring-1 aria-current:ring-foreground/5 motion-reduce:active:scale-100 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground [@media(hover:hover)]:not-aria-current:hover:bg-muted"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {busy ? (
        <LoaderCircleIcon aria-label="Generating" className="size-3.5! animate-spin" />
      ) : (
        count > 0 && <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
      )}
    </button>
  )
}

function NewFolder({ onDone }: { onDone: (name: string | null) => void }) {
  const [name, setName] = React.useState("")
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const clean = name.trim()
        onDone(clean ? createCategory("saved", clean) : null)
      }}
      className="px-0.5 py-0.5"
    >
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => !name.trim() && onDone(null)}
        onKeyDown={(event) => event.key === "Escape" && onDone(null)}
        placeholder="Folder name"
        aria-label="New folder name"
        maxLength={40}
        className="h-8 bg-background"
      />
    </form>
  )
}

// --- A folder's posters ---

const NOUNS: Record<GenerationKind, [string, string]> = {
  mockup: ["mockup", "mockups"],
  poster: ["poster", "posters"],
}
const noun = (kind: GenerationKind, n: number) => NOUNS[kind][n === 1 ? 0 : 1]

const sourceOf = (i: SavedListing) => ({
  listingId: i.listingId,
  title: i.title,
  image: i.image,
  url: i.url,
  shop: i.shop,
  tags: i.tags,
})

/** The folder every one of `listings` is in, if they share one. */
function sharedFolder(listings: SavedListing[]) {
  const folders = new Set(listings.map((l) => l.folder))
  return folders.size === 1 ? [...folders][0] : null
}

/** Listings to start sets for, and failed sets to run again. */
type Work = { fresh: SavedListing[]; again: GenerationSet[] }

function FolderView({
  folder,
  items,
  sets,
  counts,
  expand,
}: {
  /** Null for every folder at once. */
  folder: string | null
  items: SavedListing[]
  sets: GenerationSet[] | null
  /** Listings per folder (lower-cased), for moving. */
  counts: ReadonlyMap<string, number>
  expand: React.ReactNode
}) {
  const router = useRouter()
  const ids = React.useMemo(() => items.map((i) => i.listingId), [items])
  const selection = useSelection(ids)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [target, setTarget] = React.useState<number[]>([])
  const pending = React.useRef<number[]>([])
  // Posters ask what to make first; this is what they'll run on.
  const [asking, setAsking] = React.useState<Work | null>(null)
  // A style asks which posters go on its board: these picked to start, or all of them.
  const [styling, setStyling] = React.useState<number[] | null>(null)

  // The newest set of each kind per listing (sets come newest first).
  const latest = React.useMemo(() => {
    const map = new Map<string, GenerationSet>()
    for (const set of sets ?? []) {
      const key = `${set.kind}:${set.source.listingId}`
      if (!map.has(key)) map.set(key, set)
    }
    return map
  }, [sets])

  const byId = React.useMemo(() => new Map(items.map((i) => [i.listingId, i])), [items])
  // All shows each folder under a small heading; a folder is one untitled group.
  const groups = React.useMemo(() => {
    if (folder) return [{ name: null as string | null, items }]
    const byFolder = new Map<string, { name: string | null; items: SavedListing[] }>()
    for (const item of items) {
      const key = item.folder.toLowerCase()
      const group = byFolder.get(key) ?? { name: item.folder, items: [] }
      group.items.push(item)
      byFolder.set(key, group)
    }
    return [...byFolder.values()]
  }, [folder, items])
  const pick = (ids: Iterable<number>) => [...ids].flatMap((id) => byId.get(id) ?? [])

  /**
   * What a Generate button runs on: the pick as it is, or with nothing
   * picked, every poster without a result yet (failed ones run again).
   */
  function work(kind: GenerationKind): Work {
    if (selection.count) return { fresh: pick(selection.selected), again: [] as GenerationSet[] }
    const fresh: SavedListing[] = []
    const again: GenerationSet[] = []
    for (const item of items) {
      const set = latest.get(`${kind}:${item.listingId}`)
      if (!set) fresh.push(item)
      else if (set.status === "error") again.push(set)
    }
    return { fresh, again }
  }

  /** Mockups go `into` the mockup category picked for them. */
  async function run(kind: GenerationKind, { fresh, again }: Work, options?: GenerateOptions, into?: string) {
    const n = fresh.length + again.length
    if (!n) return
    // New posters ask what to make; failed sets just run again as asked before.
    if (kind === "poster" && !options && fresh.length) return setAsking({ fresh, again })
    selection.clear()
    // Posters go in each listing's own folder, mockups in their mockup category.
    const byFolder = Map.groupBy(fresh, (i) => into ?? i.folder)
    try {
      await Promise.all([
        ...[...byFolder].map(([to, listings]) => generate(kind, to, listings.map(sourceOf), options)),
        ...again.map((set) => retryGeneration(set.id)),
      ])
      const per = options ? options.variants.count + options.ideas.count : 0
      toast.success(`Generating ${n} ${noun(kind, n)}`, {
        description:
          kind === "poster"
            ? per
              ? `Each poster is taken out of its photo, then ${per} new ${per === 1 ? "one is" : "ones are"} drawn from it.`
              : "What failed before runs again."
            : into
              ? `Each photo becomes a blank mockup in the ${into} category.`
              : "What failed before runs again.",
        action: {
          label: "View",
          onClick: () =>
            router.push(
              into
                ? `/generation?kind=mockup&folder=${encodeURIComponent(into)}`
                : folder
                  ? `/generation?folder=${encodeURIComponent(folder)}`
                  : "/generation"
            ),
        },
      })
    } catch (error) {
      toast.error(`Couldn't start: ${(error as Error).message}`)
    }
  }

  async function move(to: string, all: SavedListing[]) {
    const listings = all.filter((l) => l.folder.toLowerCase() !== to.toLowerCase())
    if (!listings.length) return
    selection.clear()
    try {
      // Saving again files them under the new folder (and date).
      await saveToFolder(listings, to)
      toast.success(`Moved ${listings.length === 1 ? "1 listing" : `${listings.length} listings`} to ${to}`, {
        action: { label: "Open", onClick: () => router.push(`/liked?folder=${encodeURIComponent(to)}`) },
      })
    } catch (error) {
      toast.error(`Couldn't move: ${(error as Error).message}`)
    }
  }

  async function remove(listings: SavedListing[]) {
    selection.clear()
    try {
      await removeFromSaved(listings.map((l) => l.listingId))
      toast(`Removed ${listings.length === 1 ? "1 listing" : `${listings.length} listings`} from ${folder ?? "Saved"}`, {
        action: {
          label: "Undo",
          onClick: () => Map.groupBy(listings, (l) => l.folder).forEach((back, to) => saveToFolder(back, to)),
        },
      })
    } catch (error) {
      toast.error(`Couldn't remove: ${(error as Error).message}`)
    }
  }

  function aimMenu(event: React.MouseEvent) {
    const tile = (event.target as HTMLElement).closest<HTMLElement>("[data-listing-id]")
    const id = tile ? Number(tile.dataset.listingId) : null
    const next = id !== null && !selection.has(id) ? [id] : [...selection.selected]
    if (id !== null && !selection.has(id)) selection.replace([id])
    pending.current = next
    setTarget(next)
  }

  const mockups = work("mockup")
  const posters = work("poster")
  const targeted = pick(target)

  return (
    <>
      <PaneHeader
        icon={folder ? <FolderOpenIcon /> : <LayersIcon />}
        title={folder ?? "All"}
        count={items.length}
        before={expand}
      >
        {folder && (
          <Button
            variant="outline"
            size="sm"
            disabled={!items.length}
            onClick={() => setStyling([...selection.selected])}
            title={
              selection.count
                ? `A style from the ${selection.count} selected`
                : "A style from the posters in this folder"
            }
          >
            <PaletteIcon />
            Generate style
            <Count value={Math.min(selection.count || items.length, MAX_IMAGES)} variant="outline" />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <GenerateButton
                kind="mockup"
                icon={<FrameIcon />}
                variant="outline"
                count={mockups.fresh.length + mockups.again.length}
                picked={selection.count > 0}
                disabled={!items.length}
              />
            }
          />
          <DropdownMenuContent align="end" className="w-64 p-0">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2.5 pt-2 pb-1">Into mockup category</DropdownMenuLabel>
            </DropdownMenuGroup>
            <CategoryPicker of="mockups" onPick={(into) => run("mockup", mockups, undefined, into)} />
          </DropdownMenuContent>
        </DropdownMenu>
        <GenerateButton
          kind="poster"
          label={folder ? undefined : "Generate all"}
          icon={<SparklesIcon />}
          variant="default"
          count={posters.fresh.length + posters.again.length}
          picked={selection.count > 0}
          disabled={!items.length}
          onClick={() => run("poster", posters)}
        />
      </PaneHeader>

      <div className="flex flex-col gap-3 px-4 lg:px-6">
        {items.length === 0 ? (
          <Empty className="min-h-[50svh] border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpenIcon />
              </EmptyMedia>
              <EmptyTitle>{folder ? `Nothing in ${folder} yet` : "Nothing saved yet"}</EmptyTitle>
              <EmptyDescription>
                In a shop&apos;s Listings, select posters and right-click to save them {folder ? "here" : "into a folder"}.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button nativeButton={false} render={<Link href="/shops" />}>
                Find shops
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <ContextMenu
            open={menuOpen}
            onOpenChange={(open) => {
              if (open && pending.current.length === 0) return
              setMenuOpen(open)
            }}
          >
            <ContextMenuTrigger onContextMenu={aimMenu} render={<div className="flex flex-col gap-8" />}>
              {groups.map((group) => (
                <section key={group.name} aria-label={group.name ?? undefined} className="flex flex-col gap-3">
                  {group.name !== null && (
                    <h3 className="sticky top-0 z-10 -mx-1 flex items-baseline gap-2 bg-background/85 px-1 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm">
                      <button
                        type="button"
                        onClick={() => router.replace(`/liked?folder=${encodeURIComponent(group.name!)}`)}
                        className="flex items-center gap-1.5 rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5"
                        title={`Open ${group.name}`}
                      >
                        <FolderIcon />
                        {group.name}
                      </button>
                      <span className="font-normal tabular-nums">{group.items.length}</span>
                    </h3>
                  )}
                  <ol className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-4 gap-y-5">
                    {group.items.map((item) => (
                      <li key={item.listingId}>
                        <SavedTile
                          item={item}
                          mockup={latest.get(`mockup:${item.listingId}`)}
                          poster={latest.get(`poster:${item.listingId}`)}
                          selected={selection.has(item.listingId)}
                          selecting={selection.count > 0}
                          onToggle={(range) => selection.toggle(item.listingId, { range })}
                        />
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
              <ContextMenuGroup>
                <ContextMenuLabel className="truncate">
                  {targeted.length === 1 ? targeted[0].title : `${targeted.length} listings`}
                </ContextMenuLabel>
              </ContextMenuGroup>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <FrameIcon />
                  Generate {noun("mockup", targeted.length)}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-64 p-0">
                  <ContextMenuGroup>
                    <ContextMenuLabel className="px-2.5 pt-2 pb-1">Into mockup category</ContextMenuLabel>
                  </ContextMenuGroup>
                  <CategoryPicker
                    of="mockups"
                    onPick={(into) => run("mockup", { fresh: targeted, again: [] }, undefined, into)}
                  />
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuItem onClick={() => run("poster", { fresh: targeted, again: [] })}>
                <SparklesIcon />
                Generate {noun("poster", targeted.length)}
              </ContextMenuItem>
              {folder && (
                <ContextMenuItem onClick={() => setStyling(target)}>
                  <PaletteIcon />
                  Generate style
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <FolderInputIcon />
                  Move to
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-64 p-0">
                  <CategoryPicker of="saved" onPick={(to) => move(to, targeted)} counts={counts} current={folder ?? sharedFolder(targeted)} />
                </ContextMenuSubContent>
              </ContextMenuSub>
              {targeted.length === 1 && (
                <ContextMenuItem render={<a href={targeted[0].url} target="_blank" rel="noopener noreferrer" />}>
                  <ExternalLinkIcon />
                  Open on Etsy
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onClick={() => remove(targeted)}>
                <Trash2Icon />
                Remove from Saved
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}

        <GenerateDialog
          open={asking !== null}
          onOpenChange={(open) => !open && setAsking(null)}
          title={`Generate posters · ${folder ?? "All folders"}`}
          description={
            asking &&
            [
              asking.fresh.length > 0 && `${asking.fresh.length} new`,
              asking.again.length > 0 && `${asking.again.length} failed, run again as before`,
            ]
              .filter(Boolean)
              .join(" · ")
          }
          thumbs={(asking?.fresh ?? []).slice(0, 3).map((i) => i.image)}
          references={{ count: asking?.fresh.length ?? 1, noun: "steal" }}
          onSubmit={(options) => (asking ? run("poster", asking, options) : undefined)}
        />

        {folder && (
          <StyleFromSavedDialog
            open={styling !== null}
            onOpenChange={(open) => !open && setStyling(null)}
            folder={folder}
            picked={styling ?? undefined}
            onDone={() => selection.clear()}
          />
        )}

        <SelectionBar
          count={selection.count}
          total={items.length}
          onSelectAll={selection.selectAll}
          onClear={selection.clear}
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="sm">
                  <FolderInputIcon />
                  Move to…
                </Button>
              }
            />
            <DropdownMenuContent side="top" align="center" sideOffset={8} className="w-64 p-0">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-2.5 pt-2 pb-1">
                  Move {selection.count === 1 ? "listing" : `${selection.count} listings`} to
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <CategoryPicker
                of="saved"
                onPick={(to) => move(to, pick(selection.selected))}
                counts={counts}
                current={folder ?? sharedFolder(pick(selection.selected))}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="sm" onClick={() => remove(pick(selection.selected))}>
            <Trash2Icon />
            Remove
          </Button>
        </SelectionBar>
      </div>
    </>
  )
}

function GenerateButton({
  kind,
  label = kind === "mockup" ? "Generate mockups" : "Generate posters",
  icon,
  variant,
  count,
  picked,
  disabled,
  ...props
}: {
  kind: GenerationKind
  label?: string
  icon: React.ReactNode
  variant: "default" | "outline"
  count: number
  picked: boolean
  disabled: boolean
} & Omit<React.ComponentProps<typeof Button>, "variant" | "disabled">) {
  const done = !picked && count === 0
  return (
    <Button
      {...props}
      variant={variant}
      size="sm"
      disabled={disabled || done}
      title={
        done
          ? `Every listing here has ${kind === "mockup" ? "a mockup" : "its posters"} — select some to run them again`
          : picked
            ? `For the ${count} selected`
            : `For the ${count} without ${noun(kind, 2)} yet`
      }
    >
      {icon}
      {label}
      {!done && <Count value={count} variant={variant} />}
    </Button>
  )
}

/** How many listings a header button runs on. */
function Count({ value, variant }: { value: number; variant: "default" | "outline" }) {
  return (
    <span
      className={cn(
        "-mr-0.5 rounded-full px-1.5 text-[11px] leading-4 font-medium tabular-nums",
        variant === "default" ? "bg-primary-foreground/15" : "bg-muted text-muted-foreground"
      )}
    >
      {value}
    </span>
  )
}

function SavedTile({
  item,
  mockup,
  poster,
  selected,
  selecting,
  onToggle,
}: {
  item: SavedListing
  mockup: GenerationSet | undefined
  poster: GenerationSet | undefined
  selected: boolean
  selecting: boolean
  onToggle: (range: boolean) => void
}) {
  const [loaded, setLoaded] = React.useState(false)
  return (
    <button
      type="button"
      data-listing-id={item.listingId}
      aria-pressed={selected}
      aria-label={item.title}
      onClick={(event) => onToggle(event.shiftKey)}
      className="group/tile flex w-full flex-col gap-2 rounded-xl text-left outline-none select-none"
    >
      <span
        className={cn(
          "relative block aspect-[4/5] w-full overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/5 transition-[transform,box-shadow] duration-150 ease-out group-focus-visible/tile:ring-3 group-focus-visible/tile:ring-ring/50 group-active/tile:scale-[0.985] motion-reduce:group-active/tile:scale-100 [@media(hover:hover)]:group-hover/tile:ring-foreground/20",
          selected && "ring-2 ring-brand [@media(hover:hover)]:group-hover/tile:ring-brand"
        )}
        style={item.color ? { backgroundColor: item.color } : undefined}
      >
        <Image
          src={item.thumb}
          alt=""
          fill
          unoptimized
          sizes="(min-width: 1024px) 20vw, 50vw"
          onLoad={() => setLoaded(true)}
          draggable={false}
          className={cn("object-cover transition-opacity duration-300 ease-out", loaded ? "opacity-100" : "opacity-0")}
        />
        <span
          aria-hidden
          className={cn("absolute inset-0 bg-brand/10 opacity-0 transition-opacity duration-150", selected && "opacity-100")}
        />
        <SelectMark selected={selected} selecting={selecting} />
        {(mockup || poster) && (
          <span className="absolute top-2 right-2 flex flex-col items-end gap-1">
            {mockup && <SetChip set={mockup} label="Mockup" />}
            {poster && <SetChip set={poster} label="Posters" />}
          </span>
        )}
      </span>
      <span className="flex flex-col gap-0.5 px-0.5">
        <span className="truncate text-sm font-medium">{item.title}</span>
        <span className="flex items-baseline gap-2 text-xs text-muted-foreground tabular-nums">
          <span className="min-w-0 truncate">{item.shop ?? "Etsy"}</span>
          <span className="ml-auto shrink-0">{formatCurrency(item.priceCents, item.currency)}</span>
        </span>
      </span>
    </button>
  )
}

/** Where the listing's newest set of a kind stands. */
function SetChip({ set, label }: { set: GenerationSet; label: string }) {
  return (
    <span className="flex items-center gap-1 rounded-full bg-background/90 py-0.5 pr-2 pl-1.5 text-[11px] font-medium shadow-sm backdrop-blur-sm transition-[opacity,transform] duration-200 ease-out-strong starting:scale-95 starting:opacity-0">
      {isActive(set) ? (
        <LoaderCircleIcon className="size-3 animate-spin text-muted-foreground" />
      ) : set.status === "error" ? (
        <CircleAlertIcon className="size-3 text-destructive" />
      ) : (
        <CheckIcon className="size-3 text-brand" strokeWidth={3} />
      )}
      {label}
    </span>
  )
}

// --- State ---

/** Stands for Liked where a folder name goes; no folder can be called this. */
const LIKED = "\0liked"
const ALL_KEY = "\0all"

/** The open folder, null for All, or `LIKED`. */
function useOpenFolder() {
  const searchParams = useSearchParams()
  const folder = searchParams.has("liked") ? LIKED : searchParams.get("folder")
  const open = React.useCallback((next: string | null) => {
    const params = new URLSearchParams(window.location.search)
    params.delete("folder")
    params.delete("liked")
    if (next === LIKED) params.set("liked", "")
    else if (next !== null) params.set("folder", next)
    // A listing open in Liked belongs to Liked.
    params.delete("listing")
    const query = params.toString()
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
  }, [])
  return [folder, open] as const
}

const COLLAPSED_KEY = "etsy-research:folders-collapsed"
const collapseListeners = new Set<() => void>()

function subscribeCollapsed(notify: () => void) {
  collapseListeners.add(notify)
  return () => {
    collapseListeners.delete(notify)
  }
}

/** Whether the folder bar is hidden; remembered on this device. */
function useFoldersCollapsed() {
  const collapsed = React.useSyncExternalStore(
    subscribeCollapsed,
    () => localStorage.getItem(COLLAPSED_KEY) === "1",
    () => false
  )
  const set = React.useCallback((next: boolean) => {
    localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0")
    collapseListeners.forEach((notify) => notify())
  }, [])
  return [collapsed, set] as const
}
