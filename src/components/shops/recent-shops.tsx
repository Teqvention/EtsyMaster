"use client"

import Image from "next/image"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import { CheckIcon, ListChecksIcon, StarIcon, StoreIcon, TagIcon, TagsIcon, XIcon } from "lucide-react"

import { SelectionBar } from "@/components/selection"
import { LabelBadges, LabelDialog } from "@/components/shops/shop-labels"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { forgetShop, hasLabel, useShopLabels, type ShopVisit } from "@/hooks/use-shop-history"
import { useSelection } from "@/hooks/use-selection"
import { formatCompact, formatCompactCurrency, formatNumber, formatRate } from "@/lib/etsy/format"
import { timeAgo } from "@/lib/shops/time-ago"
import { cn } from "@/lib/utils"

// Shops opened before, most recent first: one row each, with what the last
// analysis found, so the list doubles as a quick comparison. Shops can be
// filed under labels: chips above the list filter by them (`?label=`), and
// Select picks shops to label in one go.

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
  const [filter, setFilter] = useLabelFilter()
  const shown = React.useMemo(() => visits.filter(filter.matches), [visits, filter])
  const keys = React.useMemo(() => shown.map((v) => v.shop.id), [shown])
  const selection = useSelection(keys)
  const [picking, setPicking] = React.useState(false)
  const [labelling, setLabelling] = React.useState(false)
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
          Recent shops <span className="text-muted-foreground tabular-nums">{visits.length}</span>
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
          <Button variant="outline" size="sm" onClick={() => setPicking(true)} title="Pick shops to label">
            <ListChecksIcon />
            Select
          </Button>
        )}
      </div>

      <LabelFilter visits={visits} filter={filter} onChange={setFilter} />

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          No shops {filter.label === "" ? "without a label" : `labelled “${filter.label}”`}.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div
            className={`hidden items-center gap-x-4 border-b bg-muted/40 py-1.5 pr-11 pl-3 text-[11px] text-muted-foreground uppercase @2xl:grid ${COLUMNS}`}
          >
            <span>Shop</span>
            <span className="hidden text-right @4xl:block">Active</span>
            <span className="text-right">Analysed</span>
            <span className="text-right">Revenue / mo</span>
            <span className="text-right">Sales / mo</span>
            <span className="text-right">Viewed</span>
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
        <Button size="sm" className="active:scale-[0.97]" onClick={() => setLabelling(true)}>
          <TagsIcon />
          Label…
        </Button>
      </SelectionBar>
      <LabelDialog shops={picked} open={labelling && picked.length > 0} onOpenChange={setLabelling} />
    </section>
  )
}

// --- Label filter ---

// Which shops are listed: all (no `?label=`), one label's, or the ones with
// none (`?label=` left empty).
type Filter = { key: string; label: string | null; matches: (visit: ShopVisit) => boolean }

const ALL = "all"
const UNLABELLED = "unlabelled"

function useLabelFilter() {
  const searchParams = useSearchParams()
  const param = searchParams.get("label")
  const filter = React.useMemo<Filter>(() => {
    if (param === null) return { key: ALL, label: null, matches: () => true }
    if (param === "") return { key: UNLABELLED, label: "", matches: (v) => !v.labels?.length }
    return { key: `l:${param.toLowerCase()}`, label: param, matches: (v) => hasLabel(v, param) }
  }, [param])

  const setFilter = React.useCallback((label: string | null) => {
    const params = new URLSearchParams(window.location.search)
    if (label === null) params.delete("label")
    else params.set("label", label)
    const query = params.toString()
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
  }, [])

  return [filter, setFilter] as const
}

function LabelFilter({
  visits,
  filter,
  onChange,
}: {
  visits: ShopVisit[]
  filter: Filter
  onChange: (label: string | null) => void
}) {
  const labels = useShopLabels()
  const unlabelled = visits.filter((v) => !v.labels?.length).length
  // A label nobody carries any more (or a stale link) still shows while picked.
  const missing = filter.label && !labels.some((l) => l.name.toLowerCase() === filter.label!.toLowerCase())

  if (labels.length === 0 && !missing) return null

  const chips = [
    { key: ALL, label: "All", count: visits.length, value: null },
    ...labels.map((l) => ({ key: `l:${l.name.toLowerCase()}`, label: l.name, count: l.count, value: l.name })),
    ...(missing ? [{ key: filter.key, label: filter.label!, count: 0, value: filter.label }] : []),
    ...(unlabelled > 0 ? [{ key: UNLABELLED, label: "Unlabelled", count: unlabelled, value: "" }] : []),
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
      aria-label="Label"
      className="w-full flex-wrap"
    >
      {chips.map((chip) => (
        <ToggleGroupItem key={chip.key} value={chip.key} className="gap-1.5">
          {chip.key !== ALL && chip.key !== UNLABELLED && <TagIcon />}
          {chip.label}
          <span className="text-xs text-muted-foreground tabular-nums">{chip.count}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
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
          "grid w-full items-center gap-x-4 py-2 pr-11 pl-3 text-left text-xs tabular-nums transition-[background-color] duration-150 ease-out focus-visible:bg-muted/60 focus-visible:outline-none [@media(hover:hover)]:hover:bg-muted/60",
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
              {visit.labels && <LabelBadges labels={visit.labels} />}
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
      {!selecting && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${shop.name} from recent shops`}
          title={visit.labels?.length ? "Labelled shops stay in the list until removed" : undefined}
          onClick={() => forgetShop(shop.id)}
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground transition-opacity duration-150 ease-out [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
        >
          <XIcon />
        </Button>
      )}
    </li>
  )
}

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
