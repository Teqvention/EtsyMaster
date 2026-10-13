"use client"

import Link from "next/link"
import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  CornerDownRightIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SearchIcon,
  SquareIcon,
  StoreIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { BreakdownChart } from "@/components/citys/breakdown-chart"
import { PlaceDetail } from "@/components/citys/place-detail"
import { TierBadge } from "@/components/citys/tier"
import { StatStrip } from "@/components/listings/stat-strip"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { Toggle } from "@/components/ui/toggle"
import { patchCitySettings, startReading, stopReading, useCityRanking } from "@/hooks/use-city-ranking"
import { scrollParent } from "@/hooks/use-infinite-listings"
import { CONTINENTS } from "@/lib/citys/geo"
import type { ReadJob } from "@/lib/citys/job"
import { TIERS, type OursCell, type RankedPlace, type Ranking, type Tier } from "@/lib/citys/types"
import { formatCompact, formatNumber, formatPercent, formatRate } from "@/lib/etsy/format"
import { cn } from "@/lib/utils"

// Which places the city shops make their money with. One row of scope on
// top (which shops count), the shape of the demand below it (city sizes,
// settings, continents, the shops' styles, custom against fixed places),
// then every place ranked: a click on any chart narrows the list, the
// search finds places by name, country, region or what they're like
// ("beach", "nature"), and a row opens on its districts and landmarks, its
// best listings and what the register says about it.

const STEP = 100
const PRELOAD = "0px 0px 1200px 0px"

const SIZE_ORDER = ["big", "mid", "small", "none"]
const SETTING_ORDER = ["city", "beach", "nature", "mountains", "lake", "island", "region"]
const CONTINENT_ORDER: string[] = [...CONTINENTS]

type ChartFilter = { size: string | null; setting: string | null; continent: string | null; country: string | null; look: string | null }
const NO_CHART: ChartFilter = { size: null, setting: null, continent: null, country: null, look: null }

type SortKey = "score" | "spm" | "favMonth" | "reviewsYear" | "shops" | "listings" | "lift" | "name"
const SORT_VALUE: Record<SortKey, (p: RankedPlace) => number | string> = {
  score: (p) => -p.position,
  spm: (p) => p.spm,
  favMonth: (p) => p.favMonth,
  reviewsYear: (p) => p.reviewsYear,
  shops: (p) => p.topShops * 1000 + p.shops,
  listings: (p) => p.listings,
  lift: (p) => p.lift,
  name: (p) => p.name,
}

const sizeKey = (p: RankedPlace) => (p.kind === "city" || p.kind === "town" ? (p.size ?? (p.kind === "town" ? "small" : "mid")) : "none")

export function RankingView() {
  const { ranking, loading, error, job, settings } = useCityRanking()
  const [search, setSearch] = React.useState("")
  const [tiers, setTiers] = React.useState<Tier[]>([])
  const [chart, setChart] = React.useState<ChartFilter>(NO_CHART)
  const [sort, setSort] = React.useState<{ key: SortKey; desc: boolean }>({ key: "score", desc: true })
  const [shown, setShown] = React.useState(STEP)
  const [open, setOpen] = React.useState<string | null>(null)
  const [openOnly, setOpenOnly] = React.useState(false)
  const searchRef = React.useRef<HTMLInputElement>(null)

  const places = React.useMemo(
    () => (ranking ? filterPlaces(ranking.places, { search, tiers, chart, openOnly, ours: ranking.ours }, sort) : []),
    [ranking, search, tiers, chart, openOnly, sort]
  )

  const more = shown < places.length
  const sentinel = React.useCallback(
    (node: HTMLElement | null) => {
      if (!node || !more) return
      const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setShown((n) => n + STEP), {
        root: scrollParent(node),
        rootMargin: PRELOAD,
      })
      observer.observe(node)
      return () => observer.disconnect()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [more, shown]
  )

  // "/" jumps to the search.
  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return
      const target = event.target as HTMLElement
      if (target.closest("input, textarea, select, [contenteditable], [role=dialog]")) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  function pick(change: Partial<ChartFilter>) {
    setChart((c) => ({ ...c, ...change }))
    setShown(STEP)
  }

  if (!ranking) {
    return (
      <div className="flex flex-col gap-3 px-4 lg:px-6">
        {error ? (
          <Empty className="min-h-[40svh] border border-dashed">
            <EmptyHeader>
              <EmptyTitle>The ranking didn&apos;t load</EmptyTitle>
              <EmptyDescription>{error}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <Skeleton className="h-8 w-[32rem] max-w-full rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-40 rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-[40svh] rounded-lg" />
          </>
        )}
      </div>
    )
  }

  const nothingRead = ranking.coverage.read === 0
  const activeChart = Object.entries(chart).filter(([, v]) => v !== null) as [keyof ChartFilter, string][]

  return (
    <div className="flex flex-col gap-3 px-4 lg:px-6">
      <ScopeBar ranking={ranking} job={job} loading={loading} secondary={settings?.scope.secondary ?? ranking.scope.secondary} />

      {nothingRead && job?.status !== "running" ? (
        <Empty className="min-h-[40svh] border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WandSparklesIcon />
            </EmptyMedia>
            <EmptyTitle>Read the city shops</EmptyTitle>
            <EmptyDescription>
              Gemini reads every listing title of the shops tagged “{ranking.scope.primary}” for the places it shows, and folds them into one register: New York and NYC become one place, Brooklyn sits under it.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => startReading().catch((e: Error) => toast.error(e.message))}>
              <WandSparklesIcon />
              Read {formatNumber(ranking.coverage.total)} listings
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <Summary ranking={ranking} />
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            <BreakdownChart
              title="City size · share of sales"
              items={ranking.breakdowns.size}
              order={SIZE_ORDER}
              active={chart.size}
              onPick={(size) => pick({ size })}
            />
            <BreakdownChart
              title="Setting · share of sales"
              items={ranking.breakdowns.setting}
              order={SETTING_ORDER}
              active={chart.setting}
              onPick={(setting) => pick({ setting })}
            />
            <BreakdownChart
              title="Continent · share of sales"
              items={ranking.breakdowns.continent}
              order={CONTINENT_ORDER}
              active={chart.continent}
              onPick={(continent) => pick({ continent })}
            />
            <BreakdownChart
              title="Shop style · share of sales"
              items={ranking.breakdowns.look}
              order={lookOrder(ranking)}
              active={chart.look}
              onPick={(look) => pick({ look })}
            />
          </div>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Countries ranking={ranking} active={chart.country} onPick={(country) => pick({ country })} />
            <ShopMix ranking={ranking} />
          </div>

          <section aria-labelledby="ranked-places" className="flex flex-col gap-3 rounded-lg border p-3">
            <h2 id="ranked-places" className="sr-only">
              Ranked places
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <InputGroup className="w-full max-w-72 sm:w-72">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  ref={searchRef}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setShown(STEP)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && search) {
                      event.stopPropagation()
                      setSearch("")
                    }
                  }}
                  placeholder="Place, country, or beach, nature…"
                  aria-label="Search places"
                  autoComplete="off"
                  spellCheck={false}
                />
                <InputGroupAddon align="inline-end">
                  {search ? (
                    <InputGroupButton size="icon-xs" aria-label="Clear the search" onClick={() => setSearch("")}>
                      <XIcon />
                    </InputGroupButton>
                  ) : (
                    <Kbd>/</Kbd>
                  )}
                </InputGroupAddon>
              </InputGroup>
              <div className="flex items-center gap-0.5" role="group" aria-label="Tiers">
                {TIERS.map((tier) => {
                  const on = tiers.includes(tier)
                  const count = ranking.breakdowns.tier.find((b) => b.key === tier)?.places ?? 0
                  return (
                    <Toggle
                      key={tier}
                      size="sm"
                      variant="outline"
                      pressed={on}
                      onPressedChange={(pressed) => {
                        setTiers((list) => (pressed ? [...list, tier] : list.filter((t) => t !== tier)))
                        setShown(STEP)
                      }}
                      className="gap-1.5 px-1.5 data-pressed:border-brand/50 data-pressed:bg-brand/5"
                      title={`${formatNumber(count)} places in tier ${tier}`}
                    >
                      <TierBadge tier={tier} className="size-4 text-[10px]" />
                      <span className="text-xs text-muted-foreground tabular-nums">{formatCompact(count)}</span>
                    </Toggle>
                  )
                })}
              </div>
              {activeChart.map(([key, value]) => (
                <Button key={key} variant="secondary" size="xs" onClick={() => pick({ [key]: null })} aria-label={`Remove filter ${value}`}>
                  {chartLabel(ranking, key, value)}
                  <XIcon data-icon="inline-end" />
                </Button>
              ))}
              <Toggle
                variant="outline"
                size="sm"
                pressed={openOnly}
                onPressedChange={(pressed) => {
                  setOpenOnly(pressed)
                  setShown(STEP)
                }}
                className="data-pressed:border-brand/50 data-pressed:bg-brand/5"
                title="Places our city shops have no confirmed listing of: the ones to make next"
              >
                Open only
              </Toggle>
              {(activeChart.length > 0 || tiers.length > 0 || search || openOnly) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => {
                    setChart(NO_CHART)
                    setTiers([])
                    setSearch("")
                    setOpenOnly(false)
                  }}
                >
                  Clear
                </Button>
              )}
              <span className="ml-auto text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {formatNumber(places.length)} {places.length === 1 ? "place" : "places"}
              </span>
            </div>

            {places.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center">
                <p className="text-sm font-medium">No place matches</p>
              </div>
            ) : (
              <PlaceTable
                ours={ranking.ours}
                places={places.slice(0, shown)}
                sort={sort}
                onSort={(key) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }))}
                open={open}
                onOpen={(id) => setOpen((o) => (o === id ? null : id))}
                all={ranking.places}
              />
            )}
            {more && <div ref={sentinel} aria-hidden className="h-px" />}
          </section>
        </>
      )}
    </div>
  )
}

/** Whether we have the place: a confirmed listing, or a live one not judged yet. */
const covered = (cell: OursCell | undefined) => !!cell && (cell.confirmed > 0 || cell.open > 0)

function filterPlaces(
  all: RankedPlace[],
  { search, tiers, chart, openOnly, ours }: { search: string; tiers: Tier[]; chart: ChartFilter; openOnly: boolean; ours?: Record<string, OursCell> },
  sort: { key: SortKey; desc: boolean }
) {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const list = all.filter((p) => {
    if (tiers.length && !tiers.includes(p.tier)) return false
    if (openOnly && covered(ours?.[p.id])) return false
    if (chart.size && sizeKey(p) !== chart.size) return false
    if (chart.setting && p.setting !== chart.setting) return false
    if (chart.continent && (p.continent ?? "Unknown") !== chart.continent) return false
    if (chart.country && p.country !== chart.country) return false
    if (chart.look && !(p.looks[chart.look] > 0)) return false
    if (words.length) {
      const text = `${p.name} ${p.countryName} ${p.country} ${p.region ?? ""} ${p.kind} ${p.setting} ${p.tags.join(" ")} ${p.children.map((c) => c.name).join(" ")}`.toLowerCase()
      if (!words.every((w) => text.includes(w))) return false
    }
    return true
  })
  const value = SORT_VALUE[sort.key]
  const dir = sort.desc ? -1 : 1
  return list.toSorted((a, b) => {
    const x = value(a)
    const y = value(b)
    const by = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number)
    return by * dir || a.position - b.position
  })
}

function lookOrder(ranking: Ranking) {
  return [...new Set(ranking.shops.flatMap((s) => s.secondary.map((t) => t)))].sort((a, b) => a.localeCompare(b))
}

function chartLabel(ranking: Ranking, key: keyof ChartFilter, value: string) {
  const list =
    key === "size"
      ? ranking.breakdowns.size
      : key === "setting"
        ? ranking.breakdowns.setting
        : key === "continent"
          ? ranking.breakdowns.continent
          : key === "country"
            ? ranking.breakdowns.country
            : ranking.breakdowns.look
  return list.find((b) => b.key === value)?.label ?? value
}

// --- Scope ---

function ScopeBar({ ranking, job, loading, secondary }: { ranking: Ranking; job: ReadJob | null; loading: boolean; secondary: string[] }) {
  const labels = lookOrder(ranking)
  const included = ranking.shops.filter((s) => s.included)

  async function setSecondary(next: string[]) {
    try {
      await patchCitySettings({ scope: { secondary: next } })
    } catch (error) {
      toast.error(`Couldn't change the scope: ${(error as Error).message}`)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ShopsPopover ranking={ranking} />
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Shop styles">
        <Toggle
          size="sm"
          variant="outline"
          pressed={secondary.length === 0}
          onPressedChange={() => setSecondary([])}
          className="data-pressed:border-brand/50 data-pressed:bg-brand/5"
        >
          All styles
        </Toggle>
        {labels.map((label) => {
          const on = secondary.some((s) => s.toLowerCase() === label.toLowerCase())
          return (
            <Toggle
              key={label}
              size="sm"
              variant="outline"
              pressed={on}
              onPressedChange={(pressed) =>
                setSecondary(pressed ? [...secondary, label] : secondary.filter((s) => s.toLowerCase() !== label.toLowerCase()))
              }
              className="capitalize data-pressed:border-brand/50 data-pressed:bg-brand/5"
            >
              {label}
            </Toggle>
          )
        })}
      </div>
      {loading && <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Loading" />}
      <ReadingStatus ranking={ranking} job={job} shops={included.length} />
    </div>
  )
}

function ShopsPopover({ ranking }: { ranking: Ranking }) {
  const included = ranking.shops.filter((s) => s.included).length
  async function toggle(shopId: number, on: boolean) {
    const excluded = ranking.scope.excluded.filter((id) => id !== shopId)
    try {
      await patchCitySettings({ scope: { excluded: on ? excluded : [...excluded, shopId] } })
    } catch (error) {
      toast.error(`Couldn't change the scope: ${(error as Error).message}`)
    }
  }
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <StoreIcon />
        {included} of {ranking.shops.length} shops
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[26rem] gap-0 p-0">
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">
          Shops tagged “{ranking.scope.primary}” on the Shops page. Untick one to leave it out of the ranking.
        </div>
        <ul className="max-h-[60svh] overflow-y-auto p-1">
          {ranking.shops.map((shop) => {
            const left = ranking.scope.excluded.includes(shop.shopId)
            return (
              <li key={shop.shopId}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm [@media(hover:hover)]:hover:bg-accent">
                  <Checkbox checked={!left} onCheckedChange={(checked) => toggle(shop.shopId, checked === true)} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate font-medium", !shop.included && "text-muted-foreground")}>{shop.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {shop.secondary.join(", ") || "no style tag"} · {formatNumber(shop.listings)} listings
                      {shop.read < shop.listings && ` · ${formatPercent(shop.listings ? shop.read / shop.listings : 0)} read`}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums" title="Sales a month, all its listings">
                    {formatRate(shop.spm)}/mo
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          More shops: tag them “{ranking.scope.primary}” on the{" "}
          <Link href="/shops" className="underline underline-offset-2">
            Shops page
          </Link>{" "}
          and analyse them; the ranking takes them in with the next read.
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ReadingStatus({ ranking, job, shops }: { ranking: Ranking; job: ReadJob | null; shops: number }) {
  const [busy, setBusy] = React.useState(false)
  const running = job?.status === "running"
  const unread = ranking.coverage.total - ranking.coverage.read

  async function start() {
    setBusy(true)
    try {
      await startReading()
    } catch (error) {
      toast.error(`Couldn't start reading: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      {running ? (
        <>
          <span className="truncate tabular-nums">
            {job.phase === "read" && job.total
              ? `Reading titles · ${formatNumber(job.done)} of ${formatNumber(job.total)}`
              : job.phase === "places" && job.total
                ? `Matching places · ${formatNumber(job.done)} of ${formatNumber(job.total)}`
                : (job.step ?? "Getting ready")}
          </span>
          {job.total > 0 && (
            <div className="h-1 w-24 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={job.total} aria-valuenow={job.done}>
              <div className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out" style={{ width: `${Math.min(100, (job.done / job.total) * 100)}%` }} />
            </div>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Stop reading" title="Stop reading" onClick={() => stopReading()}>
            <SquareIcon />
          </Button>
        </>
      ) : (
        <>
          <span className="truncate tabular-nums">
            {formatNumber(ranking.coverage.read)} listings of {shops} shops read
            {unread > 0 && ` · ${formatNumber(unread)} new`}
            {job?.status === "error" && <span className="ml-1 text-destructive">· last read failed</span>}
          </span>
          <Button variant="outline" size="sm" onClick={start} disabled={busy} className="active:scale-[0.97]">
            <RefreshCwIcon />
            Update
          </Button>
        </>
      )}
    </div>
  )
}

// --- Summary ---

function Summary({ ranking }: { ranking: Ranking }) {
  const t = ranking.totals
  const ranked = ranking.places.filter((p) => p.tier !== "F")
  const top = ranking.places.filter((p) => p.tier === "A" || p.tier === "B" || p.tier === "C")
  const topSales = top.reduce((n, p) => n + p.spm, 0)
  const placeSales = ranking.places.reduce((n, p) => n + p.spm, 0)
  return (
    <StatStrip
      stats={[
        { label: "Places with demand", value: formatNumber(ranked.filter((p) => p.score > 0).length), hint: "Places whose listings show sales, favorites or reviews" },
        {
          label: "Tier A–C",
          value: (
            <>
              {formatNumber(top.length)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">{formatPercent(placeSales ? topSales / placeSales : 0)} of sales</span>
            </>
          ),
          hint: "The places to make first, and their share of the places' sales",
        },
        { label: "Sales a month", value: formatCompact(Math.round(t.spm)), hint: "Estimated, every listing of the shops in scope, on each shop's own rates" },
        { label: "Custom", value: formatPercent(t.spm ? t.customSpm / t.spm : 0), hint: `${formatNumber(t.custom)} custom listings (the buyer picks the place): their share of sales` },
        { label: "Sets", value: formatPercent(t.spm ? t.setSpm / t.spm : 0), hint: `${formatNumber(t.sets)} sets of several places: their share of sales` },
        { label: "No place", value: formatPercent(t.spm ? t.themeSpm / t.spm : 0), hint: `${formatNumber(t.themes)} listings showing no real place (fantasy, animals…): their share of sales` },
        { label: "F · no demand", value: formatNumber(ranking.places.filter((p) => p.tier === "F").length), hint: "Places listed for months without a sale, favorite or review: not worth making" },
      ]}
    />
  )
}

// --- Countries and shops ---

function Countries({ ranking, active, onPick }: { ranking: Ranking; active: string | null; onPick: (country: string | null) => void }) {
  const list = ranking.breakdowns.country.slice(0, 12)
  const max = Math.max(...list.map((b) => b.spm), 0) || 1
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg border p-3" aria-label="Top countries">
      <h3 className="text-xs font-medium text-muted-foreground">Top countries · sales a month</h3>
      <ul className="flex flex-col gap-1">
        {list.map((b) => {
          const on = active === b.key
          return (
            <li key={b.key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onPick(on ? null : b.key)}
                className={cn(
                  "group/bar grid w-full grid-cols-[8rem_minmax(0,1fr)_3.5rem] items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:bg-accent",
                  on && "bg-accent"
                )}
                title={`${b.label}: ${formatNumber(b.places)} places, ${formatRate(b.spm)} sales a month`}
              >
                <span className={cn("truncate", on && "font-medium")}>{b.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-r-[4px] bg-series-1" style={{ width: `${(b.spm / max) * 100}%` }} />
                </span>
                <span className="text-right font-medium tabular-nums">{formatRate(b.spm)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const MIX = [
  { key: "place", label: "One place", color: "var(--series-1)" },
  { key: "set", label: "Sets", color: "var(--series-2)" },
  { key: "custom", label: "Custom", color: "var(--series-3)" },
  { key: "theme", label: "No place", color: "var(--muted-foreground)" },
] as const

function ShopMix({ ranking }: { ranking: Ranking }) {
  const shops = ranking.shops.filter((s) => s.included && s.spm > 0).slice(0, 14)
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg border p-3" aria-label="What the shops sell">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="mr-auto text-xs font-medium text-muted-foreground">What each shop sells · share of its sales</h3>
        {MIX.map((m) => (
          <span key={m.key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: m.color }} />
            {m.label}
          </span>
        ))}
      </div>
      <ul className="flex flex-col gap-1">
        {shops.map((s) => {
          const shares = {
            place: Math.max(0, 1 - s.customShare - s.setShare - s.themeShare),
            set: s.setShare,
            custom: s.customShare,
            theme: s.themeShare,
          }
          return (
            <li key={s.shopId} className="grid grid-cols-[9rem_minmax(0,1fr)_3.5rem] items-center gap-2 px-1.5 text-xs">
              <span className={cn("truncate", !s.read && "text-muted-foreground")} title={s.secondary.join(", ")}>
                {s.name}
              </span>
              <span className="flex h-2.5 gap-[2px] overflow-hidden rounded-[4px]" title={MIX.map((m) => `${m.label} ${formatPercent(shares[m.key])}`).join(" · ")}>
                {MIX.map((m) =>
                  shares[m.key] > 0.004 ? (
                    <span key={m.key} className="h-full first:rounded-l-[4px] last:rounded-r-[4px]" style={{ width: `${shares[m.key] * 100}%`, background: m.color }} />
                  ) : null
                )}
              </span>
              <span className="text-right text-muted-foreground tabular-nums">{formatRate(s.spm)}/mo</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// --- The table ---

const COLUMNS: { key: SortKey; label: string; hint: string; className?: string }[] = [
  { key: "score", label: "Score", hint: "0–100 against every place with demand: sales, favorites, reviews, breadth over shops, sales per listing, momentum", className: "w-24" },
  { key: "spm", label: "Sales/mo", hint: "Estimated sales a month over the last year, all its listings in scope, on each shop's own rates", className: "w-20 text-right" },
  { key: "favMonth", label: "Favs/mo", hint: "Favorites a month since each listing went up", className: "w-18 text-right" },
  { key: "reviewsYear", label: "Reviews", hint: "Reviews in the last 12 months: actual buyers", className: "w-18 text-right" },
  { key: "shops", label: "Shops", hint: "Shops where it's in their top quarter / shops selling it", className: "w-18 text-right" },
  { key: "listings", label: "Listings", hint: "Listings showing it; a set counts a share", className: "w-18 text-right" },
  { key: "lift", label: "Per listing", hint: "Sales per listing against the average listing: over 1 sells from few listings (room), under 1 is crowded", className: "w-20 text-right" },
]

function PlaceTable({
  places,
  sort,
  onSort,
  open,
  onOpen,
  all,
  ours,
}: {
  ours?: Record<string, OursCell>
  places: RankedPlace[]
  sort: { key: SortKey; desc: boolean }
  onSort: (key: SortKey) => void
  open: string | null
  onOpen: (id: string) => void
  all: RankedPlace[]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="w-10 pb-2 text-left font-normal">#</th>
            <th className="pb-2 text-left font-normal">
              <SortButton label="Place" active={sort.key === "name"} desc={sort.desc} onClick={() => onSort("name")} />
            </th>
            {COLUMNS.map((c) => (
              <th key={c.key} className={cn("pb-2 font-normal", c.className)} title={c.hint}>
                <SortButton label={c.label} active={sort.key === c.key} desc={sort.desc} onClick={() => onSort(c.key)} align={c.className?.includes("text-right") ? "right" : "left"} />
              </th>
            ))}
            <th className="w-20 pb-2 pl-4 text-left font-normal" title="Our city shops' listings of it: confirmed, to replace; open when we have none confirmed">
              Ours
            </th>
            <th className="w-32 pb-2 pl-3 text-left font-normal">Best listings</th>
          </tr>
        </thead>
        <tbody>
          {places.map((p) => (
            <PlaceRow key={p.id} place={p} open={open === p.id} onOpen={() => onOpen(p.id)} all={all} ours={ours?.[p.id]} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SortButton({ label, active, desc, onClick, align = "left" }: { label: string; active: boolean; desc: boolean; onClick: () => void; align?: "left" | "right" }) {
  const Icon = desc ? ArrowDownIcon : ArrowUpIcon
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:text-foreground",
        active && "text-foreground",
        align === "right" && "flex-row-reverse"
      )}
    >
      {label}
      {active && <Icon className="size-3" />}
    </button>
  )
}

const KIND_LABEL: Record<string, string> = {
  city: "City",
  town: "Town",
  district: "District",
  landmark: "Landmark",
  beach: "Beach",
  island: "Island",
  park: "Park",
  mountain: "Mountain",
  lake: "Lake",
  coast: "Coast",
  region: "Region",
  state: "State",
  country: "Country",
}
const SIZE_LABEL: Record<string, string> = { big: "big", mid: "mid-size", small: "small" }

export function placeLine(p: Pick<RankedPlace, "kind" | "size" | "countryName" | "region">) {
  const kind = p.size && (p.kind === "city" || p.kind === "town") ? `${SIZE_LABEL[p.size]} ${p.kind}` : KIND_LABEL[p.kind]
  return [kind.charAt(0).toUpperCase() + kind.slice(1), p.region, p.countryName].filter(Boolean).join(" · ")
}

/** What we have of a place, as one quiet cell: confirmed listings in green, ones to replace in amber, open as a dash. */
function OursCellView({ cell }: { cell: OursCell | undefined }) {
  if (!cell || (!cell.confirmed && !cell.replace && !cell.open)) return <span className="text-xs text-muted-foreground/60" title="Open: none of ours">Open</span>
  return (
    <span className="flex items-center gap-2 text-xs tabular-nums">
      {cell.confirmed + cell.open > 0 && (
        <span className="inline-flex items-center gap-1" title={`${cell.confirmed} confirmed${cell.open ? `, ${cell.open} not judged yet` : ""}`}>
          <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
          {cell.confirmed + cell.open}
        </span>
      )}
      {cell.replace > 0 && (
        <span className="inline-flex items-center gap-1 text-muted-foreground" title={`${cell.replace} to replace`}>
          <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
          {cell.replace}
        </span>
      )}
    </span>
  )
}

function PlaceRow({ place: p, open, onOpen, all, ours }: { place: RankedPlace; open: boolean; onOpen: () => void; all: RankedPlace[]; ours?: OursCell }) {
  // A sub-place sold by its own name sits right under its city, indented.
  const sub = p.sub
  return (
    <>
      <tr
        onClick={onOpen}
        className={cn(
          "group/row cursor-pointer [&>td]:border-t [&>td]:py-2 [@media(hover:hover)]:hover:bg-accent/40",
          open && "bg-accent/40"
        )}
      >
        <td className="pr-2 align-top text-xs text-muted-foreground tabular-nums">
          {sub ? <CornerDownRightIcon className="ml-auto size-3.5 text-muted-foreground/70" aria-label={`Under ${sub.parentName}`} /> : p.position}
        </td>
        <td className={cn("min-w-0 pr-3 align-top", sub && "pl-4")}>
          <div className="flex min-w-0 items-start gap-2">
            <TierBadge tier={p.tier} className="mt-px" />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  className="truncate text-left font-medium outline-none focus-visible:underline"
                  aria-expanded={open}
                  onClick={(event) => {
                    event.stopPropagation()
                    onOpen()
                  }}
                >
                  {p.name}
                </button>
                {p.children.length > 0 && !sub && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground tabular-nums" title={p.children.map((c) => c.name).join(", ")}>
                    <ChevronRightIcon className={cn("size-3 transition-transform duration-150 ease-out", open && "rotate-90")} />
                    {p.children.length}
                  </span>
                )}
                {sub && (
                  <span
                    className="shrink-0 rounded-full bg-brand/10 px-1.5 text-[10px] font-medium text-brand"
                    title={
                      sub.test
                        ? "Buyers seek it by its own name, but most of that is one listing: one test poster first"
                        : "Buyers seek it by its own name in several shops: a poster and listing of its own, its name on the poster"
                    }
                  >
                    {sub.test ? "Test poster first" : "Own poster"}
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <span className="truncate">{sub ? `${KIND_LABEL[p.kind] ?? p.kind} in ${sub.parentName}${sub.leads ? `, most of its sales` : ""} · by its own name` : placeLine(p)}</span>
                {p.tags.slice(0, 3).map((t) => (
                  <span key={t} className="rounded-sm bg-muted px-1 text-[10px]">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </td>
        <td className="pr-3 align-top">
          <div className="flex items-center gap-2">
            <span className="w-6 text-right text-xs font-semibold tabular-nums">{p.score}</span>
            <div className="h-1 w-12 overflow-hidden rounded-full bg-brand/15">
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(p.score, 2)}%` }} />
            </div>
          </div>
        </td>
        <td className="pr-3 text-right align-top font-medium tabular-nums">{formatRate(p.spm)}</td>
        <td className="pr-3 text-right align-top tabular-nums">{formatRate(p.favMonth)}</td>
        <td className="pr-3 text-right align-top tabular-nums">{p.reviewsYear ? formatRate(p.reviewsYear) : "–"}</td>
        <td className="pr-3 text-right align-top tabular-nums">
          {p.topShops}
          <span className="text-muted-foreground">/{p.shops}</span>
        </td>
        <td className="pr-3 text-right align-top tabular-nums">{formatCompact(p.listings)}</td>
        <td className={cn("pr-3 text-right align-top tabular-nums", p.lift >= 1.3 ? "text-emerald-700 dark:text-emerald-400" : p.lift < 0.8 && "text-muted-foreground")}>
          {p.lift.toFixed(1)}×
        </td>
        <td className="pr-3 pl-4 align-top">
          <OursCellView cell={ours} />
        </td>
        <td className="pl-3 align-top">
          <div className="flex -space-x-1.5">
            {p.top.slice(0, 4).map((l) =>
              l.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={l.listingId}
                  src={l.image}
                  alt=""
                  title={`${l.title} · ${l.shop} · ${formatRate(l.spm)} sales/mo`}
                  loading="lazy"
                  className="size-7 rounded-md border-2 border-background bg-muted object-cover"
                />
              ) : null
            )}
          </div>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={11} className="border-t bg-accent/20 px-2 py-3">
            <PlaceDetail place={p} all={all} />
          </td>
        </tr>
      )}
    </>
  )
}
