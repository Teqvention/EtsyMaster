"use client"

import { MoonIcon, SparklesIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react"

import type { ShopCalibration } from "@/lib/etsy/calibrate"
import { formatCompact, formatNumber, formatPercent } from "@/lib/etsy/format"
import type { Listing, ListingRank, RankTier } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// How a listing stands in its shop, small enough for a tile or a table row:
// its tier, its trend, and what's notable about it. Every mark says in its
// title what it's worked out from.

export const TIERS: Record<Exclude<RankTier, "rest">, { label: string; hint: string; className: string }> = {
  top1: {
    label: "Top 1%",
    hint: "Among the shop's best 1% by sales a month over the last 12 months",
    className: "bg-brand text-white",
  },
  top10: {
    label: "Top 10%",
    hint: "Among the shop's best 10% by sales a month over the last 12 months",
    className: "bg-brand/15 text-brand",
  },
  top25: {
    label: "Top 25%",
    hint: "Among the shop's best quarter by sales a month over the last 12 months",
    className: "bg-muted text-foreground",
  },
}

export function TierBadge({ tier, className }: { tier: RankTier; className?: string }) {
  if (tier === "rest") return null
  const { label, hint, className: tone } = TIERS[tier]
  return (
    <span
      title={hint}
      className={cn("inline-flex h-4.5 shrink-0 items-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums", tone, className)}
    >
      {label}
    </span>
  )
}

export const FLAGS: Record<ListingRank["flags"][number], { label: string; hint: string; icon: typeof TrendingUpIcon; className: string }> = {
  rising: {
    label: "Rising",
    hint: "Selling at least 1.5× faster in the last 90 days than over the year",
    icon: TrendingUpIcon,
    className: "text-emerald-700 dark:text-emerald-400",
  },
  new: {
    label: "New & drawing",
    hint: "Listed in the last 90 days, and collecting favorites as fast as the shop's top quarter",
    icon: SparklesIcon,
    className: "text-sky-700 dark:text-sky-400",
  },
  sleeping: {
    label: "Sleeping",
    hint: "Among the shop's best sellers of all time, but no review in the last 12 months",
    icon: MoonIcon,
    className: "text-muted-foreground",
  },
}

export function FlagMarks({ flags, labels = false }: { flags: ListingRank["flags"]; labels?: boolean }) {
  if (flags.length === 0) return null
  return (
    <span className="inline-flex items-center gap-1.5">
      {flags.map((flag) => {
        const { label, hint, icon: Icon, className } = FLAGS[flag]
        return (
          <span key={flag} title={`${label}: ${hint}`} className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium", className)}>
            <Icon className="size-3.5" aria-label={labels ? undefined : label} />
            {labels && label}
          </span>
        )
      })}
    </span>
  )
}

/** Within ±20% it's steady; past that, the change with its direction. */
export function trendChange(trend: number | null) {
  if (trend === null) return null
  const change = trend - 1
  return Math.abs(change) < 0.2 ? 0 : Math.max(Math.min(change, 3), -0.95)
}

export function TrendMark({ rank, className }: { rank: ListingRank | undefined; className?: string }) {
  const change = trendChange(rank?.trend ?? null)
  if (!rank || change === null) return <span className={cn("text-muted-foreground", className)}>—</span>
  const from =
    rank.trendFrom === "reviews"
      ? `${rank.reviews.quarter} reviews in the last 90 days, ${rank.reviews.year} in the last 12 months`
      : rank.favoritesGained
        ? `${formatNumber(rank.favoritesGained.count)} favorites gained since ${new Date(rank.favoritesGained.since).toLocaleDateString()}, against its usual pace`
        : ""
  if (change === 0) {
    return (
      <span title={`Steady: ${from}`} className={cn("text-muted-foreground", className)}>
        steady
      </span>
    )
  }
  const Icon = change > 0 ? TrendingUpIcon : TrendingDownIcon
  return (
    <span
      title={`${change > 0 ? "Faster" : "Slower"} lately than over the year: ${from}`}
      className={cn(
        "inline-flex items-center gap-0.5 font-medium tabular-nums",
        change > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400",
        className
      )}
    >
      <Icon className="size-3.5" />
      {formatPercent(change, true).replace(/\.0%/, "%")}
    </span>
  )
}

/** The listing's sales, step by step: what each number points to and how much it counts. */
export function explainEstimate(listing: Listing, calibration: ShopCalibration | null) {
  const { estimate, rank } = listing
  const lines = estimate.signals.map((s) => {
    const share = s.weight === undefined ? "" : ` · counts ${Math.round(s.weight * 100)}%`
    if (s.source === "reviews") {
      const reviews = rank?.reviews.all ?? listing.reviewCount ?? 0
      const rate = s.per ?? calibration?.reviewRate ?? 0
      return `${formatNumber(reviews)} reviews ÷ ${formatPercent(rate)} who review = ${formatCompact(s.sales)}${share}`
    }
    if (s.source === "favorites") {
      const per = s.per ?? calibration?.favoritesPerSale ?? 0
      return `${formatNumber(listing.favorites)} favorites ÷ ${per.toFixed(1)} per sale = ${formatCompact(s.sales)}${share}`
    }
    const per = s.per ?? calibration?.viewsPerSale ?? 0
    return `${formatNumber(listing.views)} views ÷ ${formatCompact(per)} per sale = ${formatCompact(s.sales)}${share}`
  })
  const scaled = calibration?.reviewsComplete && calibration.coveredShare !== null
  return [
    `≈ ${formatNumber(estimate.sales)} sales since it was listed`,
    ...lines.map((line) => `· ${line}`),
    ...(scaled ? ["Blended, then scaled so the shop's listings add up to the sales their reviews account for."] : []),
    ...(rank
      ? [
          `Last 12 months ≈ ${formatNumber(rank.recentSales)} sales (${rank.reviews.year} reviews in the year) → rank #${rank.position} of ${formatNumber(rank.of)}`,
        ]
      : []),
  ].join("\n")
}
