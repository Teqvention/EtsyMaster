"use client"

import Image from "next/image"
import * as React from "react"
import { StarIcon } from "lucide-react"

import { HeatBar } from "@/components/listings/heat-bar"
import { LikeButton } from "@/components/listings/like-button"
import { useListingSelection } from "@/components/listings/split-view"
import {
  formatAge,
  formatCompact,
  formatCompactCurrency,
  formatCurrency,
  formatRate,
} from "@/lib/etsy/format"
import type { Listing } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// Dense research tile: enough numbers to judge a listing at a glance, laid out
// so the eye can scan the same row across a whole grid.
export function ListingCard({ listing }: { listing: Listing }) {
  const { selectedId, select } = useListingSelection()
  const selected = selectedId === listing.id
  const { estimate, shop } = listing
  const [loaded, setLoaded] = React.useState(false)
  const image = listing.images[0]

  return (
    <article
      data-listing-id={listing.id}
      className={cn(
        "group/card relative flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-xs transition-[border-color,box-shadow] duration-150 ease-out hover:border-foreground/20",
        selected && "border-brand ring-2 ring-brand/30 hover:border-brand"
      )}
    >
      <div
        className="relative aspect-square overflow-hidden bg-muted"
        style={listing.color ? { backgroundColor: listing.color } : undefined}
      >
        {image && (
          <Image
            src={image.medium}
            alt=""
            fill
            unoptimized
            sizes="200px"
            onLoad={() => setLoaded(true)}
            className={cn(
              "object-cover transition-opacity duration-200 ease-out",
              loaded ? "opacity-100" : "opacity-0"
            )}
          />
        )}
        <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex items-end justify-between gap-1 font-medium tabular-nums">
          <span className="rounded bg-background/85 px-1 py-px text-[10px] backdrop-blur-sm" title="Listing age">
            {formatAge(listing.ageDays)}
          </span>
          <span
            className="rounded bg-background/85 px-1 py-px text-[10px] backdrop-blur-sm"
            title="Estimated sales per month"
          >
            {formatRate(estimate.salesPerMonth, true).replace(" ", "")}/mo
          </span>
        </div>
      </div>

      <HeatBar heat={estimate.heat} className="rounded-none" />

      <div className="flex flex-col gap-1.5 p-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold tabular-nums">
            {formatCurrency(listing.priceCents, listing.currency)}
          </span>
          <span className="truncate text-muted-foreground tabular-nums" title="Estimated revenue per month">
            {formatCompactCurrency(estimate.revenuePerMonthCents, listing.currency)}/mo
          </span>
        </div>

        <h3 className="line-clamp-2 min-h-[2lh] leading-snug text-muted-foreground">
          {listing.title}
        </h3>

        <dl className="grid grid-cols-3 gap-x-1 border-t pt-1.5 tabular-nums">
          <MiniStat label="Sales" value={`~${formatCompact(estimate.sales)}`} />
          <MiniStat label="Favs" value={formatCompact(listing.favorites)} />
          <MiniStat label="Views" value={listing.views ? formatCompact(listing.views) : "—"} />
        </dl>

        {shop && (
          <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
            <span className="truncate font-medium text-foreground/80">{shop.name}</span>
            <span className="shrink-0 tabular-nums">· {formatCompact(shop.totalSales)} sold</span>
            {shop.reviewCount > 0 && (
              <span className="ml-auto flex shrink-0 items-center gap-0.5 tabular-nums">
                <StarIcon className="size-2.5 fill-current" />
                {shop.reviewAverage.toFixed(1)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Stretched button: the whole card opens the listing, while the like
          button stays a separate control on top of it. */}
      <button
        type="button"
        onClick={() => select(listing)}
        aria-label={`Open ${listing.title}`}
        aria-pressed={selected}
        className="absolute inset-0 z-10 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <LikeButton listing={listing} className="absolute top-1.5 right-1.5 z-20" />
    </article>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  )
}

export function ListingCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-card">
      <div className="aspect-square animate-pulse bg-muted" />
      <div className="flex flex-col gap-2 p-2">
        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-7 animate-pulse rounded bg-muted" />
        <div className="h-6 animate-pulse rounded bg-muted" />
      </div>
    </div>
  )
}
