"use client"

import * as React from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SIZE_BY_KEY, type SizeKey } from "@/lib/catalog/sizes"
import type { Profit } from "@/lib/pricing/profit"
import { cn } from "@/lib/utils"

import { eur } from "./shared"

// What one sale of each size leaves, smallest size left: green above the
// line, red below, all on one scale so the sizes compare at a glance. Each
// bar's whole column answers the pointer, so the thin bars are easy to hit;
// the tooltip breaks that size's sale down.

const BAR = 6
const GAP = 3
const HEIGHT = 28

export function ProfitBars({ rows }: { rows: { key: SizeKey; profit: Profit }[] }) {
  const [active, setActive] = React.useState<number | null>(null)
  const profits = rows.map((r) => r.profit.profitCents)
  const max = Math.max(0, ...profits)
  const span = max - Math.min(0, ...profits) || 1
  const zero = (max / span) * HEIGHT
  const shown = active !== null ? rows[active] : null
  const summary = rows.map((r) => `${SIZE_BY_KEY[r.key].cm}: ${eur(r.profit.profitCents)}`).join(", ")

  return (
    <Tooltip open={shown !== null} onOpenChange={(open) => !open && setActive(null)}>
      <TooltipTrigger
        delay={0}
        render={
          <div
            role="img"
            aria-label={`Profit of one sale per size: ${summary}`}
            className="relative flex w-fit"
            style={{ height: HEIGHT }}
            onPointerLeave={() => setActive(null)}
          />
        }
      >
        <span aria-hidden className="pointer-events-none absolute inset-x-0 h-px bg-border" style={{ top: zero }} />
        {rows.map((r, i) => {
          const cents = r.profit.profitCents
          const h = Math.max((Math.abs(cents) / span) * HEIGHT, 1)
          return (
            <span
              key={r.key}
              aria-hidden
              className="relative h-full"
              style={{ width: BAR + (i < rows.length - 1 ? GAP : 0) }}
              onPointerEnter={() => setActive(i)}
            >
              <span
                className={cn(
                  "absolute left-0 rounded-[1px] transition-opacity duration-100",
                  cents >= 0 ? "bg-emerald-500" : "bg-destructive",
                  active !== null && active !== i && "opacity-35"
                )}
                style={{ width: BAR, height: h, top: cents >= 0 ? zero - h : zero }}
              />
            </span>
          )
        })}
      </TooltipTrigger>
      {shown && (
        <TooltipContent className="flex-col items-stretch gap-0.5 px-2.5 py-1.5 tabular-nums">
          <span className="font-medium">{SIZE_BY_KEY[shown.key].cm}</span>
          <Line label="Price" cents={shown.profit.priceCents} />
          <Line label="Gelato" cents={-(shown.profit.printCents + shown.profit.shippingCents)} />
          <Line label="Etsy fees" cents={-(shown.profit.feesCents + shown.profit.listingCents)} />
          {shown.profit.salesVatCents > 0 && <Line label="Sales VAT" cents={-shown.profit.salesVatCents} />}
          <span className="flex justify-between gap-3 font-medium">
            Profit <span>{eur(shown.profit.profitCents)}</span>
          </span>
        </TooltipContent>
      )}
    </Tooltip>
  )
}

function Line({ label, cents }: { label: string; cents: number }) {
  return (
    <span className="flex justify-between gap-3 opacity-70">
      {label} <span>{eur(cents)}</span>
    </span>
  )
}
