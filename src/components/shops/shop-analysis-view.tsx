"use client"

import Image from "next/image"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import { ExternalLinkIcon, MapPinIcon, StarIcon, StoreIcon, XIcon } from "lucide-react"

import { ListingGrid } from "@/components/listings/listing-grid"
import { SplitView } from "@/components/listings/split-view"
import { RecentShops } from "@/components/shops/recent-shops"
import { ScopePanel } from "@/components/shops/scope-panel"
import { ShopInsightsView } from "@/components/shops/shop-insights"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { notifyEtsyRequest } from "@/hooks/use-etsy-usage"
import { useLikes } from "@/hooks/use-likes"
import { cachedRun, useShopAnalysis } from "@/hooks/use-shop-analysis"
import {
  getShopVisit,
  recordShopAnalysis,
  recordShopVisit,
  useShopHistory,
} from "@/hooks/use-shop-history"
import {
  analyse,
  applyReviews,
  countByListing,
  defaultPlan,
  type AnalysisPlan,
} from "@/lib/etsy/analysis"
import { formatCompact, formatNumber } from "@/lib/etsy/format"
import type { Listing, ListingShop } from "@/lib/etsy/types"

// Analyse one shop: look it up, choose how much of it to fetch, then read
// what sells. The shop lives in the URL (`?shop=`), so an analysis can be
// linked to and reloaded; reopening a shop starts from the scope it was last
// analysed with.

export function ShopAnalysisView({ currency }: { currency: string }) {
  const searchParams = useSearchParams()
  const query = searchParams.get("shop")?.trim() ?? ""
  const lookup = useShopLookup(query)
  const shop = lookup.shop

  function open(next: string) {
    const params = new URLSearchParams()
    if (next) params.set("shop", next)
    const search = params.toString()
    window.history.pushState(null, "", search ? `?${search}` : window.location.pathname)
  }

  return (
    <div className="flex flex-col gap-3">
      <ShopSearch key={query} query={query} onSubmit={open} />

      {!query ? (
        <div className="px-4 lg:px-6">
          <Welcome currency={currency} onPick={open} />
        </div>
      ) : lookup.error ? (
        <div className="px-4 lg:px-6">
          <Empty className="min-h-[40svh] border border-dashed">
            <EmptyHeader>
              <EmptyTitle>{lookup.error}</EmptyTitle>
              <EmptyDescription>
                Use the shop&apos;s exact name, its numeric id, or a link to its Etsy page.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : !shop ? (
        <div className="flex flex-col gap-3 px-4 lg:px-6">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-36 rounded-lg" />
        </div>
      ) : (
        <ShopAnalysis key={shop.id} shop={shop} currency={currency} />
      )}
    </div>
  )
}

function ShopAnalysis({ shop, currency }: { shop: ListingShop; currency: string }) {
  const [plan, setPlan] = React.useState<AnalysisPlan>(() => lastPlan(shop) ?? defaultPlan(shop))
  const { run, start, stop } = useShopAnalysis()
  const [tag, setTag] = React.useState<string | null>(null)

  React.useEffect(() => recordShopVisit(shop), [shop])

  // Back to a shop analysed earlier this session: show it straight away.
  React.useEffect(() => {
    if (cachedRun(shop.id, plan)) start(shop.id, plan)
    // Only on arrival; later plan changes wait for the Analyse button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.id, start])

  const reviews = run && run.plan.reviews !== "none" ? run.reviews : null
  // Exact review counts need every review there is, all of them loaded.
  const sharpened = run?.plan.reviews === "all" && run.status === "done"

  const listings = React.useMemo(() => {
    if (!run) return []
    return sharpened ? applyReviews(run.listings, run.reviews) : run.listings
  }, [run, sharpened])

  const recentReviews = React.useMemo(() => (reviews ? countByListing(reviews) : null), [reviews])
  const insights = React.useMemo(() => analyse(listings, currency), [listings, currency])

  // Once a run settles, remember what it found for the recent shops list.
  const settled = run !== null && run.status !== "running" && run.status !== "idle"
  React.useEffect(() => {
    if (!settled || !run || listings.length === 0) return
    const top = [...listings]
      .sort((a, b) => b.estimate.revenuePerMonthCents - a.estimate.revenuePerMonthCents)
      .slice(0, 3)
    recordShopAnalysis(shop, {
      plan: run.plan,
      listings: listings.length,
      complete: run.status === "done",
      revenuePerMonthCents: insights.revenuePerMonthCents,
      salesPerMonth: insights.salesPerMonth,
      top: top.map((l) => ({ title: l.title, thumb: l.images[0]?.thumb ?? null })),
      analysedAt: new Date().toISOString(),
    })
  }, [settled, run, listings, insights, shop])

  return (
    <SplitView listings={listings}>
      <div className="flex flex-col gap-3">
        <ShopHeader shop={shop} />
        <ScopePanel
          shop={shop}
          plan={plan}
          run={run}
          onPlanChange={setPlan}
          onStart={() => start(shop.id, plan)}
          onStop={stop}
        />

        {run?.error && run.listings.length === 0 && (
          <p className="text-sm text-destructive">{run.error}</p>
        )}

        {listings.length > 0 && (
          <>
            <ShopInsightsView
              shop={shop}
              listings={listings}
              insights={insights}
              reviews={reviews}
              reviewWindow={run!.plan.reviews}
              recentReviews={recentReviews}
              sharpened={sharpened}
              currency={currency}
              activeTag={tag}
              onTag={setTag}
            />
            <AllListings
              listings={listings}
              recentReviews={recentReviews}
              loading={run?.status === "running"}
              tag={tag}
              onClearTag={() => setTag(null)}
            />
          </>
        )}
      </div>
    </SplitView>
  )
}

/** The scope the shop was last analysed with, fitted to its current size. */
function lastPlan(shop: ListingShop): AnalysisPlan | null {
  const plan = getShopVisit(shop.id)?.analysis?.plan
  if (!plan) return null
  return { ...plan, limit: Math.max(1, Math.min(plan.limit, shop.activeListings)) }
}

// --- Lookup ---

const lookups = new Map<string, ListingShop>()

function useShopLookup(query: string) {
  const [result, setResult] = React.useState<{
    query: string
    shop: ListingShop | null
    error: string | null
  } | null>(null)

  React.useEffect(() => {
    if (!query || lookups.has(query.toLowerCase())) return
    let cancelled = false
    fetch(`/api/shops?q=${encodeURIComponent(query)}`)
      .then(async (res) => {
        notifyEtsyRequest()
        const data = await res.json()
        if (res.status === 404) throw new Error(`No shop called “${query}”`)
        if (!res.ok) throw new Error(data.error ?? res.statusText)
        return data as ListingShop
      })
      .then((shop) => {
        lookups.set(query.toLowerCase(), shop)
        if (!cancelled) setResult({ query, shop, error: null })
      })
      .catch((e: Error) => {
        if (!cancelled) setResult({ query, shop: null, error: e.message })
      })
    return () => {
      cancelled = true
    }
  }, [query])

  const cached = lookups.get(query.toLowerCase())
  const current = result?.query === query ? result : null
  return { shop: cached ?? current?.shop ?? null, error: cached ? null : (current?.error ?? null) }
}

function ShopSearch({ query, onSubmit }: { query: string; onSubmit: (query: string) => void }) {
  const [draft, setDraft] = React.useState(query)
  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(draft.trim())
      }}
      className="flex items-center gap-2 px-4 lg:px-6"
    >
      <div className="relative max-w-xl min-w-0 flex-1">
        <StoreIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Shop name or etsy.com/shop/… link"
          aria-label="Shop"
          className="pl-8"
          autoFocus={!query}
        />
      </div>
      <Button type="submit" disabled={!draft.trim()}>
        Look up
      </Button>
    </form>
  )
}

const subscribeNever = () => () => {}

// Shops opened before, or, the first time round, the shops behind saved
// listings as first picks.
function Welcome({ currency, onPick }: { currency: string; onPick: (shop: string) => void }) {
  const likes = useLikes()
  const history = useShopHistory()
  const hydrated = React.useSyncExternalStore(subscribeNever, () => true, () => false)
  const visits = React.useMemo(
    () => Object.values(history).sort((a, b) => b.viewedAt.localeCompare(a.viewedAt)),
    [history]
  )
  const shops = React.useMemo(() => {
    const seen = new Set(visits.map((v) => v.shop.name.toLowerCase()))
    const counts = new Map<string, number>()
    for (const { listing } of Object.values(likes)) {
      const name = listing.shop?.name
      if (name && !seen.has(name.toLowerCase())) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name]) => name)
  }, [likes, visits])

  // localStorage is only readable after hydration; render nothing until then
  // rather than flash the empty state.
  if (!hydrated) return null

  if (visits.length > 0) {
    return (
      <div className="flex flex-col gap-3">
        <RecentShops visits={visits} currency={currency} onPick={onPick} />
        {shops.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>From saved listings</span>
            {shops.map((name) => (
              <Button key={name} variant="outline" size="xs" onClick={() => onPick(name)}>
                {name}
              </Button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <Empty className="min-h-[50svh] border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <StoreIcon />
        </EmptyMedia>
        <EmptyTitle>See what sells in any shop</EmptyTitle>
        <EmptyDescription>
          Pick how much of a shop to analyse, and get its best sellers, price sweet spots,
          winning tags and sales trend.
        </EmptyDescription>
      </EmptyHeader>
      {shops.length > 0 && (
        <EmptyContent className="flex-row flex-wrap justify-center">
          {shops.map((name) => (
            <Button key={name} variant="outline" size="sm" onClick={() => onPick(name)}>
              {name}
            </Button>
          ))}
        </EmptyContent>
      )}
    </Empty>
  )
}

// --- Shop ---

function ShopHeader({ shop }: { shop: ListingShop }) {
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted">
          {shop.iconUrl ? (
            <Image src={shop.iconUrl} alt="" fill unoptimized sizes="44px" className="object-cover" />
          ) : (
            <StoreIcon className="size-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <a
            href={shop.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-base font-semibold underline-offset-2 hover:underline"
          >
            <span className="truncate">{shop.name}</span>
            <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
          </a>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {shop.country && (
              <span className="flex items-center gap-0.5">
                <MapPinIcon className="size-3" />
                {shop.country}
              </span>
            )}
            <span>Since {new Date(shop.openedAt).getUTCFullYear()}</span>
            {shop.reviewCount > 0 && (
              <span className="flex items-center gap-0.5 tabular-nums">
                <StarIcon className="size-3 fill-current" />
                {shop.reviewAverage.toFixed(2)} ({formatCompact(shop.reviewCount)})
              </span>
            )}
          </div>
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs tabular-nums sm:ml-auto">
        <Fact label="Sales, lifetime" value={shop.totalSales ? formatCompact(shop.totalSales) : "Hidden"} />
        <Fact label="Active listings" value={formatCompact(shop.activeListings)} />
        <Fact label="Shop favorites" value={formatCompact(shop.favorites)} />
      </dl>
    </header>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold">{value}</dd>
    </div>
  )
}

// --- Every analysed listing ---

type SortKey = "revenue" | "sales" | "recent" | "favorites" | "price" | "newest"

const SORTS: { value: SortKey; label: string; by: (l: Listing, recent: Map<number, number> | null) => number }[] = [
  { value: "revenue", label: "Revenue / mo", by: (l) => l.estimate.revenuePerMonthCents },
  { value: "sales", label: "Sales / mo", by: (l) => l.estimate.salesPerMonth },
  { value: "recent", label: "Recent reviews", by: (l, recent) => recent?.get(l.id) ?? 0 },
  { value: "favorites", label: "Favorites", by: (l) => l.favorites },
  { value: "price", label: "Price", by: (l) => l.priceCents },
  { value: "newest", label: "Newest", by: (l) => -l.ageDays },
]

// Rendering a few thousand cards at once would stall the page; reveal them in steps.
const STEP = 60

function AllListings({
  listings,
  recentReviews,
  loading,
  tag,
  onClearTag,
}: {
  listings: Listing[]
  recentReviews: Map<number, number> | null
  loading: boolean
  tag: string | null
  onClearTag: () => void
}) {
  const [sort, setSort] = React.useState<SortKey>("revenue")
  const [shown, setShown] = React.useState(STEP)
  const sorts = SORTS.filter((s) => s.value !== "recent" || recentReviews)

  const sorted = React.useMemo(() => {
    const { by } = SORTS.find((s) => s.value === sort)!
    const filtered = tag
      ? listings.filter((l) => l.tags.some((t) => t.toLowerCase().trim() === tag))
      : listings
    return [...filtered].sort((a, b) => by(b, recentReviews) - by(a, recentReviews))
  }, [listings, recentReviews, sort, tag])

  return (
    <section className="flex flex-col gap-3 pt-3" aria-labelledby="all-listings">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="all-listings" className="text-sm font-medium tabular-nums">
            {formatNumber(sorted.length)} {tag ? "tagged" : "analysed"} listings
          </h2>
          {tag && (
            <Button variant="secondary" size="xs" onClick={onClearTag} aria-label={`Clear tag ${tag}`}>
              {tag}
              <XIcon data-icon="inline-end" />
            </Button>
          )}
        </div>
        <Select value={sort} items={sorts} onValueChange={(value) => value && setSort(value as SortKey)}>
          <SelectTrigger size="sm" className="w-40" aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sorts.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ListingGrid listings={sorted.slice(0, shown)} loading={loading && shown >= sorted.length} />

      {shown < sorted.length && (
        <Button variant="outline" className="self-center" onClick={() => setShown((n) => n + STEP)}>
          Show {formatNumber(Math.min(STEP, sorted.length - shown))} more
          <span className="text-muted-foreground tabular-nums">
            of {formatNumber(sorted.length - shown)}
          </span>
        </Button>
      )}
    </section>
  )
}
