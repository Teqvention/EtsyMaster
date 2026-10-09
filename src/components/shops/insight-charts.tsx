"use client"

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import type { Band, ReviewMonth } from "@/lib/etsy/analysis"
import { formatCompactCurrency, formatNumber, formatPercent } from "@/lib/etsy/format"

// The shop analysis charts. Animation is off throughout: the data updates as
// each page lands, and re-animating on every page would read as jitter.

const percent = (value: number) => `${Math.round(value * 100)}%`
const PERCENT_TICKS = [0, 0.25, 0.5, 0.75, 1]

// Round percentage steps up to just past the tallest bar.
function shareTicks(max: number) {
  const step = max > 0.5 ? 0.25 : max > 0.2 ? 0.1 : 0.05
  const top = Math.max(Math.ceil(max / step - 1e-9), 1) * step
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
}

// --- Revenue concentration (Lorenz curve) ---

const curveConfig = {
  revenue: { label: "Revenue share", color: "var(--brand)" },
} satisfies ChartConfig

export function ConcentrationChart({
  curve,
  hitsFor80,
  count,
}: {
  curve: { listings: number; revenue: number }[]
  hitsFor80: number
  count: number
}) {
  return (
    <ChartContainer config={curveConfig} className="aspect-auto h-full min-h-56 w-full">
      <AreaChart data={curve} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="fillCurve" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--brand)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--brand)" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" />
        <XAxis
          type="number"
          dataKey="listings"
          domain={[0, 1]}
          ticks={PERCENT_TICKS}
          tickFormatter={percent}
          tickLine={false}
          axisLine={false}
          height={24}
        />
        <YAxis
          type="number"
          domain={[0, 1]}
          ticks={PERCENT_TICKS}
          tickFormatter={percent}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        {/* Where an even spread would sit: every listing earning the same. */}
        <ReferenceLine
          segment={[
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ]}
          stroke="var(--muted-foreground)"
          strokeOpacity={0.5}
          strokeDasharray="4 4"
        />
        <ReferenceLine y={0.8} stroke="var(--muted-foreground)" strokeOpacity={0.35} />
        <Tooltip
          cursor={{ stroke: "var(--border)" }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as { listings: number; revenue: number } | undefined
            if (!active || !point) return null
            return (
              <ChartTip
                rows={[
                  {
                    label: `Top ${formatNumber(Math.round(point.listings * count))} listings`,
                    value: `${formatPercent(point.revenue)} of revenue`,
                  },
                ]}
              />
            )
          }}
        />
        <Area
          dataKey="revenue"
          type="linear"
          stroke="var(--brand)"
          strokeWidth={2}
          fill="url(#fillCurve)"
          isAnimationActive={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
        />
        {count > 0 && (
          <ReferenceDot
            x={hitsFor80 / count}
            y={0.8}
            r={4}
            fill="var(--brand)"
            stroke="var(--background)"
            strokeWidth={2}
          />
        )}
      </AreaChart>
    </ChartContainer>
  )
}

// --- Share of listings vs. share of revenue, per band ---

const shareConfig = {
  listings: { label: "Listings", color: "var(--muted-foreground)" },
  revenue: { label: "Revenue / mo", color: "var(--brand)" },
} satisfies ChartConfig

export function ShareLegend() {
  return (
    <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="size-2 rounded-xs bg-muted-foreground/35" /> Listings
      </span>
      <span className="flex items-center gap-1">
        <span className="size-2 rounded-xs bg-brand" /> Revenue
      </span>
    </span>
  )
}

// Two bars per band: where a band's revenue bar towers over its listings bar,
// those listings punch above their weight.
export function ShareBars({ bands, currency }: { bands: Band[]; currency: string }) {
  const data = bands.map((b) => ({ ...b, listingsShare: b.share.listings, revenueShare: b.share.revenue }))
  const ticks = shareTicks(Math.max(0, ...bands.flatMap((b) => [b.share.listings, b.share.revenue])))
  return (
    <ChartContainer config={shareConfig} className="aspect-auto h-56 w-full">
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2}>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          interval={0}
          height={24}
          tick={{ fontSize: 10 }}
        />
        <YAxis
          domain={[0, ticks.at(-1)!]}
          ticks={ticks}
          tickFormatter={percent}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const band = payload?.[0]?.payload as Band | undefined
            if (!active || !band) return null
            return (
              <ChartTip
                title={band.label}
                rows={[
                  {
                    label: "Listings",
                    value: `${formatNumber(band.listings)} · ${formatPercent(band.share.listings)}`,
                  },
                  {
                    label: "Revenue / mo",
                    value: `${formatCompactCurrency(band.revenueCents, currency)} · ${formatPercent(band.share.revenue)}`,
                  },
                ]}
              />
            )
          }}
        />
        <Bar
          dataKey="listingsShare"
          fill="var(--muted-foreground)"
          fillOpacity={0.35}
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        />
        <Bar dataKey="revenueShare" fill="var(--brand)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}

// --- Reviews per month ---

const reviewConfig = {
  count: { label: "Reviews", color: "var(--brand)" },
} satisfies ChartConfig

export function ReviewTrendChart({ months }: { months: ReviewMonth[] }) {
  return (
    <ChartContainer config={reviewConfig} className="aspect-auto h-56 w-full">
      <BarChart data={months} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          minTickGap={16}
          height={24}
          tickFormatter={(month: string) => formatMonth(month, month.endsWith("-01"))}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={40}
          tickCount={4}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const m = payload?.[0]?.payload as ReviewMonth | undefined
            if (!active || !m) return null
            return (
              <ChartTip
                title={formatMonth(m.month, true)}
                rows={[
                  { label: "Reviews", value: formatNumber(m.count) },
                  {
                    label: "Avg rating",
                    value: m.averageRating === null ? "—" : `★ ${m.averageRating.toFixed(2)}`,
                  },
                ]}
              />
            )
          }}
        />
        <Bar dataKey="count" fill="var(--brand)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}

function formatMonth(month: string, withYear: boolean) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: withYear ? "2-digit" : undefined,
    timeZone: "UTC",
  })
}

function ChartTip({
  title,
  rows,
}: {
  title?: string
  rows: { label: string; value: string }[]
}) {
  return (
    <div className="grid min-w-36 gap-1 rounded-lg border bg-background px-2.5 py-2 text-xs shadow-lg">
      {title && <div className="font-medium">{title}</div>}
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4">
          <span className="text-muted-foreground">{row.label}</span>
          <span className="font-medium tabular-nums">{row.value}</span>
        </div>
      ))}
    </div>
  )
}
