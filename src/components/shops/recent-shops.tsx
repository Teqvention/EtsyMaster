"use client"

import Image from "next/image"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import {
  ArrowDownIcon,
  ArrowDownWideNarrowIcon,
  ArrowUpIcon,
  ArrowUpNarrowWideIcon,
  CheckIcon,
  DownloadIcon,
  HeartIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  SearchIcon,
  SquareIcon,
  StarIcon,
  StoreIcon,
  TagsIcon,
  XIcon,
} from "lucide-react"

import { SelectionBar } from "@/components/selection"
import { GetAllListingsPopover } from "@/components/shops/get-all-listings"
import { ShopTagIconButton, TagDialog } from "@/components/shops/shop-tags"
import { matchesTagView, TagFilterChips, type TagView } from "@/components/tags/tag-filter-chips"
import { TagBadges } from "@/components/tags/tag-picker"
import { ShopLikeButton } from "@/components/shops/shop-like"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Toggle } from "@/components/ui/toggle"
import { hasAllListings, stopBatch, useBatch } from "@/hooks/use-shop-analysis"
import { forgetShop, tagsOf, type ShopVisit } from "@/hooks/use-shop-history"
import { useAccounts } from "@/hooks/use-accounts"
import { useSelection } from "@/hooks/use-selection"
import { formatCompact, formatCompactCurrency, formatNumber, formatRate } from "@/lib/etsy/format"
import { timeAgo } from "@/lib/shops/time-ago"
import { cn } from "@/lib/utils"

// Shops opened before, most recent first: one row each, with what the last
// analysis found, so the list doubles as a quick comparison. The column heads
// (or the sort menu, where they're hidden) reorder it, and the bar above
// narrows it by name, liked, country, analysis and sales. Shops can be liked
// and tagged from their row (primary tags, secondary tags under each): the
// chips filter by primary tag and then by secondary tag, and Select picks
// shops to tag in one go. All but the search live in the URL
// (`?tag=&sub=&liked&country=&status=&sales=&sort=`).

const COLUMNS =
  "grid-cols-[minmax(0,1fr)_auto] @2xl:grid-cols-[minmax(0,1fr)_7rem_6rem_5rem_4.5rem] @4xl:grid-cols-[minmax(0,1fr)_5.5rem_7rem_6rem_5rem_4.5rem]"

export function RecentShops({
  visits,
  currency,
  onPick,
}: {
  visits: ShopVisit[]
  currency: string
  onPick: (shop: string) => void
}) {
  const now = useNow()
  const [searchParams, setParams] = useParams()
  // The name search outlives a visit to a shop, as the filters in the address do.
  const [search, setSearchState] = React.useState(() => lastSearch)
  const setSearch = (next: string) => {
    lastSearch = next
    setSearchState(next)
  }
  const view = React.useMemo(() => tagView(searchParams.get("tag"), searchParams.get("sub")), [searchParams])
  const filters = React.useMemo(() => readFilters(searchParams), [searchParams])
  const sort = React.useMemo(() => parseSort(searchParams.get("sort")), [searchParams])
  const shown = React.useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return sortVisits(visits.filter((v) => matchesTagView(tagsOf(v), view) && matchesFilters(v, filters, words)), sort)
  }, [visits, view, filters, search, sort])
  const items = React.useMemo(() => visits.map(tagsOf), [visits])
  const filtering = view.primary !== null || search.trim() !== "" || hasFilters(filters)

  function clearFilters() {
    setSearch("")
    setParams({ tag: null, sub: null, ...NO_FILTER_PARAMS })
  }

  function toggleSort(key: SortKey) {
    setSort(sort.key === key ? { key, desc: !sort.desc } : { key, desc: SORT_BY[key].desc })
  }

  function setSort(next: Sort) {
    setParams({ sort: sortParam(next) })
  }
  const keys = React.useMemo(() => shown.map((v) => v.shop.id), [shown])
  const selection = useSelection(keys)
  const [picking, setPicking] = React.useState(false)
  const [tagging, setTagging] = React.useState(false)
  // ⌘A picks too, so the checkboxes follow the selection, not just the button.
  const selecting = picking || selection.count > 0
  const picked = shown.filter((v) => selection.has(v.shop.id)).map((v) => v.shop)

  function stopPicking() {
    setPicking(false)
    selection.clear()
  }

  // Escape with nothing picked leaves select mode (with something picked,
  // the selection's own Escape lets go of it first).
  React.useEffect(() => {
    if (!picking || selection.count > 0) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setPicking(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [picking, selection.count])

  return (
    <section aria-labelledby="recent-shops" className="@container flex flex-col gap-2">
      <div className="flex min-h-7 items-center gap-2">
        <h2 id="recent-shops" className="mr-auto text-sm font-medium">
          Recent shops{" "}
          <span className="text-muted-foreground tabular-nums" aria-live="polite">
            {shown.length !== visits.length && `${formatNumber(shown.length)} of `}
            {formatNumber(visits.length)}
          </span>
        </h2>
        {selecting ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={selection.count === shown.length ? selection.clear : selection.selectAll}
            >
              {selection.count === shown.length && shown.length > 0 ? "Deselect all" : "Select all"}
            </Button>
            <Button variant="outline" size="sm" onClick={stopPicking}>
              <CheckIcon />
              Done
            </Button>
          </>
        ) : (
          <>
            <GetAllListingsButton visits={shown} />
            <Button variant="outline" size="sm" onClick={() => setPicking(true)} title="Pick shops to tag or get listings of">
              <ListChecksIcon />
              Select
            </Button>
          </>
        )}
      </div>

      <FilterBar
        visits={visits}
        search={search}
        onSearch={setSearch}
        filters={filters}
        onFilter={(change) => setParams(filterParams({ ...filters, ...change }))}
        sort={sort}
        onSort={setSort}
        onClear={filtering ? clearFilters : undefined}
      />

      <TagFilterChips items={items} view={view} onChange={({ primary, secondary }) => setParams({ tag: primary, sub: secondary })} />

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-3 py-8 text-center">
          <p className="text-sm text-muted-foreground">No shop matches these filters.</p>
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear the filters
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div
            className={`hidden items-center gap-x-4 border-b bg-muted/40 py-1.5 pr-24 pl-3 text-[11px] text-muted-foreground uppercase @2xl:grid ${COLUMNS}`}
          >
            <SortHead column="name" label="Shop" sort={sort} onSort={toggleSort} />
            <SortHead column="active" label="Active" sort={sort} onSort={toggleSort} end className="hidden @4xl:flex" />
            <SortHead column="analysed" label="Analysed" sort={sort} onSort={toggleSort} end />
            <SortHead column="revenue" label="Revenue / mo" sort={sort} onSort={toggleSort} end />
            <SortHead column="sales" label="Sales / mo" sort={sort} onSort={toggleSort} end />
            <SortHead column="viewed" label="Viewed" sort={sort} onSort={toggleSort} end />
          </div>
          <ul className="divide-y">
            {shown.map((visit) => (
              <ShopRow
                key={visit.shop.id}
                visit={visit}
                now={now}
                currency={currency}
                selecting={selecting}
                selected={selection.has(visit.shop.id)}
                onPick={(event) =>
                  selecting
                    ? selection.toggle(visit.shop.id, { range: event.shiftKey })
                    : onPick(visit.shop.name)
                }
              />
            ))}
          </ul>
        </div>
      )}

      <SelectionBar
        count={selection.count}
        total={shown.length}
        onSelectAll={selection.selectAll}
        onClear={selection.clear}
      >
        <GetAllListingsPopover shops={picked} side="top" align="start">
          <Button variant="outline" size="sm" className="data-popup-open:bg-muted active:scale-[0.97]">
            <DownloadIcon />
            Get all listings…
          </Button>
        </GetAllListingsPopover>
        <Button size="sm" className="active:scale-[0.97]" onClick={() => setTagging(true)}>
          <TagsIcon />
          Tag…
        </Button>
      </SelectionBar>
      <TagDialog shops={picked} open={tagging && picked.length > 0} onOpenChange={setTagging} />
    </section>
  )
}

// --- Get all listings ---

// The listings the shops listed don't have yet, with the accounts picked in
// its popover; while that runs, how far it got and a way to stop it.
function GetAllListingsButton({ visits }: { visits: ShopVisit[] }) {
  const batch = useBatch()
  const accounts = useAccounts()
  if (batch) {
    const using = batch.accounts
      ?.map((id) => accounts?.accounts.find((a) => a.id === id)?.label ?? id)
      .join(", ")
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={stopBatch}
        title={`Fetching ${batch.current.map((s) => s.name).join(", ")} with ${using ?? "the analysis accounts"} · click to stop`}
      >
        <LoaderCircleIcon className="animate-spin" />
        <span className="tabular-nums">
          {formatNumber(batch.done)} / {formatNumber(batch.total)}
        </span>
        <SquareIcon className="fill-current" />
      </Button>
    )
  }
  return (
    <GetAllListingsPopover shops={visits.map((v) => v.shop)}>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground data-popup-open:bg-muted"
        disabled={visits.length === 0}
      >
        <DownloadIcon />
        Get all listings
      </Button>
    </GetAllListingsPopover>
  )
}

/** The name typed into the list's search, kept while a shop is open. */
let lastSearch = ""

/**
 * The list view an address's search params (`?tag=City&liked&sort=…`) stand
 * for, in words, for the way back to it: "City › Cartoon", "Liked", "DE"…
 */
export function describeListView(search: string): string[] {
  const params = new URLSearchParams(search)
  const tag = params.get("tag")
  const sub = params.get("sub")
  const f = readFilters(params)
  const sort = params.get("sort")
  return [
    tag === "" ? "Untagged" : tag && (sub === null ? tag : `${tag} › ${sub === "" ? "No secondary tag" : sub}`),
    f.liked && "Liked",
    f.country !== "all" && countryName(f.country),
    f.status !== "all" && STATUSES[f.status].label,
    f.sales > 0 && `${formatNumber(f.sales)}+ sales / mo`,
    sort && `Sorted by ${SORT_BY[parseSort(sort).key].label.toLowerCase()}`,
    lastSearch.trim() && `“${lastSearch.trim()}”`,
  ].filter((part): part is string => !!part)
}

/** Search params kept in the address, so a reload or link lands on the same view. */
function useParams() {
  const searchParams = useSearchParams()
  const set = React.useCallback((changes: Record<string, string | null>) => {
    const params = new URLSearchParams(window.location.search)
    for (const [name, value] of Object.entries(changes)) {
      if (value === null) params.delete(name)
      else params.set(name, value)
    }
    const query = params.toString()
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
  }, [])
  return [searchParams, set] as const
}

// --- Sort ---

type SortKey = "viewed" | "sales" | "revenue" | "sold" | "rating" | "active" | "analysed" | "name"
type Sort = { key: SortKey; desc: boolean }

// What each order goes by, and which way it runs first: biggest numbers on
// top, names A–Z. Shops without the number (not analysed yet, sales hidden,
// no reviews) go last whichever way it runs.
const SORT_BY: Record<SortKey, { label: string; desc: boolean; value: (v: ShopVisit) => number | string | null }> = {
  viewed: { label: "Recently viewed", desc: true, value: (v) => v.viewedAt },
  sales: { label: "Sales / mo", desc: true, value: (v) => v.analysis?.salesPerMonth ?? null },
  revenue: { label: "Revenue / mo", desc: true, value: (v) => v.analysis?.revenuePerMonthCents ?? null },
  sold: { label: "Lifetime sales", desc: true, value: (v) => v.shop.totalSales || null },
  rating: { label: "Rating", desc: true, value: (v) => (v.shop.reviewCount > 0 ? v.shop.reviewAverage : null) },
  active: { label: "Active listings", desc: true, value: (v) => v.shop.activeListings },
  analysed: {
    label: "Share analysed",
    desc: true,
    value: (v) => (v.analysis ? v.analysis.listings / Math.max(v.shop.activeListings, 1) : null),
  },
  name: { label: "Name", desc: false, value: (v) => v.shop.name.toLowerCase() },
}
const SORT_KEYS = Object.keys(SORT_BY) as SortKey[]
const DEFAULT_SORT: Sort = { key: "viewed", desc: true }

// `?sort=sales` runs the key's own way, `?sort=sales.asc` the other.
function parseSort(param: string | null): Sort {
  const [key, dir] = (param ?? "").split(".")
  if (!Object.hasOwn(SORT_BY, key)) return DEFAULT_SORT
  const k = key as SortKey
  return { key: k, desc: dir === "asc" ? false : dir === "desc" ? true : SORT_BY[k].desc }
}

function sortParam(sort: Sort) {
  if (sort.key === DEFAULT_SORT.key && sort.desc === DEFAULT_SORT.desc) return null
  return sort.desc === SORT_BY[sort.key].desc ? sort.key : `${sort.key}.${sort.desc ? "desc" : "asc"}`
}

function sortVisits(visits: ShopVisit[], sort: Sort) {
  const value = SORT_BY[sort.key].value
  const dir = sort.desc ? -1 : 1
  return visits.toSorted((a, b) => {
    const x = value(a)
    const y = value(b)
    const by =
      x === null || y === null
        ? Number(x === null) - Number(y === null)
        : dir * (typeof x === "string" ? x.localeCompare(y as string) : x - (y as number))
    return by || b.viewedAt.localeCompare(a.viewedAt)
  })
}

function orderLabel(sort: Sort) {
  if (sort.key === "name") return sort.desc ? "Z–A" : "A–Z"
  if (sort.key === "viewed") return sort.desc ? "Newest first" : "Oldest first"
  return sort.desc ? "Highest first" : "Lowest first"
}

// A column head that sorts by its column; again turns the order round.
function SortHead({
  column,
  label,
  sort,
  onSort,
  end,
  className,
}: {
  column: SortKey
  label: string
  sort: Sort
  onSort: (key: SortKey) => void
  /** Right-aligned column: the arrow goes before the label so the text lines up with the numbers. */
  end?: boolean
  className?: string
}) {
  const active = sort.key === column
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      title={active ? `${orderLabel(sort)} · click to reverse` : `Sort by ${SORT_BY[column].label.toLowerCase()}`}
      className={cn(
        "flex items-center gap-0.5 rounded uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:text-foreground",
        end && "flex-row-reverse justify-self-end",
        active && "text-foreground",
        className
      )}
    >
      {label}
      <span className="grid size-3 place-items-center">
        {active && (sort.desc ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" />)}
      </span>
      {active && <span className="sr-only">, {orderLabel(sort)}</span>}
    </button>
  )
}

// The same orders as the column heads and a few more, for when the heads are
// hidden on a narrow page or the number isn't a column (lifetime sales, rating).
function SortMenu({ sort, onSort }: { sort: Sort; onSort: (sort: Sort) => void }) {
  const items = SORT_KEYS.map((key) => ({ value: key, label: SORT_BY[key].label }))
  return (
    <div className="flex items-center gap-1">
      <Select
        value={sort.key}
        items={items}
        onValueChange={(key) => key && onSort({ key: key as SortKey, desc: SORT_BY[key as SortKey].desc })}
      >
        <SelectTrigger size="sm" aria-label="Sort by">
          <span className="text-muted-foreground">Sort</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => onSort({ ...sort, desc: !sort.desc })}
        aria-label={`${orderLabel(sort)}, reverse the order`}
        title={`${orderLabel(sort)} · click to reverse`}
      >
        {sort.desc ? <ArrowDownWideNarrowIcon /> : <ArrowUpNarrowWideIcon />}
      </Button>
    </div>
  )
}

// --- Filters ---

type Status = "all" | "analysed" | "partial" | "none"
type Filters = { country: string; status: Status; sales: number; liked: boolean }

const NO_FILTERS: Filters = { country: "all", status: "all", sales: 0, liked: false }

const STATUSES: Record<Status, { label: string; matches: (v: ShopVisit) => boolean }> = {
  all: { label: "Any analysis", matches: () => true },
  analysed: { label: "Analysed", matches: (v) => !!v.analysis },
  // Stopped part way, or more listings than it covered: the ones "Get all listings" would add to.
  partial: {
    label: "Partly analysed",
    matches: (v) => !!v.analysis && !hasAllListings(v.analysis, v.shop.activeListings),
  },
  none: { label: "Not analysed", matches: (v) => !v.analysis },
}
const STATUS_KEYS = Object.keys(STATUSES) as Status[]

/** Sales a month a shop has to reach to stay listed. */
const MIN_SALES = [10, 50, 100, 250, 500]

function readFilters(params: URLSearchParams): Filters {
  const status = params.get("status") ?? ""
  const sales = Number(params.get("sales"))
  return {
    country: params.get("country") || "all",
    status: Object.hasOwn(STATUSES, status) ? (status as Status) : "all",
    sales: Number.isFinite(sales) && sales > 0 ? sales : 0,
    liked: params.has("liked"),
  }
}

function filterParams(f: Filters) {
  return {
    country: f.country === "all" ? null : f.country,
    status: f.status === "all" ? null : f.status,
    sales: f.sales > 0 ? String(f.sales) : null,
    liked: f.liked ? "" : null,
  }
}

const NO_FILTER_PARAMS = filterParams(NO_FILTERS)

function hasFilters(f: Filters) {
  return f.country !== "all" || f.status !== "all" || f.sales > 0 || f.liked
}

function matchesFilters(v: ShopVisit, f: Filters, words: string[]) {
  if (f.liked && !v.likedAt) return false
  if (f.country !== "all" && (v.shop.country ?? NO_COUNTRY) !== f.country) return false
  if (!STATUSES[f.status].matches(v)) return false
  if (f.sales > 0 && (v.analysis?.salesPerMonth ?? 0) < f.sales) return false
  const name = v.shop.name.toLowerCase()
  return words.every((w) => name.includes(w))
}

const NO_COUNTRY = "none"
const regions = new Intl.DisplayNames(["en-US"], { type: "region" })

function countryName(code: string) {
  if (code === NO_COUNTRY) return "No country"
  try {
    return regions.of(code) ?? code
  } catch {
    return code
  }
}

function FilterBar({
  visits,
  search,
  onSearch,
  filters,
  onFilter,
  sort,
  onSort,
  onClear,
}: {
  visits: ShopVisit[]
  search: string
  onSearch: (search: string) => void
  filters: Filters
  onFilter: (change: Partial<Filters>) => void
  sort: Sort
  onSort: (sort: Sort) => void
  /** Only while something is filtered. */
  onClear?: () => void
}) {
  const countries = new Map<string, number>()
  for (const v of visits) {
    const code = v.shop.country ?? NO_COUNTRY
    countries.set(code, (countries.get(code) ?? 0) + 1)
  }
  // A country or threshold from a link that no shop matches any more still shows while picked.
  if (filters.country !== "all" && !countries.has(filters.country)) countries.set(filters.country, 0)
  const countryItems = [
    { value: "all", label: "Every country" },
    ...[...countries]
      .sort((a, b) => b[1] - a[1] || countryName(a[0]).localeCompare(countryName(b[0])))
      .map(([code, count]) => ({ value: code, label: `${countryName(code)} (${formatNumber(count)})` })),
  ]
  const statusItems = STATUS_KEYS.map((status) => ({
    value: status,
    label:
      status === "all"
        ? STATUSES[status].label
        : `${STATUSES[status].label} (${formatNumber(visits.filter(STATUSES[status].matches).length)})`,
  }))
  const thresholds = filters.sales && !MIN_SALES.includes(filters.sales) ? [...MIN_SALES, filters.sales].sort((a, b) => a - b) : MIN_SALES
  const salesItems = [
    { value: "all", label: "Any sales / mo" },
    ...thresholds.map((min) => ({
      value: String(min),
      label: `${formatNumber(min)}+ sales / mo (${formatNumber(visits.filter((v) => (v.analysis?.salesPerMonth ?? 0) >= min).length)})`,
    })),
  ]
  const liked = visits.filter((v) => v.likedAt).length

  return (
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup className="w-full max-w-64 sm:w-56">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && search) {
              event.stopPropagation()
              onSearch("")
            }
          }}
          placeholder="Search shops"
          aria-label="Search recent shops"
          autoComplete="off"
          spellCheck={false}
        />
        {search && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" aria-label="Clear the search" onClick={() => onSearch("")}>
              <XIcon />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>

      {(liked > 0 || filters.liked) && (
        <Toggle
          variant="outline"
          size="sm"
          pressed={filters.liked}
          onPressedChange={(pressed) => onFilter({ liked: pressed })}
          className="gap-1.5 aria-pressed:border-brand/50 aria-pressed:bg-brand/5"
        >
          <HeartIcon className={cn("transition-[fill,color] duration-150 ease-out", filters.liked && "fill-like text-like")} />
          Liked
          <span className="text-xs text-muted-foreground tabular-nums">{formatNumber(liked)}</span>
        </Toggle>
      )}
      <FilterSelect value={filters.country} items={countryItems} label="Country" onChange={(country) => onFilter({ country })} />
      <FilterSelect
        value={filters.status}
        items={statusItems}
        label="Analysis"
        onChange={(status) => onFilter({ status: status as Status })}
      />
      <FilterSelect
        value={filters.sales ? String(filters.sales) : "all"}
        items={salesItems}
        label="Sales a month"
        onChange={(value) => onFilter({ sales: value === "all" ? 0 : Number(value) })}
      />
      {onClear && (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onClear}>
          Clear
        </Button>
      )}

      <div className="ml-auto">
        <SortMenu sort={sort} onSort={onSort} />
      </div>
    </div>
  )
}

function FilterSelect({
  value,
  items,
  label,
  onChange,
}: {
  value: string
  items: { value: string; label: string }[]
  label: string
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} items={items} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger size="sm" className={cn("max-w-48", value !== "all" && "border-brand/50 bg-brand/5")} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// --- Tag filter ---

// Which shops are listed by tag lives in `?tag=` and `&sub=` (see `TagView`):
// no `tag` for all, `tag` left empty for the untagged ones, `sub` left empty
// for those with no secondary tag under it.
function tagView(primary: string | null, secondary: string | null): TagView {
  return { primary, secondary: primary ? secondary : null }
}

function ShopRow({
  visit,
  now,
  currency,
  selecting,
  selected,
  onPick,
}: {
  visit: ShopVisit
  now: number
  currency: string
  selecting: boolean
  selected: boolean
  onPick: (event: React.MouseEvent) => void
}) {
  const { shop, analysis } = visit
  const coverage = analysis
    ? analysis.listings >= shop.activeListings
      ? "All"
      : `${formatCompact(analysis.listings)} of ${formatCompact(shop.activeListings)}`
    : null

  return (
    <li className="group/row relative">
      <button
        type="button"
        onClick={onPick}
        // Shift-click picks a run of rows; keep the browser from selecting text.
        onMouseDown={(event) => selecting && event.shiftKey && event.preventDefault()}
        aria-pressed={selecting ? selected : undefined}
        className={cn(
          "grid w-full items-center gap-x-4 py-2 pr-24 pl-3 text-left text-xs tabular-nums transition-[background-color] duration-150 ease-out focus-visible:bg-muted/60 focus-visible:outline-none [@media(hover:hover)]:hover:bg-muted/60",
          selected && "bg-brand/8 [@media(hover:hover)]:hover:bg-brand/12",
          COLUMNS
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">
            {shop.iconUrl ? (
              <Image src={shop.iconUrl} alt="" fill unoptimized sizes="36px" className="object-cover" />
            ) : (
              <StoreIcon className="size-4 text-muted-foreground" />
            )}
            {/* The check sits over the icon, so picking never moves the row. */}
            <span
              aria-hidden
              className={cn(
                "absolute inset-0 grid place-items-center transition-[opacity,background-color] duration-150 ease-out-strong",
                !selecting && "opacity-0",
                selected ? "bg-brand text-white" : "bg-background/70"
              )}
            >
              <span
                className={cn(
                  "grid size-4 place-items-center rounded-full border-[1.5px] transition-transform duration-150 ease-out-strong",
                  selected ? "scale-100 border-white" : "scale-90 border-foreground/40"
                )}
              >
                {selected && <CheckIcon className="size-2.5" strokeWidth={3.5} />}
              </span>
            </span>
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-medium">{shop.name}</span>
              <TagBadges tags={tagsOf(visit)} />
            </span>
            <span className="flex items-center gap-2 text-muted-foreground">
              {shop.country && <span>{shop.country}</span>}
              {shop.reviewCount > 0 && (
                <span className="flex items-center gap-0.5">
                  <StarIcon className="size-3 fill-current" />
                  {shop.reviewAverage.toFixed(2)}
                </span>
              )}
              <span>{shop.totalSales ? `${formatCompact(shop.totalSales)} sold` : "Sales hidden"}</span>
            </span>
          </span>
          {analysis && analysis.top.length > 0 && <TopThumbs top={analysis.top} />}
        </span>

        <span className="hidden text-right @4xl:block">{formatNumber(shop.activeListings)}</span>
        <span className="hidden text-right @2xl:block">
          {coverage ? (
            <>
              {coverage}
              {!analysis!.complete && <span className="text-muted-foreground"> · partial</span>}
            </>
          ) : (
            <span className="text-muted-foreground">Not yet</span>
          )}
        </span>
        <span className="hidden text-right font-medium @2xl:block">
          {analysis ? `≈ ${formatCompactCurrency(analysis.revenuePerMonthCents, currency)}` : "—"}
        </span>
        <span className="hidden text-right @2xl:block">
          {analysis ? formatRate(analysis.salesPerMonth, true) : "—"}
        </span>
        <span className="flex flex-col items-end text-muted-foreground">
          {/* Narrow rows drop the columns; keep the headline number. */}
          {analysis && (
            <span className="font-medium text-foreground @2xl:hidden">
              ≈ {formatCompactCurrency(analysis.revenuePerMonthCents, currency)}/mo
            </span>
          )}
          <span className="first-letter:uppercase">
            {timeAgo(visit.analysis?.analysedAt ?? visit.viewedAt, now)}
          </span>
        </span>
      </button>
      {/* The heart stays put while liked; the rest show on hover. */}
      <span className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-0.5">
        {!selecting && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${shop.name} from recent shops`}
              title={
                visit.tag || visit.likedAt
                  ? "Tagged and liked shops stay in the list until removed"
                  : undefined
              }
              onClick={() => forgetShop(shop.id)}
              className={cn("text-muted-foreground", ON_HOVER)}
            >
              <XIcon />
            </Button>
            <ShopTagIconButton shop={shop} className={ON_HOVER} />
          </>
        )}
        <ShopLikeButton shop={shop} className={cn(!visit.likedAt && ON_HOVER)} />
      </span>
    </li>
  )
}

// Row actions that only show on hover or focus (always on touch screens), and
// while their popover is open.
const ON_HOVER =
  "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 data-popup-open:opacity-100"

// The shop's best sellers at a glance; overlapping keeps the row short.
function TopThumbs({ top }: { top: { title: string; thumb: string | null }[] }) {
  return (
    <span className="ml-auto hidden shrink-0 -space-x-2 @lg:flex" aria-hidden>
      {top.map((item, i) =>
        item.thumb ? (
          <span
            key={i}
            className="relative size-7 overflow-hidden rounded-md border-2 border-background bg-muted"
          >
            <Image src={item.thumb} alt="" fill unoptimized sizes="28px" className="object-cover" />
          </span>
        ) : null
      )}
    </span>
  )
}

// Ticks once a minute so "5m ago" doesn't go stale while the page sits open.
export function useNow() {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}
