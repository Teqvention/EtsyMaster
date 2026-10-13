"use client"

import Image from "next/image"
import { useRouter } from "next/navigation"
import * as React from "react"
import { ArrowDownToLineIcon, EyeOffIcon, FolderIcon, FolderInputIcon, LayoutGridIcon, Rows3Icon } from "lucide-react"

import { useListingSelection } from "@/components/listings/split-view"
import { CategoryPicker } from "@/components/mockups/category-picker"
import { SelectionBar, SelectMark } from "@/components/selection"
import { steal } from "@/components/steal/steal"
import { StealDialog } from "@/components/steal/steal-dialog"
import { ListingTable } from "@/components/shops/listing-table"
import { ShopStyleActions } from "@/components/shops/shop-style-actions"
import { FLAGS, FlagMarks, TierBadge, TIERS, TrendMark } from "@/components/shops/rank-badges"
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
import { refreshCategories } from "@/hooks/use-categories"
import { useSaved, useSavedFolder } from "@/hooks/use-saved"
import { useSelection } from "@/hooks/use-selection"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ShopCalibration } from "@/lib/etsy/calibrate"
import {
  formatCompact,
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatRate,
} from "@/lib/etsy/format"
import type { Listing } from "@/lib/etsy/types"
import { describeFolder } from "@/lib/saved/folders"
import { cn } from "@/lib/utils"

// A shop's listings, best sellers first: as big photos, or as a table of
// every number the ranking is made of. The chips above narrow them to what
// to look at first (the top tiers, rising, new, sleeping). Click picks
// listings (Shift for a run, ⌘A for all), then "Steal" (or S) files them into
// categories on the Saved page; right-click files them into one straight
// away. Double-click (a click, in the table) opens the details.

export type GallerySort =
  | "sales"
  | "revenue"
  | "trend"
  | "lifetime"
  | "reviews"
  | "favorites"
  | "favoritesPace"
  | "gained"
  | "views"
  | "price"
  | "newest"

const perMonth = (l: Listing) => l.favorites / (Math.max(l.ageDays, 30) / 30)

/** Ways to rank the whole shop, best first; `value` is what a tile shows. */
const SORTS: {
  value: GallerySort
  label: string
  by: (l: Listing) => number
  show: (l: Listing) => React.ReactNode
}[] = [
  {
    value: "sales",
    label: "Rank · sales / mo",
    by: (l) => l.estimate.salesPerMonth,
    show: (l) => <Metric value={formatRate(l.estimate.salesPerMonth, true)} unit="/ mo" />,
  },
  {
    value: "revenue",
    label: "Revenue / mo",
    by: (l) => l.estimate.revenuePerMonthCents,
    show: (l) => <Metric value={formatCompactCurrency(l.estimate.revenuePerMonthCents, l.currency)} unit="/ mo" />,
  },
  {
    value: "trend",
    label: "Trend",
    by: (l) => l.rank?.trend ?? -1,
    show: (l) => <TrendMark rank={l.rank} />,
  },
  {
    value: "lifetime",
    label: "Sales, all time",
    by: (l) => l.estimate.sales,
    show: (l) => <Metric value={formatRate(l.estimate.sales, true)} unit="sold" />,
  },
  {
    value: "reviews",
    label: "Reviews, 12 mo",
    by: (l) => l.rank?.reviews.year ?? l.reviewCount ?? 0,
    show: (l) => <Metric value={formatNumber(l.rank?.reviews.year ?? l.reviewCount ?? 0)} unit="reviews" />,
  },
  {
    value: "favorites",
    label: "Favorites",
    by: (l) => l.favorites,
    show: (l) => <Metric value={formatCompact(l.favorites)} unit="favs" />,
  },
  {
    value: "favoritesPace",
    label: "Favorites / mo",
    by: perMonth,
    show: (l) => <Metric value={formatRate(perMonth(l))} unit="favs / mo" />,
  },
  {
    value: "gained",
    label: "Favorites gained",
    by: (l) => l.rank?.favoritesGained?.count ?? -1,
    show: (l) => <Metric value={`+${formatNumber(l.rank?.favoritesGained?.count ?? 0)}`} unit="favs since" />,
  },
  {
    value: "views",
    label: "Views",
    by: (l) => l.views,
    show: (l) => <Metric value={formatCompact(l.views)} unit="views" />,
  },
  {
    value: "price",
    label: "Price",
    by: (l) => l.priceCents,
    show: (l) => <Metric value={formatCurrency(l.priceCents, l.currency)} unit="" />,
  },
  {
    value: "newest",
    label: "Newest",
    by: (l) => -l.ageDays,
    show: (l) => <Metric value={formatCompact(Math.round(l.ageDays))} unit="days old" />,
  },
]

// --- What to look at first ---

type Focus = "all" | "top1" | "top10" | "top25" | "rising" | "new" | "sleeping"

const FOCUS: { value: Focus; label: string; hint: string; matches: (l: Listing) => boolean }[] = [
  { value: "all", label: "All", hint: "Every analysed listing", matches: () => true },
  { value: "top1", label: TIERS.top1.label, hint: TIERS.top1.hint, matches: (l) => l.rank?.tier === "top1" },
  {
    value: "top10",
    label: TIERS.top10.label,
    hint: TIERS.top10.hint,
    matches: (l) => l.rank?.tier === "top1" || l.rank?.tier === "top10",
  },
  {
    value: "top25",
    label: TIERS.top25.label,
    hint: TIERS.top25.hint,
    matches: (l) => !!l.rank && l.rank.tier !== "rest",
  },
  { value: "rising", label: FLAGS.rising.label, hint: FLAGS.rising.hint, matches: (l) => !!l.rank?.flags.includes("rising") },
  { value: "new", label: FLAGS.new.label, hint: FLAGS.new.hint, matches: (l) => !!l.rank?.flags.includes("new") },
  { value: "sleeping", label: FLAGS.sleeping.label, hint: FLAGS.sleeping.hint, matches: (l) => !!l.rank?.flags.includes("sleeping") },
]

type Layout = "grid" | "table"
const LAYOUT_KEY = "etsy-research:shop-listings-layout"

/** Grid or table, as last picked in this browser. */
function useLayout() {
  const [layout, setLayout] = React.useState<Layout>(() => {
    try {
      return localStorage.getItem(LAYOUT_KEY) === "table" ? "table" : "grid"
    } catch {
      return "grid"
    }
  })
  const change = React.useCallback((next: Layout) => {
    setLayout(next)
    try {
      localStorage.setItem(LAYOUT_KEY, next)
    } catch {
      // Not remembered; the grid opens next time.
    }
  }, [])
  return [layout, change] as const
}

const HIDE_FILED_KEY = "etsy-research:shop-listings-hide-filed"

/** Whether listings already filed into a folder are left out, as last picked in this browser. */
function useHideFiled() {
  const [hide, setHide] = React.useState(() => {
    try {
      return localStorage.getItem(HIDE_FILED_KEY) === "1"
    } catch {
      return false
    }
  })
  const change = React.useCallback((next: boolean) => {
    setHide(next)
    try {
      localStorage.setItem(HIDE_FILED_KEY, next ? "1" : "0")
    } catch {
      // Not remembered; filed listings show next time.
    }
  }, [])
  return [hide, change] as const
}

/** Every listing ranked by `sort`, best first; ties go to estimated sales a month, then revenue. */
export function gallerySort(listings: Listing[], sort: GallerySort) {
  const { by } = SORTS.find((s) => s.value === sort)!
  return listings.toSorted(
    (a, b) =>
      by(b) - by(a) ||
      b.estimate.salesPerMonth - a.estimate.salesPerMonth ||
      b.estimate.revenuePerMonthCents - a.estimate.revenuePerMonthCents
  )
}

function Metric({ value, unit }: { value: string; unit: string }) {
  return (
    <span className="font-medium">
      {value}
      <span className="font-normal text-muted-foreground"> {unit}</span>
    </span>
  )
}

type Ranked = { listing: Listing; rank: number }

// Big photos are heavy; reveal them in steps as the grid scrolls.
const STEP = 36
const PRELOAD_MARGIN = "0px 0px 1200px 0px"

export function ListingGallery({
  listings: all,
  calibration,
  loading,
  sort,
  onSortChange,
}: {
  /** Every analysed listing in gallery order, see `gallerySort`. */
  listings: Listing[]
  calibration: ShopCalibration | null
  loading: boolean
  sort: GallerySort
  onSortChange: (sort: GallerySort) => void
}) {
  const router = useRouter()
  const { select: openDetails } = useListingSelection()
  const [shown, setShown] = React.useState(STEP)
  const [layout, setLayout] = useLayout()
  // Keywords, the focus and hiding what's filed narrow the grid; a tile keeps its rank in the whole shop.
  const [keywords, setKeywords] = React.useState<string[]>([])
  const [focus, setFocus] = React.useState<Focus>("all")
  const [hideFiled, setHideFiled] = useHideFiled()
  const saved = useSaved()
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
  const ranks = React.useMemo(() => new Map(all.map((l, i) => [l.id, i + 1])), [all])
  const filed = React.useMemo(() => all.filter((l) => folderOf.has(l.id)).length, [all, folderOf])
  const tagged = React.useMemo(
    () => withAnyTag(hideFiled ? all.filter((l) => !folderOf.has(l.id)) : all, keywords),
    [all, keywords, hideFiled, folderOf]
  )
  const focusCounts = React.useMemo(
    () => new Map(FOCUS.map((f) => [f.value, tagged.filter(f.matches).length])),
    [tagged]
  )
  const listings = React.useMemo(
    () => tagged.filter(FOCUS.find((f) => f.value === focus)!.matches),
    [tagged, focus]
  )
  const sorts = SORTS.filter((s) => s.value !== "gained" || all.some((l) => l.rank?.favoritesGained))
  const ids = React.useMemo(() => listings.map((l) => l.id), [listings])
  const selection = useSelection(ids)

  // What the open context menu files: the pick, or the tile right-clicked
  // outside it (which becomes the pick, as in Finder).
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [target, setTarget] = React.useState<number[]>([])
  const pending = React.useRef<number[]>([])

  // The steal dialog, mounted afresh for each opening with what it steals.
  const [stealing, setStealing] = React.useState({ open: false, key: 0, listings: [] as Listing[] })

  const metric = SORTS.find((s) => s.value === sort)!.show
  const ranked = React.useMemo(
    () => listings.map((listing) => ({ listing, rank: ranks.get(listing.id) ?? 0 })),
    [listings, ranks]
  )

  // Categories load ahead, so the first search is as instant as the next.
  React.useEffect(() => {
    refreshCategories("saved")
  }, [])

  const more = shown < ranked.length
  // A fresh observer per step reports at once if the sentinel is still in
  // reach (one step can be shorter than the preload margin on wide screens),
  // so the grid keeps filling without waiting for another scroll.
  const sentinel = React.useCallback(
    (node: HTMLElement | null) => {
      if (!node || !more) return
      const observer = new IntersectionObserver(
        ([entry]) => entry.isIntersecting && setShown((n) => Math.max(n, shown + STEP)),
        { root: scrollParent(node), rootMargin: PRELOAD_MARGIN }
      )
      observer.observe(node)
      return () => observer.disconnect()
    },
    [more, shown]
  )

  // The lowest-ranked listing already filed, to carry on searching from there.
  const lastFiled = React.useMemo(
    () => ranked.findLastIndex((r) => folderOf.has(r.listing.id)),
    [ranked, folderOf]
  )
  const [jump, setJump] = React.useState<{ id: number } | null>(null)
  function jumpToLastFiled() {
    if (lastFiled < 0) return
    setShown((n) => Math.max(n, lastFiled + STEP))
    setJump({ id: ranked[lastFiled].listing.id })
  }
  // Runs once the tile is revealed (same render as `shown` grows).
  React.useEffect(() => {
    if (!jump) return
    const tile = document.querySelector<HTMLElement>(`[data-listing-id="${jump.id}"]`)
    tile?.scrollIntoView({ block: "center", behavior: "smooth" })
    tile?.focus({ preventScroll: true })
  }, [jump])

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
        <span className="text-xs text-muted-foreground tabular-nums">
          {listings.length < all.length
            ? `${formatNumber(listings.length)} of ${formatNumber(all.length)} listings`
            : `${formatNumber(all.length)} listings`}
        </span>
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[layout]}
          onValueChange={(value) => value[0] && setLayout(value[0] as Layout)}
          aria-label="Show as"
          className="ml-auto"
        >
          <ToggleGroupItem value="grid" aria-label="Photos" title="Photos">
            <LayoutGridIcon />
          </ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label="Table" title="Table: every number">
            <Rows3Icon />
          </ToggleGroupItem>
        </ToggleGroup>
        <Select
          value={sort}
          items={sorts}
          onValueChange={(value) => {
            if (!value) return
            onSortChange(value as GallerySort)
            setShown(STEP)
          }}
        >
          <SelectTrigger size="sm" className="w-44" aria-label="Rank by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sorts.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {all.some((l) => l.rank) && (
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={1}
          value={[focus]}
          onValueChange={(value) => {
            if (!value[0]) return
            setFocus(value[0] as Focus)
            setShown(STEP)
          }}
          aria-label="Show first"
          className="w-full flex-wrap"
        >
          {FOCUS.filter((f) => f.value === "all" || f.value === focus || focusCounts.get(f.value)).map((f) => (
            <ToggleGroupItem key={f.value} value={f.value} title={f.hint} className="gap-1.5">
              {f.value === "rising" || f.value === "new" || f.value === "sleeping" ? (
                <FlagMarks flags={[f.value]} />
              ) : null}
              {f.label}
              <span className="text-xs text-muted-foreground tabular-nums">{formatNumber(focusCounts.get(f.value) ?? 0)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      {calibration && <CalibrationNote calibration={calibration} />}

      <div className="flex min-h-7 items-center justify-between gap-2 text-xs text-muted-foreground">
        <p className={cn("transition-opacity duration-150", selection.count > 0 && "opacity-0")}>
          {layout === "table"
            ? "Click a row to open it, tick the box to steal it. Hover a number to see how it's worked out"
            : "Click to select, then steal them into categories. Right-click to steal in one go"}
        </p>
        <div className="flex items-center gap-1">
          {(filed > 0 || hideFiled) && (
            <Toggle
              size="sm"
              pressed={hideFiled}
              onPressedChange={(next) => {
                setHideFiled(next)
                setShown(STEP)
              }}
              title={
                hideFiled
                  ? "Showing only listings in no folder yet: click to show the filed ones too"
                  : "Show only listings in no folder yet"
              }
              className="text-muted-foreground aria-pressed:text-foreground"
            >
              <EyeOffIcon />
              Hide filed
              <span className="tabular-nums">{formatNumber(filed)}</span>
            </Toggle>
          )}
          {lastFiled >= 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={jumpToLastFiled}
              title={`Jump to the last listing filed into a category (${folderOf.get(ranked[lastFiled].listing.id)})`}
            >
              <ArrowDownToLineIcon />
              Last filed
              <span className="tabular-nums">#{ranked[lastFiled].rank}</span>
            </Button>
          )}
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
      </div>

      {layout === "table" ? (
        <ListingTable
          listings={ranked.slice(0, shown).map((r) => r.listing)}
          calibration={calibration}
          sort={sort}
          onSort={(next) => {
            onSortChange(next)
            setShown(STEP)
          }}
          isSelected={(id) => selection.has(id)}
          onToggle={(id, range) => selection.toggle(id, { range })}
          onOpen={openDetails}
        />
      ) : (
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
                metric={metric(item.listing)}
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
            of="saved"
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
      )}
      {more && <div ref={sentinel} aria-hidden className="h-px" />}
      {!loading && hideFiled && ranked.length === 0 && filed > 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-3 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {keywords.length || focus !== "all"
              ? "Every listing that matches is filed in a folder already."
              : "Every listing of this shop is filed in a folder already."}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setHideFiled(false)}>
            Show the filed ones
          </Button>
        </div>
      )}

      <SelectionBar
        count={selection.count}
        total={ids.length}
        onSelectAll={selection.selectAll}
        onClear={selection.clear}
      >
        <ShopStyleActions listings={picked(selection.selected)} onDone={selection.clear} />
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
  metric,
  selected,
  selecting,
  onToggle,
  onOpen,
}: {
  item: Ranked
  /** The ranking's number for this listing. */
  metric: React.ReactNode
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
      aria-label={`${listing.title}, number ${rank}`}
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
        {listing.rank && (listing.rank.tier !== "rest" || listing.rank.flags.length > 0) && (
          <span className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-background/90 py-0.5 pr-1.5 pl-0.5 shadow-sm backdrop-blur-sm empty:hidden">
            <TierBadge tier={listing.rank.tier} />
            <FlagMarks flags={listing.rank.flags} />
          </span>
        )}

        {folder && (
          <span className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium shadow-sm backdrop-blur-sm transition-[opacity,transform] duration-200 ease-out-strong starting:scale-95 starting:opacity-0">
            <FolderIcon className="size-3 shrink-0" />
            <span className="truncate">{describeFolder(folder)}</span>
          </span>
        )}
      </span>

      <span className="flex items-baseline gap-2 px-0.5 text-sm tabular-nums">
        <span className="w-6 shrink-0 text-xs text-muted-foreground">{rank}</span>
        {metric}
        <span className="ml-auto text-muted-foreground">
          {formatCurrency(listing.priceCents, listing.currency)}
        </span>
      </span>
    </button>
  )
}

/** What the numbers rest on: the shop's own rates, and the share of its sales these listings made. */
function CalibrationNote({ calibration: c }: { calibration: ShopCalibration }) {
  if (!c.measured.reviewRate) {
    return (
      <p className="text-xs text-pretty text-muted-foreground">
        Estimated with typical rates (9% of buyers leave a review, a sale brings about 10 favorites and 100 views)
        {c.reviewsComplete ? ": the shop hides its sales, so its own can't be measured." : ". Fetch every review to calibrate on this shop."}
      </p>
    )
  }
  return (
    <p className="text-xs text-pretty text-muted-foreground">
      Calibrated on this shop: <strong className="font-medium text-foreground">1 in {Math.round(1 / c.reviewRate)}</strong>{" "}
      buyers leaves a review ({formatPercent(c.reviewRate)}), and a sale brings about{" "}
      <strong className="font-medium text-foreground">{c.favoritesPerSale.toFixed(1)} favorites</strong> and{" "}
      <strong className="font-medium text-foreground">{formatCompact(c.viewsPerSale)} views</strong>.
      {c.coveredShare !== null && (
        <>
          {" "}
          These listings made <strong className="font-medium text-foreground">{formatPercent(c.coveredShare)}</strong> of
          its sales.
        </>
      )}{" "}
      Reviews count as they add up: one barely moves a listing, dozens decide it.
    </p>
  )
}
