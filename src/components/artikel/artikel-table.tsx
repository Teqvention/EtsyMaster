"use client"

import Image from "next/image"
import * as React from "react"
import { ArrowDownIcon, ArrowUpIcon, ImageIcon, VideoIcon } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import type { Selection } from "@/hooks/use-selection"
import { formatNumber } from "@/lib/etsy/format"
import type { ArtikelRow, InternalTag } from "@/lib/artikel/types"
import { cn } from "@/lib/utils"

import { Est, money, priceRange, shortDate, Signed, StateLabel, TagChip } from "./shared"

// The listings, one dense row each: photo, title with its internal tags,
// state, prices, the range's views, favourites and sales, and what the sales
// left over after Etsy and Gelato. A click opens the listing; the box picks it
// (Shift picks the run from the last one).

export type SortKey =
  | "title"
  | "state"
  | "price"
  | "views"
  | "favorites"
  | "sales"
  | "revenue"
  | "fees"
  | "cost"
  | "profit"
  | "ads"
  | "endsAt"
  | "section"

export type Sort = { key: SortKey; desc: boolean }

const COLUMNS: { key: SortKey; label: string; hint: string; className?: string }[] = [
  { key: "state", label: "State", hint: "Active, inactive, draft, sold out or expired", className: "w-24 text-left" },
  { key: "price", label: "Price", hint: "Cheapest to dearest size", className: "w-28 text-right" },
  { key: "views", label: "Views", hint: "Over the range, from the daily snapshots", className: "w-16 text-right" },
  { key: "favorites", label: "Favs", hint: "Favourites over the range", className: "w-14 text-right" },
  { key: "sales", label: "Sales", hint: "Units sold over the range", className: "w-14 text-right" },
  { key: "revenue", label: "Revenue", hint: "Items and shipping, less discounts and refunds", className: "w-20 text-right" },
  {
    key: "fees",
    label: "Etsy fees",
    hint: "Transaction, processing, listing and Offsite Ads fees with VAT; est. where the ledger hasn't booked them yet",
    className: "w-20 text-right",
  },
  { key: "cost", label: "Gelato", hint: "What Gelato charged for the orders; est. where it hasn't billed yet", className: "w-20 text-right" },
  { key: "profit", label: "Profit", hint: "Revenue less Etsy fees and Gelato, before Etsy Ads", className: "w-20 text-right" },
  {
    key: "ads",
    label: "Ads est.",
    hint: "The shop's Etsy Ads spend shared out by views. Etsy reports neither spend nor clicks per listing",
    className: "w-18 text-right",
  },
  { key: "endsAt", label: "Ends", hint: "When the listing's four months run out (it renews itself if set to)", className: "w-16 text-right" },
  { key: "section", label: "Section", hint: "Shop section", className: "w-32 text-left" },
]

export const SORT_VALUE: Record<SortKey, (r: ArtikelRow) => number | string> = {
  title: (r) => r.title.toLowerCase(),
  state: (r) => r.state,
  price: (r) => r.priceMin,
  views: (r) => r.views,
  favorites: (r) => r.favorites,
  sales: (r) => r.sales,
  revenue: (r) => r.revenueCents,
  fees: (r) => r.feesCents,
  cost: (r) => r.costCents,
  profit: (r) => r.profitCents,
  ads: (r) => r.adsEstCents,
  endsAt: (r) => r.endsAt ?? Number.MAX_SAFE_INTEGER,
  section: (r) => (r.section ?? "").toLowerCase(),
}

export function ArtikelTable({
  rows,
  sort,
  onSort,
  selection,
  tags,
  showShop,
  openId,
  onOpen,
  now,
}: {
  rows: ArtikelRow[]
  sort: Sort
  onSort: (key: SortKey) => void
  selection: Selection
  tags: Map<string, InternalTag>
  showShop: boolean
  openId: number | null
  onOpen: (listingId: number) => void
  /** Epoch ms of today: listings running out within two weeks show it. */
  now: number
}) {
  // Shift held while a box is clicked: the box's own change event doesn't say.
  const shift = React.useRef(false)
  const all = rows.length > 0 && selection.count === rows.length

  return (
    <div className="-mx-3 overflow-x-auto">
      <table className="w-full min-w-[78rem] border-separate border-spacing-0 text-xs">
        <thead className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
          <tr>
            <th className="w-8 border-b pb-1.5 pl-3 text-left">
              <Checkbox
                checked={all}
                indeterminate={selection.count > 0 && !all}
                onCheckedChange={() => (all ? selection.clear() : selection.selectAll())}
                aria-label={all ? "Deselect all" : "Select all listings shown"}
              />
            </th>
            <SortHead column={{ key: "title", label: "Listing", hint: "A–Z" }} sort={sort} onSort={onSort} className="text-left" />
            {COLUMNS.map((column) => (
              <SortHead key={column.key} column={column} sort={sort} onSort={onSort} className={column.className} />
            ))}
            <th className="w-3 border-b" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = selection.has(row.listingId)
            const cell = "border-b px-2 py-1.5 tabular-nums"
            const quiet = (n: number) => (n === 0 ? "text-muted-foreground/60" : undefined)
            const soon = row.endsAt !== null && row.state === "active" && row.endsAt - now < 14 * 86_400_000
            return (
              <tr
                key={row.listingId}
                onClick={() => onOpen(row.listingId)}
                className={cn(
                  "cursor-pointer transition-[background-color] duration-150 ease-out [@media(hover:hover)]:hover:bg-muted/50",
                  selected && "bg-brand/5 [@media(hover:hover)]:hover:bg-brand/10",
                  openId === row.listingId && "bg-muted/60"
                )}
              >
                <td
                  className={cn(cell, "pl-3")}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => (shift.current = event.shiftKey)}
                  onKeyDown={() => (shift.current = false)}
                >
                  <Checkbox
                    checked={selected}
                    onCheckedChange={() => {
                      selection.toggle(row.listingId, { range: shift.current })
                      shift.current = false
                    }}
                    aria-label={`Select ${row.title}`}
                  />
                </td>
                <td className={cn(cell, "max-w-0 py-1")}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded bg-muted">
                      {row.thumb ? (
                        <Image src={row.thumb} alt="" fill unoptimized sizes="36px" className="object-cover" />
                      ) : (
                        <ImageIcon className="size-3.5 text-muted-foreground" />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[13px] leading-tight" title={row.title}>
                        {row.title}
                      </span>
                      <span className="flex min-w-0 items-center gap-1 text-[11px] leading-none text-muted-foreground">
                        {showShop && <span className="shrink-0">{row.shop}</span>}
                        <span className="shrink-0">
                          {showShop && "· "}
                          {row.photos} photo{row.photos === 1 ? "" : "s"}
                        </span>
                        {row.hasVideo && <VideoIcon className="size-3 shrink-0" aria-label="Has a video" />}
                        {row.tags.map((id) => {
                          const tag = tags.get(id)
                          return tag && <TagChip key={id} tag={tag} />
                        })}
                      </span>
                    </span>
                  </div>
                </td>
                <td className={cell}>
                  <StateLabel state={row.state} />
                </td>
                <td className={cn(cell, "text-right whitespace-nowrap")}>
                  {priceRange(row.priceMin, row.priceMax, row.currency)}
                </td>
                <td className={cn(cell, "text-right", quiet(row.views))}>{formatNumber(row.views)}</td>
                <td className={cn(cell, "text-right", quiet(row.favorites))}>{formatNumber(row.favorites)}</td>
                <td className={cn(cell, "text-right", quiet(row.sales))} title={`${row.orders} order${row.orders === 1 ? "" : "s"}`}>
                  {formatNumber(row.sales)}
                </td>
                <td className={cn(cell, "text-right", quiet(row.revenueCents))}>
                  {row.revenueCents ? money(row.revenueCents, row.currency) : "—"}
                </td>
                <td className={cn(cell, "text-right whitespace-nowrap", quiet(row.feesCents))}>
                  {row.feesCents ? money(row.feesCents, row.currency) : "—"}
                  {row.feesEstimated && <Est title="Partly worked out at Etsy's rates: not in the payment ledger yet" />}
                </td>
                <td className={cn(cell, "text-right whitespace-nowrap", quiet(row.costCents))}>
                  {row.costCents ? money(row.costCents, row.currency) : "—"}
                  {row.costEstimated && <Est title="Gelato hasn't billed every order yet: its usual price for the size" />}
                </td>
                <td className={cn(cell, "text-right font-medium")}>
                  {row.sales || row.feesCents ? <Signed cents={row.profitCents} currency={row.currency} /> : <span className="text-muted-foreground/60">—</span>}
                </td>
                <td className={cn(cell, "text-right text-muted-foreground")}>
                  {row.adsEstCents ? `≈ ${money(row.adsEstCents, row.currency)}` : "—"}
                </td>
                <td className={cn(cell, "text-right whitespace-nowrap", soon ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                  {row.endsAt ? shortDate(row.endsAt) : "—"}
                </td>
                <td className={cn(cell, "max-w-0 truncate text-muted-foreground")} title={row.section ?? undefined}>
                  {row.section ?? "—"}
                </td>
                <td className="border-b" />
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SortHead({
  column,
  sort,
  onSort,
  className,
}: {
  column: { key: SortKey; label: string; hint: string }
  sort: Sort
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = sort.key === column.key
  const right = className?.includes("text-right")
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
      className={cn("border-b px-2 pb-1.5 font-medium", className)}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        title={column.hint}
        className={cn(
          "inline-flex items-center gap-0.5 rounded uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:text-foreground",
          right && "flex-row-reverse",
          active && "text-foreground"
        )}
      >
        {column.label}
        <span className="grid size-3 place-items-center">
          {active && (sort.desc ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" />)}
        </span>
      </button>
    </th>
  )
}
