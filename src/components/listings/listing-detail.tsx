"use client"

import Image from "next/image"
import Link from "next/link"
import * as React from "react"
import {
  ChartColumnIcon,
  ExternalLinkIcon,
  MapPinIcon,
  StarIcon,
  StoreIcon,
  XIcon,
} from "lucide-react"

import { EstimateBreakdown } from "@/components/listings/estimate-breakdown"
import { FlagMarks, TierBadge, TrendMark } from "@/components/shops/rank-badges"
import { HeatBar } from "@/components/listings/heat-bar"
import { LikeButton } from "@/components/listings/like-button"
import { ListingGrid } from "@/components/listings/listing-grid"
import { StealButton, StealMockupsButton } from "@/components/steal/steal-buttons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { notifyEtsyRequest } from "@/hooks/use-etsy-usage"
import { useInfiniteListings } from "@/hooks/use-infinite-listings"
import { refreshLiked } from "@/hooks/use-likes"
import {
  formatAge,
  formatCompact,
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatRate,
} from "@/lib/etsy/format"
import type { Confidence, Listing } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// Listings fetched with their review count, kept for the session so flipping
// back and forth between listings doesn't refetch.
const detailCache = new Map<number, Listing>()

function useListingDetail(listingId: number, initial: Listing | null) {
  const [, rerender] = React.useReducer((n: number) => n + 1, 0)
  const [error, setError] = React.useState<{ id: number; message: string } | null>(null)
  const cached = detailCache.get(listingId)

  React.useEffect(() => {
    if (detailCache.has(listingId)) return
    let cancelled = false
    fetch(`/api/listings/${listingId}`)
      .then(async (res) => {
        notifyEtsyRequest()
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? res.statusText)
        return data as Listing
      })
      .then((listing) => {
        detailCache.set(listingId, listing)
        refreshLiked(listing)
        if (!cancelled) rerender()
      })
      .catch((e: Error) => {
        if (!cancelled) setError({ id: listingId, message: e.message })
      })
    return () => {
      cancelled = true
    }
  }, [listingId])

  // Opened from a shop analysis, its estimate and rank are the shop's
  // calibrated ones: the fresh copy only brings the listing up to date.
  const calibrated = initial?.rank ? initial : null
  return {
    listing: calibrated
      ? { ...(cached ?? calibrated), estimate: calibrated.estimate, rank: calibrated.rank, reviewCount: calibrated.reviewCount }
      : (cached ?? initial),
    refined: calibrated !== null || cached !== undefined,
    error: error?.id === listingId ? error.message : null,
  }
}

export function ListingDetail({
  listingId,
  initial,
  onClose,
}: {
  listingId: number
  initial: Listing | null
  onClose: () => void
}) {
  const { listing, refined, error } = useListingDetail(listingId, initial)
  // The photo on screen; the toolbar steals its mockup by default.
  const [shown, setShown] = React.useState({ id: listingId, index: 0 })
  // Back to the first photo whenever another listing opens.
  const photo = shown.id === listingId ? shown.index : 0

  return (
    <div className="flex min-h-full flex-col">
      <div className="@container/toolbar sticky top-0 z-10 flex h-11 shrink-0 items-center gap-1.5 border-b bg-background/90 px-2 backdrop-blur-md">
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <XIcon />
        </Button>
        <span className="hidden text-[11px] whitespace-nowrap text-muted-foreground @[44rem]/toolbar:inline">
          <kbd className="font-sans">←</kbd> <kbd className="font-sans">→</kbd> to browse ·{" "}
          <kbd className="font-sans">esc</kbd> to close
        </span>
        {listing && (
          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            {/* One group: keep it quick (Like), file it (Steal), take its mockups. */}
            <div
              role="group"
              aria-label="Steal"
              className="flex min-w-0 items-center [&>*]:rounded-none [&>*:first-child]:rounded-l-lg [&>*:last-child]:rounded-r-lg [&>*:not(:first-child)]:-ml-px [&>*:focus-visible]:z-10"
            >
              <LikeButton listing={listing} variant="toolbar" />
              <StealButton listing={listing} />
              <StealMockupsButton listing={listing} photo={photo} />
            </div>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              aria-label="Open on Etsy"
              render={<a href={listing.url} target="_blank" rel="noopener noreferrer" />}
            >
              <span className="hidden @[30rem]/toolbar:inline">Etsy</span>
              <ExternalLinkIcon data-icon="inline-end" />
            </Button>
          </div>
        )}
      </div>

      {listing ? (
        <ListingBody
          listing={listing}
          refined={refined}
          photo={photo}
          onPhoto={(index) => setShown({ id: listing.id, index })}
        />
      ) : (
        <div className="grid flex-1 place-items-center p-6 text-sm text-muted-foreground">
          {error ?? "Loading listing…"}
        </div>
      )}
    </div>
  )
}

function ListingBody({
  listing,
  refined,
  photo,
  onPhoto,
}: {
  listing: Listing
  refined: boolean
  photo: number
  onPhoto: (index: number) => void
}) {
  const { estimate, shop } = listing
  const perDay = (n: number) => n / Math.max(listing.ageDays, 1)

  return (
    <div className="flex flex-col">
      <Gallery listing={listing} index={photo} onSelect={onPhoto} />

      <section className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-semibold">
            {formatCurrency(listing.priceCents, listing.currency)}
          </span>
          {listing.originalPrice && (
            <span className="text-xs text-muted-foreground">
              {formatCurrency(listing.originalPrice.cents, listing.originalPrice.currency)} in
              seller currency
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-1">
            {listing.isDigital && <Badge variant="secondary">Digital</Badge>}
            {listing.isPersonalizable && <Badge variant="secondary">Personalizable</Badge>}
            <Badge variant="outline">{formatNumber(listing.quantity)} in stock</Badge>
          </div>
        </div>
        <h2 className="text-sm leading-snug font-medium text-balance">{listing.title}</h2>
      </section>

      <Section
        title="Sales estimate"
        aside={<ConfidenceLabel confidence={estimate.confidence} pending={!refined} />}
      >
        <div className="grid grid-cols-3 divide-x overflow-hidden rounded-lg border bg-card">
          <HeroStat
            label="Lifetime sales"
            value={`≈ ${formatCompact(estimate.sales)}`}
            sub={`${formatCompact(estimate.salesLow)}–${formatCompact(estimate.salesHigh)} range`}
          />
          <HeroStat
            label="Lifetime revenue"
            value={formatCompactCurrency(estimate.revenueCents, listing.currency)}
            sub="at today's price"
          />
          <HeroStat
            label={listing.rank ? "Per month, last 12 mo" : "Per month"}
            value={`${formatRate(estimate.salesPerMonth)} sales`}
            sub={`${formatCompactCurrency(estimate.revenuePerMonthCents, listing.currency)} revenue`}
          />
        </div>
        {listing.rank && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-medium tabular-nums">
              Rank #{formatNumber(listing.rank.position)}{" "}
              <span className="font-normal text-muted-foreground">of {formatNumber(listing.rank.of)} in the shop</span>
            </span>
            <TierBadge tier={listing.rank.tier} />
            <TrendMark rank={listing.rank} className="text-xs" />
            <FlagMarks flags={listing.rank.flags} labels />
            <span className="text-muted-foreground tabular-nums">
              {formatNumber(listing.rank.reviews.all)} reviews, {formatNumber(listing.rank.reviews.year)} in the last 12 months
            </span>
          </div>
        )}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>Velocity</span>
          <HeatBar heat={estimate.heat} className="h-1.5 flex-1" />
          <span className="w-8 text-right font-medium text-foreground tabular-nums">
            {estimate.heat}
          </span>
        </div>
        <EstimateBreakdown listing={listing} reviewsPending={!refined} />
      </Section>

      <Section title="Signals">
        <dl className="grid grid-cols-4 gap-px overflow-hidden rounded-lg border bg-border">
          <Cell label="Favorites" value={formatNumber(listing.favorites)} />
          <Cell label="Views" value={listing.views ? formatNumber(listing.views) : "—"} />
          <Cell
            label="Reviews"
            value={listing.reviewCount === null ? "…" : formatNumber(listing.reviewCount)}
          />
          <Cell
            label="Fav rate"
            value={listing.views ? formatPercent(listing.favorites / listing.views) : "—"}
            hint="Favorites ÷ views"
          />
          <Cell label="Age" value={formatAge(listing.ageDays)} hint={`Since ${formatDate(listing.createdAt, { year: "numeric", month: "short", day: "numeric" })}`} />
          <Cell label="Favs / day" value={formatCompact(perDay(listing.favorites))} />
          <Cell label="Views / day" value={listing.views ? formatCompact(perDay(listing.views)) : "—"} />
          <Cell label="Updated" value={formatDate(listing.updatedAt)} />
        </dl>
      </Section>

      {shop && (
        <Section
          title="Shop"
          aside={
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Link
                href={`/shops?shop=${encodeURIComponent(shop.name)}`}
                className="flex items-center gap-1 hover:text-foreground"
              >
                Analyse shop <ChartColumnIcon className="size-3" />
              </Link>
              <a
                href={shop.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-foreground"
              >
                View on Etsy <ExternalLinkIcon className="size-3" />
              </a>
            </div>
          }
        >
          <div className="flex items-center gap-3">
            <div className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted">
              {shop.iconUrl ? (
                <Image src={shop.iconUrl} alt="" fill unoptimized sizes="40px" className="object-cover" />
              ) : (
                <StoreIcon className="size-4 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{shop.name}</div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {shop.country && (
                  <span className="flex items-center gap-0.5">
                    <MapPinIcon className="size-3" />
                    {shop.country}
                  </span>
                )}
                <span>Since {new Date(shop.openedAt).getUTCFullYear()}</span>
              </div>
            </div>
          </div>
          <dl className="grid grid-cols-4 gap-px overflow-hidden rounded-lg border bg-border">
            <Cell label="Total sales" value={formatCompact(shop.totalSales)} />
            <Cell label="Listings" value={formatCompact(shop.activeListings)} />
            <Cell
              label="Rating"
              value={
                shop.reviewCount > 0 ? (
                  <span className="flex items-center gap-0.5">
                    <StarIcon className="size-3 fill-current" />
                    {shop.reviewAverage.toFixed(2)}
                  </span>
                ) : (
                  "—"
                )
              }
              hint={`${formatNumber(shop.reviewCount)} reviews in the past year`}
            />
            <Cell
              label="This listing"
              value={shop.totalSales ? formatPercent(Math.min(estimate.sales / shop.totalSales, 1)) : "—"}
              hint="Share of the shop's lifetime sales"
            />
          </dl>
        </Section>
      )}

      {(listing.tags.length > 0 || listing.materials.length > 0) && (
        <Section title="Tags & materials">
          <div className="flex flex-wrap gap-1">
            {listing.tags.map((tag) => (
              <Badge key={`t-${tag}`} variant="outline" className="font-normal">
                {tag}
              </Badge>
            ))}
            {listing.materials.map((m) => (
              <Badge key={`m-${m}`} variant="secondary" className="font-normal">
                {m}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      <ShopListings listing={listing} />
    </div>
  )
}

function Gallery({
  listing,
  index,
  onSelect,
}: {
  listing: Listing
  index: number
  onSelect: (index: number) => void
}) {
  const image = listing.images[index]

  return (
    <div className="flex flex-col gap-2 p-3 pb-0">
      <div
        className="relative aspect-4/3 overflow-hidden rounded-lg bg-muted"
        style={listing.color ? { backgroundColor: listing.color } : undefined}
      >
        {image && (
          <Image
            key={image.full}
            src={image.full}
            alt={listing.title}
            fill
            unoptimized
            sizes="720px"
            className="object-contain"
          />
        )}
      </div>
      {listing.images.length > 1 && (
        <div className="flex gap-1.5 no-scrollbar overflow-x-auto">
          {listing.images.map((img, i) => (
            <button
              key={`${i}-${img.thumb}`}
              type="button"
              onClick={() => onSelect(i)}
              aria-label={`Photo ${i + 1}`}
              aria-current={i === index}
              className={cn(
                "relative size-12 shrink-0 overflow-hidden rounded-md border-2 border-transparent opacity-70 transition-[opacity,border-color] duration-150 ease-out hover:opacity-100",
                i === index && "border-brand opacity-100"
              )}
            >
              <Image src={img.thumb} alt="" fill unoptimized sizes="48px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ShopListings({ listing }: { listing: Listing }) {
  const { listings, total, loading, error, done, sentinelRef, retry } = useInfiniteListings(
    `/api/shops/${listing.shopId}/listings`
  )
  const others = listings.filter((l) => l.id !== listing.id)

  return (
    <Section
      title={`More from ${listing.shop?.name ?? "this shop"}`}
      aside={
        total !== null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatNumber(Math.max(total - 1, 0))} listings
          </span>
        )
      }
    >
      <div style={{ "--card-min": "140px" } as React.CSSProperties}>
        <ListingGrid
          listings={others}
          loading={loading}
          error={error}
          done={done}
          sentinelRef={sentinelRef}
          onRetry={retry}
        />
      </div>
    </Section>
  )
}

function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 border-t p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function HeroStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 p-3">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="truncate text-xl font-semibold">{value}</span>
      <span className="truncate text-[11px] text-muted-foreground tabular-nums">{sub}</span>
    </div>
  )
}

function Cell({
  label,
  value,
  hint,
}: {
  label: string
  value: React.ReactNode
  hint?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-card p-2" title={hint}>
      <dt className="truncate text-[10px] text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium tabular-nums">{value}</dd>
    </div>
  )
}

const CONFIDENCE: Record<Confidence, { bars: number; label: string }> = {
  low: { bars: 1, label: "Low confidence" },
  medium: { bars: 2, label: "Medium confidence" },
  high: { bars: 3, label: "High confidence" },
}

function ConfidenceLabel({ confidence, pending }: { confidence: Confidence; pending: boolean }) {
  const { bars, label } = CONFIDENCE[confidence]
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title="How closely the reviews, favorites and views signals agree"
    >
      <span className="flex items-end gap-px" aria-hidden>
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={cn("w-0.75 rounded-full bg-foreground/15", n <= bars && "bg-foreground/70")}
            style={{ height: 4 + n * 3 }}
          />
        ))}
      </span>
      {pending ? "Refining…" : label}
    </span>
  )
}
