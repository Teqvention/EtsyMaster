"use client"

import Image from "next/image"
import Link from "next/link"
import * as React from "react"
import { HeartIcon, StarIcon } from "lucide-react"

import { ListingGrid } from "@/components/listings/listing-grid"
import { PriceVelocityChart } from "@/components/listings/price-velocity-chart"
import { SplitView, useListingSelection } from "@/components/listings/split-view"
import { median, StatStrip } from "@/components/listings/stat-strip"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useLikes, type LikedListing } from "@/hooks/use-likes"
import {
  formatCompact,
  formatCompactCurrency,
  formatNumber,
  formatCurrency,
  formatRate,
} from "@/lib/etsy/format"
import type { Listing, ListingShop } from "@/lib/etsy/types"

type SortKey = "liked" | "revenue" | "sales" | "price" | "favorites" | "heat"
type Layout = "grid" | "shop"

const SORTS: { value: SortKey; label: string; by: (l: LikedListing) => number }[] = [
  { value: "liked", label: "Recently liked", by: (l) => Date.parse(l.likedAt) },
  { value: "revenue", label: "Revenue / mo", by: (l) => l.listing.estimate.revenuePerMonthCents },
  { value: "sales", label: "Sales / mo", by: (l) => l.listing.estimate.salesPerMonth },
  { value: "price", label: "Price", by: (l) => l.listing.priceCents },
  { value: "favorites", label: "Favorites", by: (l) => l.listing.favorites },
  { value: "heat", label: "Velocity", by: (l) => l.listing.estimate.heat },
]

const subscribeNever = () => () => {}

export function LikedView({ currency }: { currency: string }) {
  const likes = useLikes()
  // Likes live in localStorage, which the server can't see. Hold a skeleton
  // until hydration instead of flashing the empty state.
  const hydrated = React.useSyncExternalStore(subscribeNever, () => true, () => false)
  const [sort, setSort] = React.useState<SortKey>("liked")
  const [layout, setLayout] = React.useState<Layout>("grid")

  const listings = React.useMemo(() => {
    const { by } = SORTS.find((s) => s.value === sort)!
    return Object.values(likes)
      .sort((a, b) => by(b) - by(a))
      .map((l) => l.listing)
  }, [likes, sort])

  const shops = React.useMemo(() => groupByShop(listings), [listings])
  // ←/→ in the panel should follow what's on screen, shop by shop.
  const ordered = layout === "shop" ? shops.flatMap((s) => s.listings) : listings

  if (!hydrated) {
    return (
      <div className="flex flex-col gap-3 px-4 lg:px-6">
        <Skeleton className="h-15 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    )
  }

  if (listings.length === 0) {
    return (
      <div className="px-4 lg:px-6">
        <Empty className="min-h-[60svh] border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HeartIcon />
            </EmptyMedia>
            <EmptyTitle>No liked listings yet</EmptyTitle>
            <EmptyDescription>
              Like listings while you search to compare them here.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link href="/search" />}>
              Search listings
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  return (
    <SplitView listings={ordered}>
      <div className="flex flex-col gap-3">
        <Summary listings={listings} shopCount={shops.length} currency={currency} />

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <section className="min-w-0 rounded-lg border p-3" aria-labelledby="price-velocity">
            <SectionTitle id="price-velocity" hint="Click a dot to open the listing">
              Price vs. sales velocity
            </SectionTitle>
            <PriceVelocityChart listings={listings} currency={currency} />
          </section>
          <section className="min-w-0 rounded-lg border p-3" aria-labelledby="top-earners">
            <SectionTitle id="top-earners">Top earners</SectionTitle>
            <TopEarners listings={listings} currency={currency} />
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <h2 className="text-sm font-medium">
            {formatNumber(listings.length)} liked{" "}
            <span className="text-muted-foreground">
              across {formatNumber(shops.length)} {shops.length === 1 ? "shop" : "shops"}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <Select
              value={sort}
              items={SORTS}
              onValueChange={(value) => value && setSort(value as SortKey)}
            >
              <SelectTrigger size="sm" className="w-40" aria-label="Sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ToggleGroup
              variant="outline"
              size="sm"
              spacing={0}
              value={[layout]}
              onValueChange={(value) => value[0] && setLayout(value[0] as Layout)}
              aria-label="Layout"
            >
              <ToggleGroupItem value="grid">Grid</ToggleGroupItem>
              <ToggleGroupItem value="shop">By shop</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        {layout === "grid" ? (
          <ListingGrid listings={listings} />
        ) : (
          <div className="flex flex-col gap-6">
            {shops.map((group) => (
              <ShopSection key={group.id} group={group} currency={currency} />
            ))}
          </div>
        )}
      </div>
    </SplitView>
  )
}

function Summary({
  listings,
  shopCount,
  currency,
}: {
  listings: Listing[]
  shopCount: number
  currency: string
}) {
  const revenue = listings.reduce((sum, l) => sum + l.estimate.revenuePerMonthCents, 0)
  const sales = listings.reduce((sum, l) => sum + l.estimate.salesPerMonth, 0)
  return (
    <StatStrip
      stats={[
        { label: "Liked", value: formatNumber(listings.length) },
        { label: "Shops", value: formatNumber(shopCount) },
        {
          label: "Median price",
          value: formatCurrency(median(listings.map((l) => l.priceCents)), currency),
        },
        {
          label: "Median sales / mo",
          value: formatRate(median(listings.map((l) => l.estimate.salesPerMonth)), true),
        },
        { label: "Combined sales / mo", value: `≈ ${formatCompact(sales)}` },
        {
          label: "Combined revenue / mo",
          value: formatCompactCurrency(revenue, currency),
          hint: "Estimated monthly revenue of all liked listings together",
        },
      ]}
    />
  )
}

function SectionTitle({
  id,
  hint,
  children,
}: {
  id: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h2 id={id} className="text-sm font-medium">
        {children}
      </h2>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  )
}

const TOP_EARNERS = 8

// Ranked list rather than a bar chart: titles are long, and the thumbnail is
// what you recognise a listing by.
function TopEarners({ listings, currency }: { listings: Listing[]; currency: string }) {
  const { selectedId, select } = useListingSelection()
  const top = [...listings]
    .sort((a, b) => b.estimate.revenuePerMonthCents - a.estimate.revenuePerMonthCents)
    .slice(0, TOP_EARNERS)
  const max = top[0]?.estimate.revenuePerMonthCents || 1

  return (
    <ol className="flex flex-col">
      {top.map((listing, index) => (
        <li key={listing.id}>
          <button
            type="button"
            onClick={() => select(listing)}
            aria-current={listing.id === selectedId || undefined}
            className="grid w-full grid-cols-[1rem_2rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-md px-1 py-1 text-left text-xs transition-[background-color,transform] duration-150 ease-out active:scale-[0.98] aria-current:bg-muted [@media(hover:hover)]:hover:bg-muted/60"
          >
            <span className="text-[10px] text-muted-foreground tabular-nums">{index + 1}</span>
            <span className="relative size-8 overflow-hidden rounded bg-muted">
              {listing.images[0] && (
                <Image src={listing.images[0].thumb} alt="" fill unoptimized sizes="32px" className="object-cover" />
              )}
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate">{listing.title}</span>
              <span className="h-1 rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-brand"
                  style={{ width: `${(listing.estimate.revenuePerMonthCents / max) * 100}%` }}
                />
              </span>
            </span>
            <span className="font-medium tabular-nums">
              {formatCompactCurrency(listing.estimate.revenuePerMonthCents, currency)}
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

type ShopGroup = {
  id: number
  shop: ListingShop | null
  listings: Listing[]
  revenue: number
}

// Shops ordered by the combined monthly revenue of their liked listings; the
// listings inside keep the chosen sort.
function groupByShop(listings: Listing[]): ShopGroup[] {
  const groups = new Map<number, ShopGroup>()
  for (const listing of listings) {
    const group = groups.get(listing.shopId) ?? {
      id: listing.shopId,
      shop: listing.shop,
      listings: [],
      revenue: 0,
    }
    group.listings.push(listing)
    group.revenue += listing.estimate.revenuePerMonthCents
    groups.set(listing.shopId, group)
  }
  return [...groups.values()].sort((a, b) => b.revenue - a.revenue)
}

function ShopSection({ group, currency }: { group: ShopGroup; currency: string }) {
  const { shop } = group
  return (
    <section className="flex flex-col gap-2" aria-label={shop?.name ?? "Shop"}>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b pb-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative size-7 shrink-0 overflow-hidden rounded bg-muted">
            {shop?.iconUrl && (
              <Image src={shop.iconUrl} alt="" fill unoptimized sizes="28px" className="object-cover" />
            )}
          </span>
          {shop ? (
            <a
              href={shop.url}
              target="_blank"
              rel="noreferrer"
              className="truncate text-sm font-medium underline-offset-2 hover:underline"
            >
              {shop.name}
            </a>
          ) : (
            <span className="text-sm font-medium">Shop #{group.id}</span>
          )}
        </div>
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground tabular-nums">
          <ShopFact label="liked" value={formatNumber(group.listings.length)} />
          <ShopFact
            label="rev / mo (liked)"
            value={formatCompactCurrency(group.revenue, currency)}
          />
          {shop && <ShopFact label="sales all-time" value={formatCompact(shop.totalSales)} />}
          {shop && <ShopFact label="listings" value={formatCompact(shop.activeListings)} />}
          {shop && shop.reviewCount > 0 && (
            <div className="flex items-center gap-1">
              <StarIcon className="size-3 fill-current" aria-hidden />
              <dd className="font-medium text-foreground">{shop.reviewAverage.toFixed(1)}</dd>
              <dt>({formatCompact(shop.reviewCount)})</dt>
            </div>
          )}
        </dl>
      </header>
      <ListingGrid listings={group.listings} />
    </section>
  )
}

function ShopFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <dd className="font-medium text-foreground">{value}</dd>
      <dt>{label}</dt>
    </div>
  )
}
