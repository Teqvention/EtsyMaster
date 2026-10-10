"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  ChartColumnIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SettingsIcon,
} from "lucide-react"
import { toast } from "sonner"

import { StatStrip } from "@/components/listings/stat-strip"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { syncNow, usePerformance } from "@/hooks/use-performance"
import { formatCurrency, formatNumber, formatPercent } from "@/lib/etsy/format"
import { daysBetween } from "@/lib/performance/time"
import {
  GRAINS,
  RANGE_LABEL,
  RANGES,
  type Grain,
  type PerformanceQuery,
  type PerformanceReport,
  type RangeKey,
  type Totals,
} from "@/lib/performance/types"
import { timeAgo } from "@/lib/shops/time-ago"
import { cn } from "@/lib/utils"

import { MoneyChart, MoneyLegend } from "./charts"
import { BestSellers, ExpensesPanel, ListingsPanel, Panel } from "./panels"

// What the shops earn and spend, from the daily sync: profit up top, the
// range's numbers in one strip, money in and out over time, where it goes,
// and what sells. Shop, range and grain live in the address, so a view can
// be bookmarked; stepping through ranges keeps the last one dimmed until the
// next arrives.

const eur = (cents: number) => formatCurrency(cents, "EUR")
/** Totals in whole euros: the cents of €2,970 say nothing. */
const whole = (cents: number, sign = false) =>
  formatCurrency(cents, "EUR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    ...(sign && { signDisplay: "exceptZero" as const }),
  })

export function PerformanceView() {
  const [query, setQuery] = useQuery()
  const { report, loading, error } = usePerformance(query)
  const now = useMinute()

  if (!report) {
    return error ? (
      <div className="px-4 lg:px-6">
        <Empty className="min-h-[50svh] border border-dashed">
          <EmptyHeader>
            <EmptyTitle>Couldn&apos;t work out the numbers</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    ) : (
      <Loading />
    )
  }

  if (report.state === "no-shop") {
    return (
      <div className="px-4 lg:px-6">
        <Empty className="min-h-[50svh] border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartColumnIcon />
            </EmptyMedia>
            <EmptyTitle>No shop to look at yet</EmptyTitle>
            <EmptyDescription>
              Performance adds up the sales, Etsy&apos;s fees and Gelato&apos;s costs of the shops connected in
              Settings. Connect one and its numbers arrive with the first sync.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link href="/settings" />} className="active:scale-[0.97]">
              <SettingsIcon />
              Open Settings
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  if (report.state === "no-sync") {
    const blocked = report.sync.filter((s) => s.blocked)
    const allBlocked = blocked.length > 0 && blocked.length === report.sync.length
    // "SlowMiles and CitysInBlack: not connected to Etsy."
    const reasons = new Map<string, string[]>()
    for (const s of blocked) reasons.set(s.blocked!, [...(reasons.get(s.blocked!) ?? []), s.shopName ?? s.label ?? s.account])
    return (
      <div className="px-4 lg:px-6">
        <Empty className="min-h-[50svh] border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartColumnIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing synced yet</EmptyTitle>
            <EmptyDescription>
              {allBlocked ? (
                <>
                  {[...reasons].map(([reason, names]) => `${names.join(" and ")}: ${reason[0].toLowerCase()}${reason.slice(1)}.`).join(" ")}{" "}
                  The sync reads each shop with its owner&apos;s Etsy connection, made in Settings.
                </>
              ) : (
                "The sync reads each shop's sales, Etsy's fees and Gelato's costs once a day. Run it now to see them here."
              )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            {!allBlocked && <SyncButton report={report} account={query.account} />}
            {blocked.length > 0 && (
              <Button
                variant={allBlocked ? "default" : "outline"}
                nativeButton={false}
                render={<Link href="/settings" />}
                className="active:scale-[0.97]"
              >
                <SettingsIcon />
                Open Settings
              </Button>
            )}
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  const { totals, previous, range } = report
  const days = daysBetween(range.from, range.to) + 1
  const grains = GRAINS.filter((g) => (g === "day" ? days <= 120 : g === "week" ? days >= 14 : days >= 60))

  return (
    <div className="flex flex-col gap-3 px-4 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <p className="max-w-xl text-sm text-muted-foreground">
          Sales against everything they cost: Gelato&apos;s production and every fee Etsy charged, Etsy Ads included.
          Listing fees count over the four months they pay for.
        </p>
        <Headline report={report} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {report.accounts.length > 1 && (
          <Select
            value={report.account}
            onValueChange={(value) => value && setQuery({ account: value })}
            items={[
              { value: "all", label: "All shops" },
              ...report.accounts.map((a) => ({ value: a.id, label: a.shopName ?? a.label })),
            ]}
          >
            <SelectTrigger size="sm" aria-label="Shop" className="min-w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All shops</SelectItem>
                {report.accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.shopName ?? a.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
        <Select
          value={query.range}
          onValueChange={(value) => value && setQuery({ range: value as RangeKey, offset: 0, by: undefined })}
          items={RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))}
        >
          <SelectTrigger size="sm" aria-label="Range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {RANGES.map((r) => (
                <SelectItem key={r} value={r}>
                  {RANGE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Earlier"
            disabled={query.range === "all"}
            onClick={() => setQuery({ offset: query.offset - 1 })}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="min-w-28 text-center text-sm font-medium tabular-nums">{range.label}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Later"
            disabled={query.offset >= 0}
            onClick={() => setQuery({ offset: Math.min(query.offset + 1, 0) })}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        {grains.length > 1 && (
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            value={[range.by]}
            onValueChange={(value) => value[0] && setQuery({ by: value[0] as Grain })}
            aria-label="Group by"
          >
            {grains.map((g) => (
              <ToggleGroupItem key={g} value={g} className="px-2.5 capitalize">
                {g}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        <div className="ml-auto flex items-center gap-2">
          <SyncState report={report} now={now} />
          <SyncButton report={report} account={query.account} />
        </div>
      </div>
      {error && <p className="-mt-1.5 text-xs text-destructive">Couldn&apos;t update: {error}</p>}

      <div
        className={cn(
          "flex flex-col gap-3 transition-opacity duration-200 ease-out-strong",
          loading && "opacity-60 motion-reduce:opacity-100"
        )}
        aria-busy={loading}
      >
        <StatStrip
          className="grid-cols-2 @xl/main:grid-cols-4 @5xl/main:grid-cols-8"
          stats={[
            {
              label: "Revenue",
              value: <Compared cents={totals.revenueCents} before={previous?.revenueCents} />,
              hint: "Items and shipping the buyers paid, less discounts and refunds",
            },
            {
              label: "Expenses",
              value: <Compared cents={totals.expensesCents} before={previous?.expensesCents} lowerIsBetter />,
              hint: "Gelato's production and Etsy's fees; listing fees by the days they pay for",
            },
            {
              label: "Profit",
              value: <Compared cents={totals.profitCents} before={previous?.profitCents} sign />,
            },
            {
              label: "Margin",
              value: totals.revenueCents > 0 ? formatPercent(totals.profitCents / totals.revenueCents) : "—",
              hint: "Profit as a share of revenue",
            },
            { label: "Orders", value: <Count value={totals.orders} before={previous?.orders} /> },
            {
              label: "Avg order",
              value: totals.orders ? eur(Math.round(totals.revenueCents / totals.orders)) : "—",
              hint: `${formatNumber(totals.items)} items in ${formatNumber(totals.orders)} orders`,
            },
            {
              label: "Ads",
              value: totals.adsCents ? eur(totals.adsCents) : "—",
              hint: "Etsy Ads and Offsite Ads fees",
            },
            {
              label: "Ad cost / order",
              value: totals.adsCents && totals.orders ? eur(Math.round(totals.adsCents / totals.orders)) : "—",
              hint: "What ads cost per order, all orders counted: Etsy doesn't tell which orders an ad brought",
            },
          ]}
        />
        {previous && range.previousLabel && (
          <p className="-mt-1.5 text-xs text-muted-foreground">Arrows compare with {range.previousLabel}.</p>
        )}

        <div className="grid gap-3 @5xl/main:grid-cols-[minmax(0,1fr)_22rem]">
          <Panel title="Money in and out" aside={<MoneyLegend />} finding={<MoneyFinding report={report} />}>
            <MoneyChart buckets={report.buckets} by={range.by} />
          </Panel>
          <ExpensesPanel report={report} />
        </div>

        <div className="grid gap-3 @5xl/main:grid-cols-[minmax(0,1fr)_22rem]">
          <BestSellers report={report} />
          <ListingsPanel report={report} />
        </div>
      </div>
    </div>
  )
}

// --- Headline ---

function Headline({ report }: { report: PerformanceReport }) {
  const items = [
    { label: "All time", cents: report.headline.allTimeCents, hint: "Every sale less every cost, listing fees when they were paid" },
    { label: "This month", cents: report.headline.monthCents, hint: "So far; listing fees by the days they pay for" },
    { label: "This week", cents: report.headline.weekCents, hint: "Since Monday; listing fees by the days they pay for" },
  ]
  return (
    <dl className="flex items-start gap-5">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col items-end gap-0.5" title={item.hint}>
          <dt className="text-[11px] text-muted-foreground">{item.label} profit</dt>
          <dd
            className={cn(
              "text-lg leading-none font-semibold tabular-nums",
              item.cents > 0 ? "text-emerald-600 dark:text-emerald-400" : item.cents < 0 && "text-destructive"
            )}
          >
            {whole(item.cents, true)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function MoneyFinding({ report }: { report: PerformanceReport }) {
  const { totals, expenses } = report
  if (!totals.revenueCents && !totals.expensesCents) return <>Nothing sold or spent in {report.range.label.toLowerCase()}.</>
  const biggest = expenses[0]
  const per = (cents: number) => (totals.revenueCents > 0 ? formatPercent(cents / totals.revenueCents) : null)
  return (
    <>
      {totals.profitCents >= 0 ? "Kept " : "Lost "}
      <strong className="font-semibold tabular-nums">{whole(Math.abs(totals.profitCents))}</strong> of{" "}
      <strong className="font-semibold tabular-nums">{whole(totals.revenueCents)}</strong>
      {biggest && biggest.cents > 0 && per(biggest.cents) && (
        <>
          ; the biggest cost was {biggest.key === "production" ? "Gelato" : "Etsy"} at {per(biggest.cents)} of revenue
        </>
      )}
      .
    </>
  )
}

// --- Numbers against the period before ---

function Delta({ now, before, lowerIsBetter }: { now: number; before?: number; lowerIsBetter?: boolean }) {
  if (before === undefined || (now === 0 && before === 0)) return null
  const change = before === 0 ? null : (now - before) / Math.abs(before)
  const up = now > before
  const good = lowerIsBetter ? !up : up
  const Icon = up ? ArrowUpRightIcon : ArrowDownRightIcon
  return (
    <span
      className={cn(
        "ml-1.5 inline-flex items-center text-xs font-normal tabular-nums",
        now === before ? "text-muted-foreground" : good ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
      )}
    >
      {now !== before && <Icon className="size-3" aria-label={up ? "up" : "down"} />}
      {change === null ? "new" : `${Math.round(Math.abs(change) * 100)}%`}
    </span>
  )
}

function Compared({ cents, before, lowerIsBetter, sign }: { cents: number; before?: number; lowerIsBetter?: boolean; sign?: boolean }) {
  return (
    <>
      <span className={cn(sign && cents < 0 && "text-destructive")}>{whole(cents, sign)}</span>
      <Delta now={cents} before={before} lowerIsBetter={lowerIsBetter} />
    </>
  )
}

function Count({ value, before }: { value: number; before?: Totals["orders"] }) {
  return (
    <>
      {formatNumber(value)}
      <Delta now={value} before={before} />
    </>
  )
}

// --- Sync ---

function SyncState({ report, now }: { report: PerformanceReport; now: number }) {
  const running = report.sync.find((s) => s.running)
  if (running) return <span className="text-xs text-muted-foreground">{running.step ?? "Syncing…"}</span>
  const failed = report.sync.find((s) => s.error)
  const times = report.sync.flatMap((s) => [s.sales, s.ledger].filter((t): t is number => t !== null))
  const oldest = times.length ? Math.min(...times) : null
  return (
    <span className="text-xs text-muted-foreground" title={failed?.error}>
      {failed ? <span className="text-destructive">Last sync failed</span> : oldest ? `Synced ${timeAgo(new Date(oldest).toISOString(), now)}` : "Not synced"}
    </span>
  )
}

function SyncButton({ report, account }: { report: PerformanceReport; account: string }) {
  const [starting, setStarting] = React.useState(false)
  const running = starting || report.sync.some((s) => s.running)
  const blocked = report.sync.length > 0 && report.sync.every((s) => s.blocked)

  async function sync() {
    setStarting(true)
    try {
      await syncNow(account === "all" ? undefined : account)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setStarting(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={sync} disabled={running || blocked} className="active:scale-[0.97]">
      {running ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
      {running ? "Syncing" : "Sync now"}
    </Button>
  )
}

// Now, to the minute, so "Synced 5m ago" keeps up while the page is open.
function useMinute() {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

// --- The view, in the address ---

function useQuery() {
  const params = useSearchParams()
  const range = params.get("range") as RangeKey | null
  const by = params.get("by") as Grain | null
  const query: PerformanceQuery = {
    account: params.get("shop") || "all",
    range: range && RANGES.includes(range) ? range : "month",
    offset: Math.min(Number(params.get("offset")) || 0, 0),
    by: by && GRAINS.includes(by) ? by : undefined,
  }
  const set = React.useCallback((patch: Partial<PerformanceQuery>) => {
    const next = new URLSearchParams(window.location.search)
    const write = (name: string, value: string | undefined, fallback: string) => {
      if (value === undefined || value === fallback) next.delete(name)
      else next.set(name, value)
    }
    if ("account" in patch) write("shop", patch.account, "all")
    if ("range" in patch) write("range", patch.range, "month")
    if ("offset" in patch) write("offset", String(patch.offset), "0")
    if ("by" in patch) write("by", patch.by, "")
    const search = next.toString()
    window.history.replaceState(null, "", search ? `?${search}` : window.location.pathname)
  }, [])
  return [query, set] as const
}

// --- Loading ---

function Loading() {
  return (
    <div className="flex flex-col gap-3 px-4 lg:px-6">
      <div className="flex justify-between gap-6">
        <Skeleton className="h-10 w-full max-w-xl rounded" />
        <Skeleton className="h-10 w-72 rounded" />
      </div>
      <Skeleton className="h-8 w-96 max-w-full rounded-lg" />
      <Skeleton className="h-16 rounded-lg" />
      <div className="grid gap-3 @5xl/main:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-96 rounded-lg" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    </div>
  )
}
