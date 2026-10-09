"use client"

import * as React from "react"
import {
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts"

import { median } from "@/components/listings/stat-strip"
import { useListingSelection } from "@/components/listings/split-view"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import {
  formatCompact,
  formatCompactCurrency,
  formatCurrency,
  formatRate,
} from "@/lib/etsy/format"
import type { Listing } from "@/lib/etsy/types"

// Price against estimated monthly sales, both on log scales: Etsy prices and
// sales span orders of magnitude, and on linear axes everything piles up in a
// corner. Median rules split the plane into quadrants — top-right is where
// listings sell often *and* dear.

const config = { sales: { label: "Sales / mo", color: "var(--brand)" } } satisfies ChartConfig

// Log axes can't show zero; anything below the floor is drawn on it.
const MIN_SALES = 0.1
const MIN_PRICE = 1

type Point = { price: number; sales: number; listing: Listing }

export function PriceVelocityChart({
  listings,
  currency,
}: {
  listings: Listing[]
  currency: string
}) {
  const { selectedId, select } = useListingSelection()

  const { points, xDomain, yDomain, xTicks, yTicks, medians } = React.useMemo(() => {
    const points: Point[] = listings.map((listing) => ({
      price: Math.max(listing.priceCents / 100, MIN_PRICE),
      sales: Math.max(listing.estimate.salesPerMonth, MIN_SALES),
      listing,
    }))
    const x = logDomain(points.map((p) => p.price))
    const y = logDomain(points.map((p) => p.sales))
    return {
      points,
      xDomain: x,
      yDomain: y,
      xTicks: decades(x),
      yTicks: decades(y),
      medians: {
        price: median(points.map((p) => p.price)),
        sales: median(points.map((p) => p.sales)),
      },
    }
  }, [listings])

  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full">
      <ScatterChart margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" />
        <XAxis
          type="number"
          dataKey="price"
          name="Price"
          scale="log"
          domain={xDomain}
          ticks={xTicks}
          allowDataOverflow
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) =>
            formatCurrency(value * 100, currency, { maximumFractionDigits: 0 })
          }
          padding={{ left: 12, right: 12 }}
          label={{ value: "Price", position: "insideBottomRight", offset: -2, className: "fill-muted-foreground" }}
          height={36}
        />
        <YAxis
          type="number"
          dataKey="sales"
          name="Sales / mo"
          scale="log"
          domain={yDomain}
          ticks={yTicks}
          allowDataOverflow
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => formatCompact(value)}
          padding={{ top: 12, bottom: 12 }}
          label={{ value: "Sales / mo", angle: -90, position: "insideLeft", offset: 14, className: "fill-muted-foreground" }}
          width={52}
        />
        <ReferenceLine
          x={medians.price}
          stroke="var(--muted-foreground)"
          strokeOpacity={0.5}
          strokeDasharray="4 4"
          label={{ value: "median", position: "insideTopLeft", className: "fill-muted-foreground text-[10px]" }}
        />
        <ReferenceLine
          y={medians.sales}
          stroke="var(--muted-foreground)"
          strokeOpacity={0.5}
          strokeDasharray="4 4"
          label={{ value: "median", position: "insideBottomRight", className: "fill-muted-foreground text-[10px]" }}
        />
        <Tooltip
          cursor={false}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as Point | undefined
            return active && point ? <PointTooltip point={point} currency={currency} /> : null
          }}
        />
        <Scatter
          data={points}
          isAnimationActive={false}
          shape={(props: { cx?: number; cy?: number; payload?: Point }) => {
            const { cx = 0, cy = 0, payload } = props
            const selected = payload?.listing.id === selectedId
            return (
              <g
                className="cursor-pointer"
                onClick={() => payload && select(payload.listing)}
              >
                {/* Generous hit area; the visible dot stays small. */}
                <circle cx={cx} cy={cy} r={12} fill="transparent" />
                <circle
                  cx={cx}
                  cy={cy}
                  r={selected ? 7 : 5}
                  fill="var(--brand)"
                  fillOpacity={selectedId && !selected ? 0.45 : 1}
                  stroke="var(--background)"
                  strokeWidth={2}
                />
              </g>
            )
          }}
        />
      </ScatterChart>
    </ChartContainer>
  )
}

function PointTooltip({ point, currency }: { point: Point; currency: string }) {
  const { listing } = point
  return (
    <div className="grid max-w-64 gap-1.5 rounded-lg border bg-background px-2.5 py-2 text-xs shadow-lg">
      <div className="grid grid-cols-3 gap-2 tabular-nums">
        <TooltipValue label="Price" value={formatCurrency(listing.priceCents, listing.currency)} />
        <TooltipValue label="Sales / mo" value={formatRate(listing.estimate.salesPerMonth, true)} />
        <TooltipValue
          label="Rev / mo"
          value={formatCompactCurrency(listing.estimate.revenuePerMonthCents, currency)}
        />
      </div>
      <p className="line-clamp-2 text-muted-foreground">{listing.title}</p>
    </div>
  )
}

function TooltipValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-semibold">{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  )
}

// Pads to whole decades so ticks land on 1, 10, 100…
function logDomain(values: number[]): [number, number] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const low = 10 ** Math.floor(Math.log10(min))
  const high = 10 ** Math.ceil(Math.log10(max * 1.0001))
  return [low, high > low ? high : low * 10]
}

function decades([low, high]: [number, number]) {
  const ticks: number[] = []
  for (let v = low; v <= high * 1.0001; v *= 10) ticks.push(Number(v.toPrecision(1)))
  return ticks
}
