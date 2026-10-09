"use client"

import Image from "next/image"
import * as React from "react"
import { StarIcon, StoreIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { forgetShop, type ShopVisit } from "@/hooks/use-shop-history"
import { formatCompact, formatCompactCurrency, formatNumber, formatRate } from "@/lib/etsy/format"

// Shops opened before, most recent first: one row each, with what the last
// analysis found, so the list doubles as a quick comparison.

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
  return (
    <section aria-labelledby="recent-shops" className="@container flex flex-col gap-2">
      <h2 id="recent-shops" className="text-sm font-medium">
        Recent shops <span className="text-muted-foreground tabular-nums">{visits.length}</span>
      </h2>
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
          {visits.map((visit) => (
            <ShopRow
              key={visit.shop.id}
              visit={visit}
              now={now}
              currency={currency}
              onPick={() => onPick(visit.shop.name)}
            />
          ))}
        </ul>
      </div>
    </section>
  )
}

function ShopRow({
  visit,
  now,
  currency,
  onPick,
}: {
  visit: ShopVisit
  now: number
  currency: string
  onPick: () => void
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
        className={`grid w-full items-center gap-x-4 py-2 pr-11 pl-3 text-left text-xs tabular-nums transition-[background-color] duration-150 ease-out focus-visible:bg-muted/60 focus-visible:outline-none [@media(hover:hover)]:hover:bg-muted/60 ${COLUMNS}`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">
            {shop.iconUrl ? (
              <Image src={shop.iconUrl} alt="" fill unoptimized sizes="36px" className="object-cover" />
            ) : (
              <StoreIcon className="size-4 text-muted-foreground" />
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{shop.name}</span>
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
          {timeAgo(visit.analysis?.analysedAt ?? visit.viewedAt, now)}
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Remove ${shop.name} from recent shops`}
        onClick={() => forgetShop(shop.id)}
        className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground transition-opacity duration-150 ease-out [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
      >
        <XIcon />
      </Button>
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

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60],
  ["month", 30 * 24 * 60],
  ["week", 7 * 24 * 60],
  ["day", 24 * 60],
  ["hour", 60],
  ["minute", 1],
]
const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto", style: "narrow" })

function timeAgo(iso: string, now: number) {
  const minutes = Math.max(0, (now - Date.parse(iso)) / 60_000)
  if (minutes < 1) return "Just now"
  const [unit, size] = UNITS.find(([, size]) => minutes >= size)!
  return relative.format(-Math.floor(minutes / size), unit)
}

// Ticks once a minute so "5m ago" doesn't go stale while the page sits open.
function useNow() {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}
