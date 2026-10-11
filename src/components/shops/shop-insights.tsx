"use client"

import Image from "next/image"
import * as React from "react"

import { PriceVelocityChart } from "@/components/listings/price-velocity-chart"
import { useListingSelection } from "@/components/listings/split-view"
import { StatStrip } from "@/components/listings/stat-strip"
import {
  ConcentrationChart,
  ReviewTrendChart,
  ShareBars,
  ShareLegend,
} from "@/components/shops/insight-charts"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ShopCalibration } from "@/lib/etsy/calibrate"
import {
  reviewMonths,
  REVIEW_WINDOWS,
  type Band,
  type ReviewWindow,
  type Segment,
  type ShopInsights,
  type TagStat,
} from "@/lib/etsy/analysis"
import {
  formatCompact,
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatRate,
} from "@/lib/etsy/format"
import type { Listing, ListingShop, ShopReview } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// The analysis itself. Every panel leads with its finding as a sentence, and
// the chart underneath is the evidence for it.

export function ShopInsightsView({
  shop,
  listings,
  insights,
  reviews,
  reviewWindow,
  recentReviews,
  sharpened,
  calibration,
  currency,
  activeTag,
  onTag,
}: {
  shop: ListingShop
  listings: Listing[]
  insights: ShopInsights
  reviews: ShopReview[] | null
  reviewWindow: ReviewWindow
  recentReviews: Map<number, number> | null
  /** Every review the shop ever got is in. */
  sharpened: boolean
  /** The shop's own rates the estimates rest on. */
  calibration: ShopCalibration | null
  currency: string
  activeTag: string | null
  onTag: (tag: string | null) => void
}) {
  const months = React.useMemo(() => (reviews ? reviewMonths(reviews) : []), [reviews])

  return (
    <div className="@container flex flex-col gap-3">
      <Summary
        shop={shop}
        insights={insights}
        reviews={reviews}
        reviewWindow={reviewWindow}
        sharpened={sharpened}
        calibration={calibration}
        currency={currency}
      />

      <div className="grid gap-3 @4xl:grid-cols-2">
        <Panel
          title="Best performers"
          finding={<BestFinding listings={listings} insights={insights} currency={currency} />}
        >
          <TopPerformers listings={listings} recentReviews={recentReviews} currency={currency} />
        </Panel>
        <Panel title="Revenue concentration" finding={<ConcentrationFinding insights={insights} />}>
          <ConcentrationChart
            curve={insights.curve}
            hitsFor80={insights.hitsFor80}
            count={insights.count}
          />
        </Panel>

        <Panel
          title="Price vs. sales velocity"
          aside="Click a dot to open the listing"
          finding={<PriceFinding insights={insights} currency={currency} />}
        >
          <PriceVelocityChart listings={listings} currency={currency} />
        </Panel>
        <Panel title="Price bands" aside={<ShareLegend />} finding={<BandFinding bands={insights.priceBands} noun="listings priced" />}>
          <ShareBars bands={insights.priceBands} currency={currency} />
        </Panel>

        {reviews && months.length > 0 && (
          <Panel
            title="Reviews per month"
            aside={`≈ 1 in ${Math.round(1 / (calibration?.reviewRate ?? 0.09))} buyers leaves one`}
            finding={<TrendFinding months={months} />}
          >
            <ReviewTrendChart months={months} />
          </Panel>
        )}
        <Panel
          title="Listings by launch year"
          aside={<ShareLegend />}
          finding={<BandFinding bands={insights.cohorts} noun="listings launched in" />}
        >
          <ShareBars bands={insights.cohorts} currency={currency} />
        </Panel>

        <Panel title="Tags that earn" aside="Click to filter listings" finding={<TagFinding tags={insights.tags} />}>
          <TagTable tags={insights.tags} activeTag={activeTag} onTag={onTag} currency={currency} />
        </Panel>
        <Panel title="Product types" aside={<ShareLegend />} finding={<SegmentFinding segments={insights.segments} />}>
          <SegmentRows segments={insights.segments} />
        </Panel>
      </div>
    </div>
  )
}

function Summary({
  shop,
  insights,
  reviews,
  reviewWindow,
  sharpened,
  calibration: c,
  currency,
}: {
  shop: ListingShop
  insights: ShopInsights
  reviews: ShopReview[] | null
  reviewWindow: ReviewWindow
  sharpened: boolean
  calibration: ShopCalibration | null
  currency: string
}) {
  const measured = !!c?.measured.reviewRate
  const basis = measured
    ? "calibrated on the shop's own reviews, favorites and views"
    : sharpened
      ? "favorites, views and reviews, at typical rates (the shop hides its sales)"
      : "favorites and views at typical rates: fetch every review to calibrate"
  const windowLabel = REVIEW_WINDOWS.find((w) => w.value === reviewWindow)?.label
  const rating =
    reviews && reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : null
  const covered = c?.coveredShare ?? (shop.totalSales ? Math.min(insights.lifetimeSales / shop.totalSales, 1) : null)

  return (
    <StatStrip
      stats={[
        {
          label: "Revenue / mo",
          value: `≈ ${formatCompactCurrency(insights.revenuePerMonthCents, currency)}`,
          hint: `The analysed listings' sales a month over the last 12 months × their prices; ${basis}`,
        },
        {
          label: "Sales / mo",
          value: `≈ ${formatCompact(insights.salesPerMonth)}`,
          hint:
            `Over the last 12 months, ${basis}` +
            (c?.salesLastYear ? `. Shop-wide, retired listings included: ≈ ${formatNumber(c.salesLastYear)} sales in the year` : ""),
        },
        {
          label: "Lifetime sales covered",
          value: covered === null ? "—" : formatPercent(covered),
          hint:
            c?.coveredShare != null
              ? `${formatPercent(c.coveredShare)} of the shop's ${formatNumber(c.reviews.all)} reviews went to these listings, so they made that share of its ${formatNumber(shop.totalSales)} sales. The rest sold through listings that are no longer active.`
              : "Estimated lifetime sales of these listings ÷ the shop's reported total. Fetch every review to measure it exactly.",
        },
        {
          label: "Review rate",
          value: c && measured ? `1 in ${Math.round(1 / c.reviewRate)}` : "≈ 1 in 11",
          hint:
            c && measured
              ? `${formatNumber(c.reviews.all)} reviews on ${formatNumber(shop.totalSales)} sales: ${formatPercent(c.reviewRate)} of buyers leave one (typical: 9%). So each review stands for about ${Math.round(1 / c.reviewRate)} sales.`
              : "Typical across shops: 9% of buyers leave a review. Fetch every review to measure this shop's.",
        },
        {
          label: "Favorites / sale",
          value: c ? c.favoritesPerSale.toFixed(1) : "≈ 10",
          hint: c?.measured.attention
            ? `These listings' favorites ÷ the sales their reviews account for (typical: 10). Views: about ${formatCompact(c.viewsPerSale)} per sale (typical: 100).`
            : "Typical across shops: about 10 favorites and 100 views per sale.",
        },
        ...(reviews
          ? [
              {
                label: `Reviews · ${windowLabel?.toLowerCase()}`,
                value: (
                  <span className="tabular-nums">
                    {formatCompact(reviews.length)}
                    {rating !== null && (
                      <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                        ★ {rating.toFixed(2)}
                      </span>
                    )}
                  </span>
                ),
                hint: c?.reviews.year ? `${formatNumber(c.reviews.year)} in the last 12 months` : undefined,
              },
            ]
          : []),
      ]}
    />
  )
}

// --- Panels ---

function Panel({
  title,
  aside,
  finding,
  children,
}: {
  title: string
  aside?: React.ReactNode
  finding: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </h2>
        {typeof aside === "string" ? (
          <span className="text-[11px] text-muted-foreground">{aside}</span>
        ) : (
          aside
        )}
      </div>
      <p className="min-h-[2lh] text-sm leading-snug text-pretty">{finding}</p>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}

/** The number a finding hinges on. */
function Em({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold tabular-nums">{children}</strong>
}

// --- Findings ---

function BestFinding({
  listings,
  insights,
  currency,
}: {
  listings: Listing[]
  insights: ShopInsights
  currency: string
}) {
  const best = listings.reduce<Listing | null>(
    (top, l) =>
      !top || l.estimate.revenuePerMonthCents > top.estimate.revenuePerMonthCents ? l : top,
    null
  )
  if (!best || insights.revenuePerMonthCents === 0) return <>Not enough signal to rank yet.</>
  const share = best.estimate.revenuePerMonthCents / insights.revenuePerMonthCents
  return (
    <>
      The top listing earns <Em>≈ {formatCompactCurrency(best.estimate.revenuePerMonthCents, currency)}</Em>{" "}
      a month — <Em>{formatPercent(share)}</Em> of the sample on its own.
    </>
  )
}

function ConcentrationFinding({ insights }: { insights: ShopInsights }) {
  const { hitsFor80, count } = insights
  if (count === 0 || insights.revenuePerMonthCents === 0) return <>Not enough signal yet.</>
  const share = hitsFor80 / count
  const verdict =
    share <= 0.1 ? "A hit-driven shop." : share <= 0.3 ? "A few clear winners." : "Revenue is spread wide."
  return (
    <>
      <Em>{formatNumber(hitsFor80)}</Em> of {formatNumber(count)} listings (
      <Em>{formatPercent(share)}</Em>) make 80% of revenue. {verdict}
    </>
  )
}

function PriceFinding({ insights, currency }: { insights: ShopInsights; currency: string }) {
  return (
    <>
      A typical listing costs <Em>{formatCurrency(insights.medianPriceCents, currency)}</Em> and sells{" "}
      <Em>{formatRate(insights.medianSalesPerMonth, true)}</Em> a month. Top-right sells often and
      dear.
    </>
  )
}

// The band whose revenue share most outruns its listing share.
function BandFinding({ bands, noun }: { bands: Band[]; noun: string }) {
  const best = bands
    .filter((b) => b.listings > 0)
    .reduce<Band | null>(
      (top, b) => (!top || b.share.revenue - b.share.listings > top.share.revenue - top.share.listings ? b : top),
      null
    )
  if (!best || best.share.revenue === 0) return <>No band stands out yet.</>
  return (
    <>
      {capitalize(noun)} <Em>{best.label}</Em> are <Em>{formatPercent(best.share.listings)}</Em> of
      listings but earn <Em>{formatPercent(best.share.revenue)}</Em> of revenue.
    </>
  )
}

// Last three full months against the three before; the current month is
// still filling up, so it sits out.
function TrendFinding({ months }: { months: { count: number }[] }) {
  const full = months.slice(0, -1)
  const recent = full.slice(-3).reduce((s, m) => s + m.count, 0)
  if (full.length < 6) {
    return (
      <>
        <Em>{formatNumber(months.reduce((s, m) => s + m.count, 0))}</Em> reviews in the window —
        widen it to see a trend.
      </>
    )
  }
  const before = full.slice(-6, -3).reduce((s, m) => s + m.count, 0)
  if (before === 0) return <><Em>{formatNumber(recent)}</Em> reviews in the last three months, from none before.</>
  const change = recent / before - 1
  const direction = Math.abs(change) < 0.1 ? "holding steady" : change > 0 ? "up" : "down"
  return (
    <>
      Reviews are {direction}
      {direction !== "holding steady" && (
        <>
          {" "}
          <Em>{formatPercent(Math.abs(change))}</Em>
        </>
      )}{" "}
      over the last three months ({formatNumber(recent)} vs. {formatNumber(before)}).
    </>
  )
}

function TagFinding({ tags }: { tags: TagStat[] }) {
  const lifted = [...tags].filter((t) => t.listings >= 2).sort((a, b) => b.lift - a.lift)[0]
  if (!tags.length) return <>These listings share no tags.</>
  if (!lifted || lifted.lift < 1.2) {
    return (
      <>
        <Em>“{tags[0].tag}”</Em> covers the most revenue, at <Em>{formatPercent(tags[0].revenueShare)}</Em>.
      </>
    )
  }
  return (
    <>
      Listings tagged <Em>“{lifted.tag}”</Em> earn <Em>{lifted.lift.toFixed(1)}×</Em> the shop
      average.
    </>
  )
}

// The segment furthest from earning its share, either way. A couple of
// listings is an anecdote, so small segments sit out.
function SegmentFinding({ segments }: { segments: Segment[] }) {
  const total = segments[0] ? Math.round(segments[0].count / (segments[0].share.listings || 1)) : 0
  const minCount = Math.max(3, Math.ceil(total * 0.05))
  const best = segments
    .filter((s) => s.count >= minCount && s.share.listings < 1)
    .map((s) => ({ ...s, ratio: s.share.revenue / s.share.listings }))
    .sort((a, b) => Math.abs(Math.log(b.ratio || 1e-6)) - Math.abs(Math.log(a.ratio || 1e-6)))[0]
  if (!best) return <>No product type stands apart.</>
  return (
    <>
      {best.label} listings earn <Em>{best.ratio.toFixed(1)}×</Em> their share of the catalog (
      {formatPercent(best.share.revenue)} of revenue from {formatPercent(best.share.listings)} of
      listings).
    </>
  )
}

// --- Top performers ---

type RankKey = "revenue" | "sales" | "favorites" | "recent"

const RANKS: { value: RankKey; label: string }[] = [
  { value: "revenue", label: "Revenue" },
  { value: "sales", label: "Sales" },
  { value: "favorites", label: "Favs" },
  { value: "recent", label: "Reviews, 12 mo" },
]

const TOP = 10

function TopPerformers({
  listings,
  recentReviews,
  currency,
}: {
  listings: Listing[]
  recentReviews: Map<number, number> | null
  currency: string
}) {
  const { selectedId, select } = useListingSelection()
  const [rank, setRank] = React.useState<RankKey>("revenue")
  const by = React.useCallback(
    (l: Listing) =>
      rank === "revenue"
        ? l.estimate.revenuePerMonthCents
        : rank === "sales"
          ? l.estimate.salesPerMonth
          : rank === "favorites"
            ? l.favorites
            : (l.rank?.reviews.year ?? recentReviews?.get(l.id) ?? 0),
    [rank, recentReviews]
  )
  const top = React.useMemo(
    () => [...listings].sort((a, b) => by(b) - by(a)).slice(0, TOP),
    [listings, by]
  )
  const max = (top[0] && by(top[0])) || 1
  const show = (l: Listing) =>
    rank === "revenue"
      ? `${formatCompactCurrency(l.estimate.revenuePerMonthCents, currency)}/mo`
      : rank === "sales"
        ? `${formatRate(l.estimate.salesPerMonth, true)}/mo`
        : formatCompact(by(l))

  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={0}
        value={[rank]}
        onValueChange={(value) => value[0] && setRank(value[0] as RankKey)}
        aria-label="Rank by"
      >
        {RANKS.filter((r) => r.value !== "recent" || recentReviews).map((r) => (
          <ToggleGroupItem key={r.value} value={r.value}>
            {r.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
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
              <span
                className="relative size-8 overflow-hidden rounded bg-muted"
                style={listing.color ? { backgroundColor: listing.color } : undefined}
              >
                {listing.images[0] && (
                  <Image src={listing.images[0].thumb} alt="" fill unoptimized sizes="32px" className="object-cover" />
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate">{listing.title}</span>
                <span className="h-1 rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-brand"
                    style={{ width: `${Math.max((by(listing) / max) * 100, 1)}%` }}
                  />
                </span>
              </span>
              <span className="font-medium tabular-nums">{show(listing)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

// --- Tags ---

function TagTable({
  tags,
  activeTag,
  onTag,
  currency,
}: {
  tags: TagStat[]
  activeTag: string | null
  onTag: (tag: string | null) => void
  currency: string
}) {
  const max = tags[0]?.revenueShare || 1
  return (
    <div className="flex flex-col text-xs">
      <div className="grid grid-cols-[minmax(0,1fr)_3rem_5rem_3rem] gap-x-3 border-b px-1 pb-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
        <span>Tag</span>
        <span className="text-right">Listings</span>
        <span>Revenue</span>
        <span className="text-right" title="Average revenue per listing with the tag ÷ shop average">
          Lift
        </span>
      </div>
      {tags.map((t) => {
        const active = t.tag === activeTag
        return (
          <button
            key={t.tag}
            type="button"
            onClick={() => onTag(active ? null : t.tag)}
            aria-pressed={active}
            title={`${formatCompactCurrency(t.revenueCents, currency)}/mo · ${formatPercent(t.revenueShare)} of revenue`}
            className="grid grid-cols-[minmax(0,1fr)_3rem_5rem_3rem] items-center gap-x-3 rounded-md px-1 py-1 text-left transition-[background-color] duration-150 ease-out aria-pressed:bg-brand/10 [@media(hover:hover)]:hover:bg-muted/60"
          >
            <span className={cn("truncate", active && "font-medium")}>{t.tag}</span>
            <span className="text-right text-muted-foreground tabular-nums">{formatNumber(t.listings)}</span>
            <span className="h-1 rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-brand"
                style={{ width: `${Math.max((t.revenueShare / max) * 100, 2)}%` }}
              />
            </span>
            <span
              className={cn(
                "text-right font-medium tabular-nums",
                t.lift >= 1.5 ? "text-brand" : t.lift < 1 && "text-muted-foreground"
              )}
            >
              {t.lift.toFixed(1)}×
            </span>
          </button>
        )
      })}
    </div>
  )
}

// --- Segments ---

function SegmentRows({ segments }: { segments: Segment[] }) {
  return (
    <dl className="flex flex-col gap-3 pt-1">
      {segments.filter((s) => s.count > 0).map((s) => (
        <div key={s.label} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-3 text-xs" title={s.hint}>
          <dt className="flex flex-col">
            <span className="font-medium">{s.label}</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {formatNumber(s.count)} {s.count === 1 ? "listing" : "listings"}
            </span>
          </dt>
          <dd className="flex flex-col gap-1">
            <ShareBar value={s.share.listings} className="bg-muted-foreground/35" />
            <ShareBar value={s.share.revenue} className="bg-brand" />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ShareBar({ value, className }: { value: number; className: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-muted">
        <div className={cn("h-full rounded-full", className)} style={{ width: `${value * 100}%` }} />
      </div>
      <span className="w-10 text-right text-[11px] text-muted-foreground tabular-nums">
        {formatPercent(value)}
      </span>
    </div>
  )
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
