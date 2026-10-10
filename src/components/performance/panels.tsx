"use client"

import Image from "next/image"
import { ImageIcon } from "lucide-react"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SIZE_BY_KEY } from "@/lib/catalog/sizes"
import { formatCurrency, formatNumber } from "@/lib/etsy/format"
import { EXPENSE_LABEL, type PerformanceReport } from "@/lib/performance/types"
import { cn } from "@/lib/utils"

import { FeeChart, FeeLegend } from "./charts"

// Performance's panels below the chart: where the money goes, the listings
// that earn it, and what listing costs.

const eur = (cents: number) => formatCurrency(cents, "EUR")

export function Panel({
  title,
  aside,
  finding,
  className,
  children,
}: {
  title: string
  aside?: React.ReactNode
  finding?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-2 rounded-lg border p-3", className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h2>
        {aside}
      </div>
      {finding && <p className="text-sm leading-snug text-pretty">{finding}</p>}
      {children}
    </section>
  )
}

// --- Where the money goes ---

export function ExpensesPanel({ report }: { report: PerformanceReport }) {
  const spent = report.expenses.filter((e) => e.cents > 0)
  const back = report.expenses.filter((e) => e.cents < 0)
  const total = spent.reduce((sum, e) => sum + e.cents, 0)
  const top = spent[0]?.cents ?? 0
  const revenue = report.totals.revenueCents

  return (
    <Panel title="Where it goes" aside={<span className="text-[11px] text-muted-foreground tabular-nums">{eur(total)}</span>}>
      {spent.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing spent in this range.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {spent.map((e) => (
            <li key={e.key} className="flex flex-col gap-1 text-[13px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate">{EXPENSE_LABEL[e.key]}</span>
                <span className="flex items-baseline gap-2 tabular-nums">
                  {revenue > 0 && (
                    <span className="text-xs text-muted-foreground" title="Share of revenue">
                      {Math.round((e.cents / revenue) * 1000) / 10} %
                    </span>
                  )}
                  <span className="w-20 text-right font-medium">{eur(e.cents)}</span>
                </span>
              </div>
              <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className={cn("block h-full rounded-full", e.key === "production" ? "bg-foreground/55" : "bg-muted-foreground/45")}
                  style={{ width: `${Math.max((e.cents / top) * 100, 1)}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      {back.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Given back: {back.map((e) => `${EXPENSE_LABEL[e.key]} ${eur(-e.cents)}`).join(", ")} (refunded sales&apos; fees).
        </p>
      )}
      <p className="mt-auto text-xs text-muted-foreground">
        Listing fees by the days they pay for: a listing&apos;s $0.20 covers four months.
      </p>
    </Panel>
  )
}

// --- What sells ---

export function BestSellers({ report }: { report: PerformanceReport }) {
  const rows = report.bestSellers
  return (
    <Panel
      title="Best sellers"
      aside={<span className="text-[11px] text-muted-foreground">by revenue</span>}
      finding={
        rows.length ? (
          <>
            {rows[0].title.split(/[|,–-]/)[0].trim()} brought{" "}
            <strong className="font-semibold tabular-nums">{eur(rows[0].revenueCents)}</strong> from{" "}
            {formatNumber(rows[0].orders)} {rows[0].orders === 1 ? "order" : "orders"}.
          </>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sales in this range.</p>
      ) : (
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent [&>th]:h-8 [&>th]:text-[11px] [&>th]:font-medium [&>th]:text-muted-foreground">
              <TableHead>Listing</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right" title="What Gelato charged for these orders">
                Gelato
              </TableHead>
              <TableHead className="text-right" title="Revenue less Etsy's sale fees (at this range's rate) and Gelato">
                Left
              </TableHead>
              <TableHead title="The size sold most">Size</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.listingId} className="[&>td]:py-1.5">
                <TableCell className="max-w-0 w-full">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded bg-muted">
                      {row.image ? (
                        <Image src={row.image} alt="" fill unoptimized sizes="32px" className="object-cover" />
                      ) : (
                        <ImageIcon className="size-3.5 text-muted-foreground" />
                      )}
                    </span>
                    {row.url ? (
                      <a href={row.url} target="_blank" rel="noreferrer" className="truncate underline-offset-4 hover:underline">
                        {row.title}
                      </a>
                    ) : (
                      <span className="truncate">{row.title}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(row.orders)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{eur(row.revenueCents)}</TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {row.productionCents ? eur(row.productionCents) : "—"}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    row.leftCents > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                  )}
                >
                  {eur(row.leftCents)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.topSize ? SIZE_BY_KEY[row.topSize].cm.replace(/ \(A\d\)/, "") : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  )
}

// --- Listings and what listing costs ---

export function ListingsPanel({ report }: { report: PerformanceReport }) {
  const { listings, traffic, listingFees } = report
  const perNew = listings.added > 0 ? Math.round(listings.feesPaidCents / listings.added) : null
  const rows: { label: string; value: string; hint?: string }[] = [
    { label: "Live", value: formatNumber(listings.live) },
    { label: "New in range", value: formatNumber(listings.added) },
    {
      label: "Run out within 2 weeks",
      value: formatNumber(listings.expiring),
      hint: "Etsy renews them automatically for another $0.20 each",
    },
    {
      label: "Listing fees paid",
      value: eur(listings.feesPaidCents),
      hint: perNew !== null ? `${eur(perNew)} per new listing, renewals included` : undefined,
    },
    ...(traffic
      ? [
          { label: "Views", value: formatNumber(traffic.views), hint: "Gained in the range, from the daily snapshots" },
          { label: "Favourites", value: formatNumber(traffic.favorites) },
        ]
      : []),
  ]
  return (
    <Panel title="Listings">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col" title={row.hint}>
            <dt className="text-[11px] text-muted-foreground">{row.label}</dt>
            <dd className="font-medium tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-1 flex flex-col gap-1 border-t pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">Listing fees, 12 weeks</span>
          <FeeLegend />
        </div>
        <FeeChart weeks={listingFees.weeks} />
        <p className="text-xs text-muted-foreground">
          <strong className="font-medium text-foreground tabular-nums">{eur(listingFees.prepaidCents)}</strong> paid for
          days still to come.
        </p>
      </div>
    </Panel>
  )
}
