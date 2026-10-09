"use client"

import Link from "next/link"
import * as React from "react"
import { LibraryBigIcon, StoreIcon } from "lucide-react"

import { KeywordExplorer } from "@/components/keywords/keyword-explorer"
import { KeywordInsights } from "@/components/keywords/keyword-insights"
import { LibraryShops } from "@/components/keywords/library-shops"
import { StatStrip } from "@/components/listings/stat-strip"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useKeywordLibrary } from "@/hooks/use-keyword-library"
import { formatNumber, formatRate } from "@/lib/etsy/format"

// What the titles and tags of the shops in the keyword library say sells:
// an AI read of it up top, the shops it's made from beside that, and every
// tag and title phrase below, ranked.

export function KeywordsView({ currency }: { currency: string }) {
  const { library, error } = useKeywordLibrary()
  const [query, setQuery] = React.useState("")
  const explorer = React.useRef<HTMLElement>(null)

  // From a keyword in the AI read: look it up in the table below.
  const find = React.useCallback((keyword: string) => {
    setQuery(keyword)
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    explorer.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
  }, [])

  if (!library) {
    return (
      <div className="flex flex-col gap-3 px-4 lg:px-6">
        {error ? (
          <Empty className="min-h-[40svh] border border-dashed">
            <EmptyHeader>
              <EmptyTitle>Couldn&apos;t load the keyword library</EmptyTitle>
              <EmptyDescription>{error}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <Skeleton className="h-4 w-96 max-w-full rounded" />
            <Skeleton className="h-16 rounded-lg" />
            <div className="grid gap-3 @5xl/main:grid-cols-[minmax(0,1fr)_22rem]">
              <Skeleton className="h-64 rounded-lg" />
              <Skeleton className="h-64 rounded-lg" />
            </div>
            <Skeleton className="h-96 rounded-lg" />
          </>
        )}
      </div>
    )
  }

  if (library.shops.length === 0) {
    return (
      <div className="px-4 lg:px-6">
        <Empty className="min-h-[50svh] border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LibraryBigIcon />
            </EmptyMedia>
            <EmptyTitle>Learn the keywords that sell</EmptyTitle>
            <EmptyDescription>
              Analyse a shop that sells well, then add it to the library from its header. Its
              titles and tags land here, ranked by how the listings using them sell — and the
              upload pipeline learns from them.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link href="/shops" />} className="active:scale-[0.97]">
              <StoreIcon />
              Find a shop
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  const { stats } = library
  return (
    <div className="flex flex-col gap-3 px-4 lg:px-6">
      <p className="max-w-2xl text-sm text-muted-foreground">
        The titles and tags of {stats.shops === 1 ? "one shop" : `${formatNumber(stats.shops)} shops`}, ranked by how
        the listings using them sell. The upload pipeline writes its titles and tags from this.
      </p>

      <StatStrip
        // Six fill two rows of three, or three of two, without a gap.
        className="grid-cols-2 @xl/main:grid-cols-3 @5xl/main:grid-cols-6"
        stats={[
          { label: "Shops", value: formatNumber(stats.shops) },
          { label: "Listings", value: formatNumber(stats.listings) },
          {
            label: "Top sellers",
            value: formatNumber(library.shops.reduce((n, s) => n + s.topSellers, 0)),
            hint: "The best fifth of each shop's listings by sales per month",
          },
          { label: "Tags", value: formatNumber(library.tags.length), hint: "Distinct tags across every listing" },
          {
            label: "Title phrases",
            value: formatNumber(library.phrases.length),
            hint: "Parts of titles (split at | , – and the like) that more than one listing uses",
          },
          {
            label: "Sales / listing",
            value: formatRate(library.averageSalesPerMonth, true),
            hint: "Estimated sales per month of the average listing in the library",
          },
        ]}
      />

      <div className="grid items-start gap-3 @5xl/main:grid-cols-[minmax(0,1fr)_22rem]">
        <KeywordInsights library={library} onKeyword={find} />
        <LibraryShops shops={library.shops} />
      </div>

      <KeywordExplorer
        ref={explorer}
        library={library}
        query={query}
        onQueryChange={setQuery}
        currency={currency}
      />
    </div>
  )
}
