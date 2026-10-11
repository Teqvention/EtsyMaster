"use client"

import Image from "next/image"
import { ArrowDownIcon, CheckIcon } from "lucide-react"

import { explainEstimate, FlagMarks, TierBadge, TrendMark } from "@/components/shops/rank-badges"
import type { ShopCalibration } from "@/lib/etsy/calibrate"
import { formatCompact, formatCompactCurrency, formatCurrency, formatNumber, formatRate } from "@/lib/etsy/format"
import type { Listing } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

import type { GallerySort } from "./listing-gallery"

// A shop's listings as rows of numbers: everything the ranking is made of,
// side by side, to read and to sort by. Its order and selection are the
// gallery's; a click on a row opens the listing, the box picks it.

type Column = {
  key: string
  label: string
  /** The sort its head switches to. */
  sort?: GallerySort
  /** Hidden on narrower containers. */
  className?: string
  hint: string
}

const COLUMNS: Column[] = [
  { key: "sales", label: "Sales / mo", sort: "sales", hint: "Estimated sales a month over the last 12 months: what the rank goes by" },
  { key: "trend", label: "Trend", sort: "trend", className: "hidden @3xl:table-cell", hint: "The last 90 days' pace against the last 12 months'" },
  { key: "lifetime", label: "Sold", sort: "lifetime", hint: "Estimated sales since it was listed; hover a number for how it's worked out" },
  { key: "reviews", label: "Reviews", sort: "reviews", className: "hidden @2xl:table-cell", hint: "Reviews of all time · in the last 12 months" },
  { key: "favorites", label: "Favorites", sort: "favorites", className: "hidden @2xl:table-cell", hint: "Favorites of all time · a month since it was listed" },
  { key: "views", label: "Views", sort: "views", className: "hidden @5xl:table-cell", hint: "Listing views of all time" },
  { key: "revenue", label: "Revenue / mo", sort: "revenue", className: "hidden @4xl:table-cell", hint: "Sales a month over the last 12 months × today's price" },
  { key: "price", label: "Price", sort: "price", className: "hidden @5xl:table-cell", hint: "Today's price" },
  { key: "age", label: "Age", sort: "newest", className: "hidden @4xl:table-cell", hint: "Since it was first listed" },
]

export function ListingTable({
  listings,
  calibration,
  sort,
  onSort,
  isSelected,
  onToggle,
  onOpen,
}: {
  listings: Listing[]
  calibration: ShopCalibration | null
  sort: GallerySort
  onSort: (sort: GallerySort) => void
  isSelected: (id: number) => boolean
  onToggle: (id: number, range: boolean) => void
  onOpen: (listing: Listing) => void
}) {
  const gained = listings.some((l) => l.rank?.favoritesGained)
  return (
    <div className="@container overflow-hidden rounded-lg border">
      <table className="w-full table-fixed text-xs tabular-nums">
        <thead className="border-b bg-muted/40 text-[11px] text-muted-foreground uppercase">
          <tr>
            <th scope="col" className="w-8 px-2 py-2">
              <span className="sr-only">Pick</span>
            </th>
            <th scope="col" className="w-10 py-2 text-left font-medium">
              #
            </th>
            <th scope="col" className="py-2 pr-3 text-left font-medium">
              Listing
            </th>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={column.sort === sort ? "descending" : undefined}
                className={cn("w-[5.5rem] px-2 py-2 text-right font-medium", column.key === "favorites" && "w-28", column.className)}
              >
                <button
                  type="button"
                  title={column.hint}
                  onClick={() => column.sort && onSort(column.sort)}
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-sm uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:text-foreground",
                    column.sort === sort && "text-foreground"
                  )}
                >
                  {column.sort === sort && <ArrowDownIcon className="size-3" />}
                  {column.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {listings.map((listing, index) => (
            <Row
              key={listing.id}
              listing={listing}
              order={index + 1}
              calibration={calibration}
              gained={gained}
              selected={isSelected(listing.id)}
              onToggle={(range) => onToggle(listing.id, range)}
              onOpen={() => onOpen(listing)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

const DAY = 30

function Row({
  listing: l,
  order,
  calibration,
  gained,
  selected,
  onToggle,
  onOpen,
}: {
  listing: Listing
  order: number
  calibration: ShopCalibration | null
  gained: boolean
  selected: boolean
  onToggle: (range: boolean) => void
  onOpen: () => void
}) {
  const { estimate, rank } = l
  const perMonth = l.favorites / (Math.max(l.ageDays, DAY) / DAY)
  return (
    <tr
      onClick={onOpen}
      data-listing-id={l.id}
      className={cn(
        "cursor-pointer transition-colors duration-150 [@media(hover:hover)]:hover:bg-muted/50",
        selected && "bg-brand/8 [@media(hover:hover)]:hover:bg-brand/12"
      )}
    >
      <td className="px-2 py-1.5 align-middle">
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`Pick ${l.title}`}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(event.shiftKey)
          }}
          className={cn(
            "grid size-4 place-items-center rounded-[4px] border outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            selected ? "border-brand bg-brand text-white" : "border-input"
          )}
        >
          {selected && <CheckIcon className="size-3" strokeWidth={3} />}
        </button>
      </td>
      <td className="py-1.5 align-middle text-muted-foreground" title={rank ? `Rank #${rank.position} of ${formatNumber(rank.of)} in the shop` : undefined}>
        {rank?.position ?? order}
      </td>
      <td className="py-1.5 pr-3 align-middle">
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className="relative size-9 shrink-0 overflow-hidden rounded bg-muted"
            style={l.color ? { backgroundColor: l.color } : undefined}
          >
            {l.images[0] && <Image src={l.images[0].thumb} alt="" fill unoptimized sizes="36px" className="object-cover" />}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <button
              type="button"
              title={l.title}
              onClick={(event) => {
                event.stopPropagation()
                onOpen()
              }}
              className="truncate rounded-sm text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {l.title}
            </button>
            <span className="flex min-h-4.5 items-center gap-1.5">
              {rank && <TierBadge tier={rank.tier} />}
              {rank && <FlagMarks flags={rank.flags} labels />}
            </span>
          </span>
        </span>
      </td>
      <td className="px-2 py-1.5 text-right align-middle font-semibold" title={rank ? `≈ ${formatNumber(rank.recentSales)} sales in the last 12 months` : undefined}>
        {formatRate(estimate.salesPerMonth, true)}
      </td>
      <td className="hidden px-2 py-1.5 text-right align-middle @3xl:table-cell">
        <TrendMark rank={rank} className="justify-end" />
      </td>
      <td className="px-2 py-1.5 text-right align-middle" title={explainEstimate(l, calibration)}>
        <span className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
          {formatCompact(estimate.sales)}
        </span>
      </td>
      <td className="hidden px-2 py-1.5 text-right align-middle @2xl:table-cell">
        {rank ? (
          <>
            {formatNumber(rank.reviews.all)}
            <span className="text-muted-foreground"> · {formatNumber(rank.reviews.year)}</span>
          </>
        ) : (
          <span className="text-muted-foreground">{l.reviewCount ?? "—"}</span>
        )}
      </td>
      <td className="hidden px-2 py-1.5 text-right align-middle @2xl:table-cell">
        <span className="flex flex-col items-end leading-tight">
          <span>
            {formatCompact(l.favorites)}
            <span className="text-muted-foreground"> · {formatRate(perMonth)}/mo</span>
          </span>
          {gained && rank?.favoritesGained && (
            <span
              className={cn("text-[10px]", rank.favoritesGained.count > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}
              title={`Since the analysis of ${new Date(rank.favoritesGained.since).toLocaleDateString()}`}
            >
              +{formatNumber(rank.favoritesGained.count)} since
            </span>
          )}
        </span>
      </td>
      <td className="hidden px-2 py-1.5 text-right align-middle @5xl:table-cell">
        {l.views > 0 ? formatCompact(l.views) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="hidden px-2 py-1.5 text-right align-middle @4xl:table-cell">
        {formatCompactCurrency(estimate.revenuePerMonthCents, l.currency)}
      </td>
      <td className="hidden px-2 py-1.5 text-right align-middle @5xl:table-cell">{formatCurrency(l.priceCents, l.currency)}</td>
      <td className="hidden px-2 py-1.5 text-right align-middle text-muted-foreground @4xl:table-cell">{ageLabel(l.ageDays)}</td>
    </tr>
  )
}

function ageLabel(days: number) {
  if (days < 60) return `${Math.round(days)}d`
  if (days < 730) return `${Math.round(days / 30)}mo`
  return `${(days / 365).toFixed(1)}y`
}
