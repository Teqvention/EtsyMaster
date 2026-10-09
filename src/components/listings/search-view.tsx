"use client"

import { useSearchParams } from "next/navigation"
import * as React from "react"
import { SearchIcon } from "lucide-react"

import { ListingGrid } from "@/components/listings/listing-grid"
import { SearchFilters } from "@/components/listings/search-filters"
import { SplitView } from "@/components/listings/split-view"
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
import { useInfiniteListings } from "@/hooks/use-infinite-listings"
import {
  formatCompact,
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatRate,
} from "@/lib/etsy/format"
import { listingQueryToParams, parseListingQuery } from "@/lib/etsy/query"
import type { Category, Listing, ListingQuery } from "@/lib/etsy/types"

const SUGGESTIONS = [
  "ceramic mug",
  "personalized necklace",
  "linen dress",
  "wall art print",
  "digital planner",
  "dog collar",
]

// A listing counts as "hot" from ~10 estimated sales a month up.
const HOT_HEAT = 60

export function SearchView({
  categories,
  currency,
}: {
  categories: Category[]
  currency: string
}) {
  const searchParams = useSearchParams()
  const query = parseListingQuery(searchParams)
  const queryKey = listingQueryToParams(query).toString()
  const endpoint = query.keywords ? `/api/listings?${queryKey}` : null
  const { listings, total, loading, error, done, sentinelRef, retry } =
    useInfiniteListings(endpoint)

  // A new search is a new history entry, and closes any open listing.
  function search(next: ListingQuery) {
    const params = listingQueryToParams(next).toString()
    window.history.pushState(null, "", params ? `?${params}` : window.location.pathname)
  }

  return (
    <div className="flex flex-col gap-3">
      <SearchFilters
        key={queryKey}
        query={query}
        categories={categories}
        currency={currency}
        onChange={search}
      />

      {query.keywords && (
        <div className="px-4 lg:px-6">
          <MarketSnapshot listings={listings} total={total} currency={currency} />
        </div>
      )}

      <SplitView listings={listings}>
        {!query.keywords ? (
          <Empty className="min-h-[50svh] border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchIcon />
              </EmptyMedia>
              <EmptyTitle>See what sells on Etsy</EmptyTitle>
              <EmptyDescription>
                Search any product to see live listings with estimated sales and revenue.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row flex-wrap justify-center">
              {SUGGESTIONS.map((keywords) => (
                <Button
                  key={keywords}
                  variant="outline"
                  size="sm"
                  onClick={() => search({ ...query, keywords })}
                >
                  {keywords}
                </Button>
              ))}
            </EmptyContent>
          </Empty>
        ) : done && listings.length === 0 ? (
          <Empty className="min-h-[40svh] border border-dashed">
            <EmptyHeader>
              <EmptyTitle>No listings match</EmptyTitle>
              <EmptyDescription>Try fewer words or loosen the filters.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ListingGrid
            listings={listings}
            loading={loading}
            error={error}
            done={done}
            sentinelRef={sentinelRef}
            onRetry={retry}
          />
        )}
      </SplitView>
    </div>
  )
}

// Aggregates over the results loaded so far — the market at a glance.
function MarketSnapshot({
  listings,
  total,
  currency,
}: {
  listings: Listing[]
  total: number | null
  currency: string
}) {
  const stats = React.useMemo(() => {
    const hot = listings.filter((l) => l.estimate.heat >= HOT_HEAT).length
    const revenue = listings.reduce((sum, l) => sum + l.estimate.revenuePerMonthCents, 0)
    const n = listings.length || 1
    return {
      medianPrice: median(listings.map((l) => l.priceCents)),
      medianSales: median(listings.map((l) => l.estimate.salesPerMonth)),
      medianFavorites: median(listings.map((l) => l.favorites)),
      hotShare: hot / n,
      revenue,
    }
  }, [listings])

  const empty = listings.length === 0
  const dash = "—"

  return (
    <StatStrip
      stats={[
        {
          label: "Matches",
          value: total === null ? dash : formatCompact(total),
          hint: `${formatNumber(listings.length)} loaded; the rest are computed from these`,
        },
        {
          label: "Median price",
          value: empty ? dash : formatCurrency(stats.medianPrice, currency),
        },
        {
          label: "Median sales / mo",
          value: empty ? dash : formatRate(stats.medianSales, true),
        },
        {
          label: "Median favorites",
          value: empty ? dash : formatCompact(stats.medianFavorites),
        },
        {
          label: "Hot listings",
          value: empty ? dash : formatPercent(stats.hotShare),
          hint: "Share selling roughly 10+ a month",
        },
        {
          label: "Revenue / mo, loaded",
          value: empty ? dash : formatCompactCurrency(stats.revenue, currency),
          hint: "Combined estimate across loaded listings",
        },
      ]}
    />
  )
}
