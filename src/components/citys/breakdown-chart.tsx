"use client"

import * as React from "react"
import { Cell, Pie, PieChart, Tooltip } from "recharts"

import { formatNumber, formatPercent, formatRate } from "@/lib/etsy/format"
import type { Breakdown } from "@/lib/citys/types"
import { cn } from "@/lib/utils"

// A part-to-whole of the ranking's demand (sales a month), as a ring and the
// same numbers as a list beside it. Each key keeps its colour wherever it
// shows (the order is fixed, never by size); a click on a slice or a row
// narrows the ranking to it, a second click lets go. Animation stays off:
// the numbers move while titles are being read.

const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)
const OTHER = "var(--muted-foreground)"

export type BreakdownChartProps = {
  title: string
  items: Breakdown[]
  /** Keys in colour order; a key not listed is drawn grey. */
  order: string[]
  active: string | null
  onPick: (key: string | null) => void
  /** What a row's second number counts. */
  unit?: string
}

export function colorFor(order: string[], key: string) {
  const at = order.indexOf(key)
  return at >= 0 && at < SERIES.length ? SERIES[at] : OTHER
}

export function BreakdownChart({ title, items, order, active, onPick, unit = "places" }: BreakdownChartProps) {
  const total = items.reduce((n, b) => n + b.spm, 0)
  // Drawn in colour order, so neighbouring slices are the neighbours the palette was checked for.
  const drawn = [...items]
    .filter((b) => b.spm > 0)
    .sort((a, b) => rank(order, a.key) - rank(order, b.key))
  const listed = [...items].sort((a, b) => b.spm - a.spm)
  const [hover, setHover] = React.useState<string | null>(null)
  const focus = hover ?? active
  const focused = focus ? items.find((b) => b.key === focus) : null
  const places = items.reduce((n, b) => n + b.places, 0)

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" aria-label={title}>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative size-24 shrink-0">
          <PieChart width={96} height={96}>
            <Pie
              data={drawn}
              dataKey="spm"
              nameKey="label"
              innerRadius={32}
              outerRadius={46}
              startAngle={90}
              endAngle={-270}
              stroke="var(--background)"
              strokeWidth={2}
              isAnimationActive={false}
              onMouseEnter={(_, index) => setHover(drawn[index]?.key ?? null)}
              onMouseLeave={() => setHover(null)}
              onClick={(_, index) => {
                const key = drawn[index]?.key
                if (key) onPick(active === key ? null : key)
              }}
              className="cursor-pointer outline-none"
            >
              {drawn.map((b) => (
                <Cell
                  key={b.key}
                  fill={colorFor(order, b.key)}
                  fillOpacity={focus && focus !== b.key ? 0.3 : 1}
                  className="transition-[fill-opacity] duration-150 ease-out outline-none"
                />
              ))}
            </Pie>
            <Tooltip isAnimationActive={false} content={() => null} cursor={false} />
          </PieChart>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold">{formatNumber(focused ? focused.places : places)}</span>
              <span className="text-[10px] text-muted-foreground">{unit}</span>
            </div>
          </div>
        </div>
        <ul className="flex min-w-0 flex-1 flex-col gap-0.5">
          {listed.slice(0, 7).map((b) => {
            const on = active === b.key
            return (
              <li key={b.key}>
                <button
                  type="button"
                  onClick={() => onPick(on ? null : b.key)}
                  onMouseEnter={() => setHover(b.key)}
                  onMouseLeave={() => setHover(null)}
                  aria-pressed={on}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-xs outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:bg-accent",
                    on && "bg-accent"
                  )}
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ background: colorFor(order, b.key) }} />
                  <span className={cn("min-w-0 flex-1 truncate", on && "font-medium")} title={`${b.label}: ${formatNumber(b.places)} ${unit}, ${formatRate(b.spm)} sales a month`}>
                    {b.label}
                  </span>
                  <span className="w-11 text-right font-medium tabular-nums">{formatPercent(total ? b.spm / total : 0)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

function rank(order: string[], key: string) {
  const at = order.indexOf(key)
  return at < 0 ? order.length : at
}
