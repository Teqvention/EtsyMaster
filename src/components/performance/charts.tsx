"use client"

import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, usePlotArea, XAxis, YAxis } from "recharts"

import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { formatCurrency, formatDate, formatNumber } from "@/lib/etsy/format"
import { addDays } from "@/lib/performance/time"
import { EXPENSE_LABEL, type Bucket, type Grain, type PerformanceReport } from "@/lib/performance/types"

// Performance's two charts. Money in rises from the line, money out hangs
// below it, and what's left runs through both as a line: one scale, one
// accent. Animation is off: stepping through ranges would re-animate every time.

const eur = (cents: number) => formatCurrency(cents, "EUR")
/** Axis ticks: €600, €4.5K, −€9K. */
function euroTick(euros: number) {
  const abs = Math.abs(euros)
  return `${euros < 0 ? "−" : ""}€${abs >= 1000 ? `${Number((abs / 1000).toFixed(1))}K` : Math.round(abs)}`
}

/** "Oct 6", "Oct 6 – 12", "October". */
export function bucketLabel(start: string, by: Grain, long = false) {
  if (by === "day") return formatDate(start, long ? { weekday: "short", month: "short", day: "numeric" } : undefined)
  if (by === "week") {
    const end = addDays(start, 6)
    return long ? `${formatDate(start)} – ${formatDate(end)}` : formatDate(start)
  }
  return formatDate(start, { month: long ? "long" : "short", ...(long && { year: "numeric" }) })
}

function Swatch({ className }: { className: string }) {
  return <span className={`size-2 rounded-xs ${className}`} />
}

function TipRow({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${muted ? "pl-2 text-[11px]" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${strong ? "font-semibold" : "font-medium"}`}>{value}</span>
    </div>
  )
}

// --- Money in and out ---

const moneyConfig = {
  revenue: { label: "Revenue", color: "var(--brand)" },
  expenses: { label: "Expenses", color: "var(--muted-foreground)" },
  profit: { label: "Profit", color: "var(--foreground)" },
} satisfies ChartConfig

type MoneyPoint = { bucket: Bucket; label: string; revenue: number | null; expenses: number | null; profit: number | null }

export function MoneyLegend() {
  return (
    <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <Swatch className="bg-brand" /> Revenue
      </span>
      <span className="flex items-center gap-1">
        <Swatch className="bg-muted-foreground/45" /> Expenses
      </span>
      <span className="flex items-center gap-1">
        <span className="h-0.5 w-3 rounded-full bg-foreground" /> Profit
      </span>
    </span>
  )
}

export function MoneyChart({ buckets, by }: { buckets: Bucket[]; by: Grain }) {
  const data: MoneyPoint[] = buckets.map((bucket) => ({
    bucket,
    label: bucketLabel(bucket.start, by),
    revenue: bucket.future ? null : bucket.revenueCents / 100,
    expenses: bucket.future ? null : -bucket.expensesCents / 100,
    profit: bucket.future ? null : bucket.profitCents / 100,
  }))
  return (
    <ChartContainer config={moneyConfig} className="aspect-auto h-72 w-full">
      <ComposedChart data={data} stackOffset="sign" margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={12} height={24} />
        <YAxis tickLine={false} axisLine={false} width={52} tickCount={6} tickFormatter={euroTick} />
        <ReferenceLine y={0} stroke="var(--border)" />
        <Tooltip
          cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as MoneyPoint | undefined
            if (!active || !point || point.bucket.future) return null
            const b = point.bucket
            // Every day reads the same four lines, zeros included: Etsy's fees
            // (top kinds beneath) and Gelato apart, so a quiet day's listing
            // share doesn't stand alone.
            const production = Math.round(b.expenses.production ?? 0)
            const etsy = b.expensesCents - production
            const kinds = Object.entries(b.expenses)
              .filter(([key, cents]) => key !== "production" && Math.round(cents) !== 0)
              .sort((x, y) => y[1] - x[1])
              .slice(0, 4)
            return (
              <div className="grid min-w-48 gap-1 rounded-lg border bg-background px-2.5 py-2 text-xs shadow-lg">
                <div className="font-medium">{bucketLabel(b.start, by, true)}</div>
                <TipRow label="Revenue" value={eur(b.revenueCents)} />
                <TipRow label="Etsy fees" value={eur(-etsy)} />
                {kinds.map(([key, cents]) => (
                  <TipRow key={key} label={EXPENSE_LABEL[key as keyof typeof EXPENSE_LABEL]} value={eur(-cents)} muted />
                ))}
                <TipRow label="Gelato" value={eur(-production)} />
                <TipRow label="Profit" value={eur(b.profitCents)} strong />
                <TipRow label="Orders" value={formatNumber(b.orders)} />
              </div>
            )
          }}
        />
        <Bar dataKey="revenue" stackId="money" fill="var(--color-revenue)" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Bar
          dataKey="expenses"
          stackId="money"
          fill="var(--color-expenses)"
          fillOpacity={0.45}
          maxBarSize={24}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
        <Line
          dataKey="profit"
          type="monotone"
          stroke="var(--color-profit)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
          isAnimationActive={false}
        />
        <ProfitTicks data={data} />
      </ComposedChart>
    </ChartContainer>
  )
}

/** A hairline along the plot's floor under each bucket: green when it made money, red when it lost. */
function ProfitTicks({ data }: { data: MoneyPoint[] }) {
  const area = usePlotArea()
  if (!area || !data.length) return null
  const band = area.width / data.length
  const width = Math.min(Math.max(band * 0.78, 2), 24)
  return (
    <g>
      {data.map(({ bucket, profit }, i) =>
        profit == null || profit === 0 ? null : (
          <rect
            key={bucket.start}
            x={area.x + band * i + (band - width) / 2}
            y={area.y + area.height - 2}
            width={width}
            height={2}
            rx={1}
            className={profit > 0 ? "fill-emerald-500" : "fill-destructive"}
          />
        ),
      )}
    </g>
  )
}

// --- Listing fees: paid against used ---

const feeConfig = {
  paid: { label: "Paid", color: "var(--muted-foreground)" },
  used: { label: "Used up", color: "var(--brand)" },
} satisfies ChartConfig

type FeePoint = { start: string; label: string; paid: number; used: number }

export function FeeLegend() {
  return (
    <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <Swatch className="bg-muted-foreground/45" /> Paid
      </span>
      <span className="flex items-center gap-1">
        <span className="h-0.5 w-3 rounded-full bg-brand" /> Used up
      </span>
    </span>
  )
}

export function FeeChart({ weeks }: { weeks: PerformanceReport["listingFees"]["weeks"] }) {
  const data: FeePoint[] = weeks.map((w) => ({
    start: w.start,
    label: formatDate(w.start),
    paid: w.paidCents / 100,
    used: w.sharedCents / 100,
  }))
  return (
    <ChartContainer config={feeConfig} className="aspect-auto h-40 w-full">
      <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={12} height={24} />
        <YAxis tickLine={false} axisLine={false} width={44} tickCount={4} tickFormatter={euroTick} />
        <Tooltip
          cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as FeePoint | undefined
            if (!active || !point) return null
            return (
              <div className="grid min-w-44 gap-1 rounded-lg border bg-background px-2.5 py-2 text-xs shadow-lg">
                <div className="font-medium">Week of {formatDate(point.start)}</div>
                <TipRow label="Paid" value={eur(Math.round(point.paid * 100))} />
                <TipRow label="Used up" value={eur(Math.round(point.used * 100))} />
              </div>
            )
          }}
        />
        <Bar dataKey="paid" fill="var(--color-paid)" fillOpacity={0.45} maxBarSize={20} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Line
          dataKey="used"
          type="monotone"
          stroke="var(--color-used)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartContainer>
  )
}

