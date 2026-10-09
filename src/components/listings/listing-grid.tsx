"use client"

import { RotateCwIcon } from "lucide-react"

import { ListingCard, ListingCardSkeleton } from "@/components/listings/listing-card"
import { Button } from "@/components/ui/button"
import type { Listing } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// Auto-filling grid of listing cards. Column count follows the container, so
// the same grid packs tighter when the detail panel takes half the page.
// Card width comes from `--card-min` on any ancestor.
export function ListingGrid({
  listings,
  loading = false,
  error = null,
  done = false,
  sentinelRef,
  onRetry,
  className,
}: {
  listings: Listing[]
  loading?: boolean
  error?: string | null
  done?: boolean
  sentinelRef?: (node: HTMLElement | null) => void
  onRetry?: () => void
  className?: string
}) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "grid grid-cols-[repeat(auto-fill,minmax(var(--card-min,172px),1fr))] gap-2",
          className
        )}
      >
        {listings.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
        {loading &&
          Array.from({ length: listings.length === 0 ? 18 : 6 }, (_, i) => (
            <ListingCardSkeleton key={i} />
          ))}
      </div>

      {error && (
        <div className="flex items-center justify-center gap-3 py-4 text-sm text-muted-foreground">
          <span>{error}</span>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCwIcon />
              Retry
            </Button>
          )}
        </div>
      )}

      {done && listings.length > 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">
          That&apos;s all {listings.length} listings.
        </p>
      )}

      {sentinelRef && !done && <div ref={sentinelRef} aria-hidden className="h-px" />}
    </div>
  )
}
