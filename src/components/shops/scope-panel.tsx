"use client"

import * as React from "react"
import { RotateCwIcon, SlidersHorizontalIcon, SquareIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useEtsyUsage } from "@/hooks/use-etsy-usage"
import type { AnalysisRun } from "@/hooks/use-shop-analysis"
import {
  planCost,
  REVIEW_WINDOWS,
  SHOP_SORTS,
  type AnalysisPlan,
  type ReviewWindow,
} from "@/lib/etsy/analysis"
import { formatNumber } from "@/lib/etsy/format"
import type { ListingShop, ShopListingSort } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

const PRESETS = [100, 250, 500, 1000, 2500]
// The slider runs on a square curve: most of its travel covers the low
// counts, where a few listings either way matter, and big shops still fit.
const STEPS = 1000

// How much of the shop to fetch, what it costs in API quota, and — once a run
// starts — how far along it is. Collapses to a one-line summary when done.
export function ScopePanel({
  shop,
  plan,
  run,
  onPlanChange,
  onStart,
  onStop,
}: {
  shop: ListingShop
  plan: AnalysisPlan
  run: AnalysisRun | null
  onPlanChange: (plan: AnalysisPlan) => void
  onStart: () => void
  onStop: () => void
}) {
  const [editing, setEditing] = React.useState(false)
  const running = run?.status === "running"
  const settled = run && !running && !editing && samePlan(run.plan, plan)

  if (settled) {
    return <RunSummary shop={shop} run={run} onEdit={() => setEditing(true)} onResume={onStart} />
  }

  return (
    <section
      aria-label="Analysis scope"
      className="relative overflow-hidden rounded-lg border bg-card"
    >
      <fieldset disabled={running} className="flex flex-col gap-4 p-3 disabled:opacity-100">
        <ListingCount shop={shop} plan={plan} disabled={running} onPlanChange={onPlanChange} />

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Order">
            <Select
              value={plan.sort}
              items={SHOP_SORTS}
              disabled={running}
              onValueChange={(value) =>
                value && onPlanChange({ ...plan, sort: value as ShopListingSort })
              }
            >
              <SelectTrigger size="sm" className="w-44" aria-label="Listing order">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHOP_SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value} title={s.hint}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Reviews">
            <Select
              value={plan.reviews}
              items={REVIEW_WINDOWS}
              disabled={running}
              onValueChange={(value) =>
                value && onPlanChange({ ...plan, reviews: value as ReviewWindow })
              }
            >
              <SelectTrigger size="sm" className="w-40" aria-label="Reviews to scan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REVIEW_WINDOWS.map((w) => (
                  <SelectItem key={w.value} value={w.value}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <p className="max-w-80 pb-1.5 text-[11px] leading-snug text-muted-foreground">
            {plan.reviews === "all"
              ? "Every review: exact review counts sharpen each listing's estimate."
              : plan.reviews === "none"
                ? "Estimates use favorites and views only."
                : "Recent reviews show what is selling now, and the trend."}
          </p>
        </div>
      </fieldset>

      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t bg-muted/40 px-3 py-2">
        {running ? (
          <RunProgress run={run} />
        ) : (
          <Cost shop={shop} plan={plan} />
        )}
        <div className="ml-auto flex items-center gap-2">
          {editing && run && !running && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false)
                onPlanChange(run.plan)
              }}
            >
              Cancel
            </Button>
          )}
          {running ? (
            <Button variant="outline" size="sm" onClick={onStop}>
              <SquareIcon className="fill-current" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              className="transition-transform duration-150 ease-out active:scale-[0.97]"
              onClick={() => {
                setEditing(false)
                onStart()
              }}
            >
              Analyse {plan.limit === shop.activeListings ? "all " : ""}
              {formatNumber(plan.limit)} {plan.limit === 1 ? "listing" : "listings"}
            </Button>
          )}
        </div>
      </footer>

      {running && <ProgressBar value={progressOf(run, shop)} />}
    </section>
  )
}

function ListingCount({
  shop,
  plan,
  disabled,
  onPlanChange,
}: {
  shop: ListingShop
  plan: AnalysisPlan
  disabled: boolean
  onPlanChange: (plan: AnalysisPlan) => void
}) {
  const total = Math.max(shop.activeListings, 1)
  const presets = PRESETS.filter((n) => n < total).slice(-4)
  const position = Math.round(Math.sqrt(plan.limit / total) * STEPS)
  const setLimit = (limit: number) =>
    onPlanChange({ ...plan, limit: Math.min(Math.max(Math.round(limit), 1), total) })

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium">Listings to analyse</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          <span className="text-xl font-semibold text-foreground">{formatNumber(plan.limit)}</span>{" "}
          of {formatNumber(total)} active · {formatShare(plan.limit / total)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[String(plan.limit)]}
          disabled={disabled}
          onValueChange={(value) => value[0] && setLimit(Number(value[0]))}
          aria-label="Listing count presets"
        >
          {presets.map((n) => (
            <ToggleGroupItem key={n} value={String(n)} className="tabular-nums">
              {formatNumber(n)}
            </ToggleGroupItem>
          ))}
          <ToggleGroupItem value={String(total)}>All</ToggleGroupItem>
        </ToggleGroup>
        <Slider
          className="min-w-48 flex-1"
          min={0}
          max={STEPS}
          value={[position]}
          disabled={disabled}
          aria-label="Listings to analyse"
          onValueChange={(value) => {
            const p = Array.isArray(value) ? value[0] : (value as number)
            setLimit(total * (p / STEPS) ** 2)
          }}
        />
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

// Cost in requests against what's left today. A run over a quarter of the
// remaining quota is flagged; one over all of it can't finish.
function Cost({ shop, plan }: { shop: ListingShop; plan: AnalysisPlan }) {
  const { usage } = useEtsyUsage()
  const cost = planCost(plan, shop)
  const left = usage?.remainingToday
  const tone =
    left === undefined || cost <= left / 4
      ? "text-muted-foreground"
      : cost <= left
        ? "text-foreground"
        : "text-destructive"

  return (
    <p className={cn("text-xs tabular-nums", tone)}>
      ≈ {formatNumber(cost)} API {cost === 1 ? "request" : "requests"}
      {left !== undefined && (
        <span className="text-muted-foreground"> · {formatNumber(left)} left today</span>
      )}
      <span className="hidden text-muted-foreground sm:inline"> · repeat runs are free</span>
    </p>
  )
}

function RunProgress({ run }: { run: AnalysisRun }) {
  const target = listingTarget(run)
  const onReviews = run.listings.length >= target && run.plan.reviews !== "none"
  return (
    <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
      {onReviews ? (
        <>
          Reviews{" "}
          <span className="font-medium text-foreground">{formatNumber(run.reviews.length)}</span>
          {run.reviewTotal !== null && ` / ${formatNumber(run.reviewTotal)}`}
        </>
      ) : (
        <>
          Listings{" "}
          <span className="font-medium text-foreground">{formatNumber(run.listings.length)}</span>{" "}
          / {formatNumber(target)}
        </>
      )}
    </p>
  )
}

// Pinned to the panel's bottom edge. Scales rather than resizing, so each
// page landing moves it on the compositor.
function ProgressBar({ value }: { value: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Analysis progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className="absolute inset-x-0 bottom-0 h-0.5 bg-brand/15"
    >
      <div
        className="h-full origin-left bg-brand transition-transform duration-300 ease-out-strong"
        style={{ transform: `scaleX(${Math.max(value, 0.02)})` }}
      />
    </div>
  )
}

function RunSummary({
  shop,
  run,
  onEdit,
  onResume,
}: {
  shop: ListingShop
  run: AnalysisRun
  onEdit: () => void
  onResume: () => void
}) {
  const sort = SHOP_SORTS.find((s) => s.value === run.plan.sort)?.label.toLowerCase()
  const window = REVIEW_WINDOWS.find((w) => w.value === run.plan.reviews)
  const total = run.listingTotal ?? shop.activeListings

  return (
    <section
      aria-label="Analysis scope"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2 text-xs"
    >
      <p className="text-muted-foreground tabular-nums">
        {run.status === "stopped" && <span className="font-medium text-foreground">Stopped · </span>}
        <span className="font-medium text-foreground">{formatNumber(run.listings.length)}</span> of{" "}
        {formatNumber(total)} listings, {sort}
        {run.plan.reviews !== "none" && window && (
          <>
            {" "}
            · <span className="font-medium text-foreground">{formatNumber(run.reviews.length)}</span>{" "}
            reviews, {window.label.toLowerCase()}
          </>
        )}
      </p>
      {run.error && <p className="text-destructive">{run.error}</p>}
      <div className="ml-auto flex items-center gap-2">
        {run.status !== "done" && (
          <Button variant="outline" size="sm" onClick={onResume} title="Pages already fetched are free">
            <RotateCwIcon />
            {run.status === "error" ? "Retry" : "Continue"}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <SlidersHorizontalIcon />
          Adjust scope
        </Button>
      </div>
    </section>
  )
}

function listingTarget(run: AnalysisRun) {
  return Math.min(run.plan.limit, run.listingTotal ?? run.plan.limit)
}

// Weighted by requests: a listing page costs two (page + batch), a review page one.
function progressOf(run: AnalysisRun, shop: ListingShop) {
  const listingPages = Math.ceil(listingTarget(run) / 100) * 2
  const reviewPages =
    run.plan.reviews === "none"
      ? 0
      : run.reviewTotal !== null
        ? Math.max(Math.ceil(run.reviewTotal / 100), 1)
        : planCost({ ...run.plan, limit: 0 }, shop)
  const done =
    Math.ceil(run.listings.length / 100) * 2 + Math.ceil(run.reviews.length / 100)
  return Math.min(done / Math.max(listingPages + reviewPages, 1), 1)
}

function samePlan(a: AnalysisPlan, b: AnalysisPlan) {
  return a.limit === b.limit && a.sort === b.sort && a.reviews === b.reviews
}

function formatShare(fraction: number) {
  return fraction >= 0.995 ? "100%" : `${Math.max(Math.round(fraction * 100), fraction > 0 ? 1 : 0)}%`
}
