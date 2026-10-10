"use client"

import { Area, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts"

import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { SIZE_BY_KEY, SIZE_KEYS, type SizeKey } from "@/lib/catalog/sizes"
import { priceForMargin } from "@/lib/pricing/profit"
import type { PricesState } from "@/lib/pricing/types"

import { eur, shortSize } from "./shared"

// Every profile's price per size against what selling costs: the profile on
// screen in the accent (unsaved prices included), the others in grey, the
// price that leaves nothing over dashed, and the market's middle half as a
// band once it knows the sizes. Redrawn on every keystroke, so no animation.

const config = {
  shown: { label: "Shown profile", color: "var(--brand)" },
  others: { label: "Other profiles", color: "var(--muted-foreground)" },
  breakEven: { label: "Break-even", color: "var(--muted-foreground)" },
  market: { label: "Market", color: "var(--muted-foreground)" },
} satisfies ChartConfig

type Point = {
  key: SizeKey
  label: string
  breakEven: number | null
  band: [number, number] | null
  median: number | null
} & Record<string, unknown>

export function ProfilesChart({
  state,
  shownId,
  draft,
}: {
  state: PricesState
  shownId: string
  draft: Record<SizeKey, number>
}) {
  const others = state.profiles.filter((p) => p.id !== shownId)
  const shown = state.profiles.find((p) => p.id === shownId)
  const withMarket = Object.keys(state.market.sizes).length > 0

  const data: Point[] = SIZE_KEYS.map((key) => {
    const even = priceForMargin(0, state.costs.sizes[key], state.assumptions, state.usd.rate)
    const spread = state.market.sizes[key]
    const point: Point = {
      key,
      label: shortSize(key),
      breakEven: even === null ? null : even / 100,
      band: spread ? [spread.p25 / 100, spread.p75 / 100] : null,
      median: spread ? spread.median / 100 : null,
      shown: draft[key] / 100,
    }
    for (const p of others) point[p.id] = p.prices[key] / 100
    return point
  })

  return (
    <div className="flex flex-col gap-2">
      <Legend name={shown?.name ?? "Shown"} others={others.length > 0} market={withMarket} />
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="2 4" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={6} height={24} tick={{ fontSize: 10 }} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={40}
            tickCount={5}
            domain={[0, "auto"]}
            tickFormatter={(euros: number) => `€${euros}`}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as Point | undefined
              if (!active || !point) return null
              return (
                <div className="grid min-w-48 gap-1 rounded-lg border bg-background px-2.5 py-2 text-xs shadow-lg">
                  <div className="font-medium">{SIZE_BY_KEY[point.key].cm}</div>
                  <TipRow label={shown?.name ?? "Shown"} value={eur(Math.round((point.shown as number) * 100))} strong />
                  {others.map((p) => (
                    <TipRow key={p.id} label={p.name} value={eur(p.prices[point.key])} />
                  ))}
                  {point.breakEven !== null && (
                    <TipRow label="Break-even" value={eur(Math.round(point.breakEven * 100))} />
                  )}
                  {point.median !== null && point.band && (
                    <TipRow
                      label="Market"
                      value={`${eur(Math.round(point.median * 100))} · ${Math.round(point.band[0])}–${Math.round(point.band[1])}`}
                    />
                  )}
                </div>
              )
            }}
          />
          {withMarket && (
            <Area
              dataKey="band"
              type="monotone"
              stroke="none"
              fill="var(--muted-foreground)"
              fillOpacity={0.12}
              connectNulls
              isAnimationActive={false}
              activeDot={false}
            />
          )}
          {withMarket && (
            <Line
              dataKey="median"
              type="monotone"
              stroke="var(--muted-foreground)"
              strokeOpacity={0.6}
              strokeWidth={1.5}
              dot={false}
              activeDot={false}
              connectNulls
              isAnimationActive={false}
            />
          )}
          <Line
            dataKey="breakEven"
            type="monotone"
            stroke="var(--muted-foreground)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          {others.map((p) => (
            <Line
              key={p.id}
              dataKey={p.id}
              type="monotone"
              stroke="var(--muted-foreground)"
              strokeOpacity={0.45}
              strokeWidth={1.5}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          ))}
          <Line
            dataKey="shown"
            type="monotone"
            stroke="var(--brand)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--brand)", strokeWidth: 0 }}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ChartContainer>
    </div>
  )
}

function TipRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-semibold tabular-nums" : "font-medium tabular-nums"}>{value}</span>
    </div>
  )
}

function Legend({ name, others, market }: { name: string; others: boolean; market: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="h-0.5 w-3 rounded-full bg-brand" /> {name}
      </span>
      {others && (
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-3 rounded-full bg-muted-foreground/45" /> Other profiles
        </span>
      )}
      <span className="flex items-center gap-1">
        <span className="w-3 border-t-[1.5px] border-dashed border-muted-foreground" /> Break-even
      </span>
      {market && (
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-xs bg-muted-foreground/15" /> Market, middle half
        </span>
      )}
    </div>
  )
}
