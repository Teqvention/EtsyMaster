"use client"

import Image from "next/image"
import { useRouter } from "next/navigation"
import * as React from "react"
import { FolderIcon, FolderInputIcon, LayoutGridIcon } from "lucide-react"

import { useListingSelection } from "@/components/listings/split-view"
import { CategoryPicker } from "@/components/mockups/category-picker"
import { SelectionBar, SelectMark } from "@/components/selection"
import { steal } from "@/components/steal/steal"
import { StealDialog } from "@/components/steal/steal-dialog"
import { TagFilter, withAnyTag } from "@/components/shops/tag-filter"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Kbd } from "@/components/ui/kbd"
import { scrollParent } from "@/hooks/use-infinite-listings"
import { refreshCategories } from "@/hooks/use-mockup-categories"
import { useSaved, useSavedFolder } from "@/hooks/use-saved"
import { useSelection } from "@/hooks/use-selection"
import { formatCurrency, formatNumber, formatRate } from "@/lib/etsy/format"
import type { Listing } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// A shop's listings as pictures, best sellers first: few numbers, big photos.
// Click picks listings (Shift for a run, ⌘A for all), then "Steal" (or S)
// files them into categories on the Saved page; right-click files them into
// one straight away. Double-click opens the details.

/** Best sellers first: estimated sales a month, then revenue a month. */
export function bySales(listings: Listing[]) {
  return listings.toSorted(
    (a, b) =>
      b.estimate.salesPerMonth - a.estimate.salesPerMonth ||
      b.estimate.revenuePerMonthCents - a.estimate.revenuePerMonthCents
  )
}

type Ranked = { listing: Listing; rank: number }

// Big photos are heavy; reveal them in steps as the grid scrolls.
const STEP = 36
const PRELOAD_MARGIN = "0px 0px 1200px 0px"

export function ListingGallery({
  listings: all,
  loading,
}: {
  /** In gallery order, see `bySales`. */
  listings: Listing[]
  loading: boolean
}) {
  const router = useRouter()
  const { select: openDetails } = useListingSelection()
  const [shown, setShown] = React.useState(STEP)
  // Keywords narrow the grid; a tile keeps its rank in the whole shop.
  const [keywords, setKeywords] = React.useState<string[]>([])
  const ranks = React.useMemo(() => new Map(all.map((l, i) => [l.id, i + 1])), [all])
  const listings = React.useMemo(() => withAnyTag(all, keywords), [all, keywords])
  const ids = React.useMemo(() => listings.map((l) => l.id), [listings])
  const selection = useSelection(ids)
  const saved = useSaved()

  // What the open context menu files: the pick, or the tile right-clicked
  // outside it (which becomes the pick, as in Finder).
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [target, setTarget] = React.useState<number[]>([])
  const pending = React.useRef<number[]>([])

  // The steal dialog, mounted afresh for each opening with what it steals.
  const [stealing, setStealing] = React.useState({ open: false, key: 0, listings: [] as Listing[] })

  const ranked = React.useMemo(
    () => listings.map((listing) => ({ listing, rank: ranks.get(listing.id) ?? 0 })),
    [listings, ranks]
  )

  // Categories load ahead, so the first search is as instant as the next.
  React.useEffect(() => {
    refreshCategories()
  }, [])

  const more = shown < ranked.length
  const sentinel = React.useCallback(
    (node: HTMLElement | null) => {
      if (!node || !more) return
      const observer = new IntersectionObserver(
        ([entry]) => entry.isIntersecting && setShown((n) => n + STEP),
        { root: scrollParent(node), rootMargin: PRELOAD_MARGIN }
      )
      observer.observe(node)
      return () => observer.disconnect()
    },
    [more]
  )

  // Listings saved per folder (lower-cased) for the folder picker, and where each is.
  const { counts, folderOf } = React.useMemo(() => {
    const counts = new Map<string, number>()
    const folderOf = new Map<number, string>()
    for (const s of saved ?? []) {
      counts.set(s.folder.toLowerCase(), (counts.get(s.folder.toLowerCase()) ?? 0) + 1)
      folderOf.set(s.listingId, s.folder)
    }
    return { counts, folderOf }
  }, [saved])

  /** The folder every one of `ids` is in, if they share one. */
  function sharedFolder(ids: Iterable<number>) {
    const folders = new Set([...ids].map((id) => folderOf.get(id) ?? null))
    return folders.size === 1 ? [...folders][0] : null
  }

  function aimMenu(event: React.MouseEvent) {
    const tile = (event.target as HTMLElement).closest<HTMLElement>("[data-listing-id]")
    const id = tile ? Number(tile.dataset.listingId) : null
    const next = id !== null && !selection.has(id) ? [id] : [...selection.selected]
    if (id !== null && !selection.has(id)) selection.replace([id])
    pending.current = next
    setTarget(next)
  }

  function picked(ids: Iterable<number>) {
    const chosen = new Set(ids)
    return listings.filter((l) => chosen.has(l.id))
  }

  function quickSteal(folder: string, ids: number[]) {
    selection.clear()
    steal([{ folder, listings: picked(ids) }], router.push)
  }

  function openSteal(ids: Iterable<number>) {
    const listings = picked(ids)
    if (!listings.length) return
    setStealing((s) => ({ open: true, key: s.key + 1, listings }))
  }

  // S steals the pick.
  const openPicked = React.useEffectEvent(() => openSteal(selection.selected))
  React.useEffect(() => {
    if (!selection.count) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "s" || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement
      if (target.closest("input, textarea, select, [contenteditable], [role=menu], [role=dialog]")) return
      event.preventDefault()
      openPicked()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selection.count])

  const allSelected = ids.length > 0 && selection.count === ids.length

  return (
    <section aria-label="Listings by sales" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <TagFilter
          listings={all}
          value={keywords}
          onChange={(next) => {
            setKeywords(next)
            setShown(STEP)
          }}
        />
        {keywords.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatNumber(listings.length)} of {formatNumber(all.length)} listings
          </span>
        )}
      </div>
      <div className="flex min-h-7 items-center justify-between gap-2 text-xs text-muted-foreground">
        <p className={cn("transition-opacity duration-150", selection.count > 0 && "opacity-0")}>
          Click to select, then steal them into categories. Right-click to steal in one go
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          disabled={!ids.length}
          onClick={allSelected ? selection.clear : selection.selectAll}
        >
          {allSelected ? "Deselect all" : "Select all"}
        </Button>
      </div>

      <ContextMenu
        open={menuOpen}
        onOpenChange={(open) => {
          // Right-clicking the gaps with nothing picked has nothing to file.
          if (open && pending.current.length === 0) return
          setMenuOpen(open)
        }}
      >
        <ContextMenuTrigger
          onContextMenu={aimMenu}
          render={<ol className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-4 gap-y-5" />}
        >
          {ranked.slice(0, shown).map((item) => (
            <li key={item.listing.id}>
              <GalleryTile
                item={item}
                selected={selection.has(item.listing.id)}
                selecting={selection.count > 0}
                onToggle={(range) => selection.toggle(item.listing.id, { range })}
                onOpen={() => openDetails(item.listing)}
              />
            </li>
          ))}
          {loading &&
            Array.from({ length: ranked.length === 0 ? 12 : 4 }, (_, i) => (
              <li key={`skeleton-${i}`} aria-hidden className="flex flex-col gap-2">
                <div className="aspect-[5/4] animate-pulse rounded-xl bg-muted" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              </li>
            ))}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-64 p-0">
          <ContextMenuGroup>
            <ContextMenuLabel className="px-2.5 pt-2 pb-1">
              Steal {target.length === 1 ? "listing" : `${target.length} listings`} into
            </ContextMenuLabel>
          </ContextMenuGroup>
          <CategoryPicker
            onPick={(folder) => quickSteal(folder, target)}
            counts={counts}
            current={sharedFolder(target)}
          />
          <ContextMenuSeparator className="my-0" />
          <ContextMenuGroup className="p-1">
            <ContextMenuItem onClick={() => openSteal(target)}>
              <LayoutGridIcon className="text-muted-foreground" />
              {target.length === 1 ? "Steal…" : `Steal ${target.length}… or sort`}
              <Kbd className="ml-auto">S</Kbd>
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
      {more && <div ref={sentinel} aria-hidden className="h-px" />}

      <SelectionBar
        count={selection.count}
        total={ids.length}
        onSelectAll={selection.selectAll}
        onClear={selection.clear}
      >
        <Button
          size="sm"
          onClick={() => openSteal(selection.selected)}
          className="transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100"
        >
          <FolderInputIcon />
          Steal {selection.count}…
          <Kbd className="-mr-1 bg-primary-foreground/15 text-primary-foreground/80">S</Kbd>
        </Button>
      </SelectionBar>

      {stealing.key > 0 && (
        <StealDialog
          key={stealing.key}
          listings={stealing.listings}
          open={stealing.open}
          onOpenChange={(open) => setStealing((s) => ({ ...s, open }))}
          onStolen={(stolen) => selection.replace([...selection.selected].filter((id) => !stolen.has(id)))}
        />
      )}
    </section>
  )
}

function GalleryTile({
  item: { listing, rank },
  selected,
  selecting,
  onToggle,
  onOpen,
}: {
  item: Ranked
  selected: boolean
  selecting: boolean
  onToggle: (range: boolean) => void
  onOpen: () => void
}) {
  const { selectedId } = useListingSelection()
  const folder = useSavedFolder(listing.id)
  const [loaded, setLoaded] = React.useState(false)
  const image = listing.images[0]

  return (
    <button
      type="button"
      data-listing-id={listing.id}
      aria-pressed={selected}
      aria-label={`${listing.title}, number ${rank} by sales`}
      onClick={(event) => onToggle(event.shiftKey)}
      onDoubleClick={onOpen}
      className="group/tile flex w-full flex-col gap-2 rounded-xl text-left outline-none select-none"
    >
      <span
        className={cn(
          "relative block aspect-[5/4] w-full overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/5 transition-[transform,box-shadow] duration-150 ease-out group-focus-visible/tile:ring-3 group-focus-visible/tile:ring-ring/50 group-active/tile:scale-[0.985] motion-reduce:group-active/tile:scale-100 [@media(hover:hover)]:group-hover/tile:ring-foreground/20",
          selectedId === listing.id && "ring-2 ring-foreground/50",
          selected && "ring-2 ring-brand [@media(hover:hover)]:group-hover/tile:ring-brand"
        )}
        style={listing.color ? { backgroundColor: listing.color } : undefined}
      >
        {image && (
          <Image
            src={image.medium}
            alt=""
            fill
            unoptimized
            sizes="(min-width: 1024px) 25vw, 50vw"
            onLoad={() => setLoaded(true)}
            draggable={false}
            className={cn(
              "object-cover transition-opacity duration-300 ease-out",
              loaded ? "opacity-100" : "opacity-0"
            )}
          />
        )}
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 bg-brand/10 opacity-0 transition-opacity duration-150",
            selected && "opacity-100"
          )}
        />
        <SelectMark selected={selected} selecting={selecting} />

        {folder && (
          <span className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium shadow-sm backdrop-blur-sm transition-[opacity,transform] duration-200 ease-out-strong starting:scale-95 starting:opacity-0">
            <FolderIcon className="size-3 shrink-0" />
            <span className="truncate">{folder}</span>
          </span>
        )}
      </span>

      <span className="flex items-baseline gap-2 px-0.5 text-sm tabular-nums">
        <span className="w-6 shrink-0 text-xs text-muted-foreground">{rank}</span>
        <span className="font-medium">
          {formatRate(listing.estimate.salesPerMonth, true)}
          <span className="font-normal text-muted-foreground"> / mo</span>
        </span>
        <span className="ml-auto text-muted-foreground">
          {formatCurrency(listing.priceCents, listing.currency)}
        </span>
      </span>
    </button>
  )
}
