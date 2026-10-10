"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import {
  CalendarIcon,
  ChevronDownIcon,
  CircleDollarSignIcon,
  FolderIcon,
  ImagesIcon,
  LoaderCircleIcon,
  PowerIcon,
  RefreshCwIcon,
  SearchIcon,
  Settings2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { StatStrip } from "@/components/listings/stat-strip"
import { SelectionBar } from "@/components/selection"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { syncNow, useArtikel, type ArtikelQuery } from "@/hooks/use-artikel"
import { scrollParent } from "@/hooks/use-infinite-listings"
import { useSelection } from "@/hooks/use-selection"
import { formatNumber } from "@/lib/etsy/format"
import type { ArtikelState } from "@/lib/artikel/types"
import type { SyncStatus } from "@/lib/sync/types"
import { cn } from "@/lib/utils"

import { ActionDialog, targetChoices, type ActionKind } from "./action-dialog"
import { ActionsPanel } from "./actions-panel"
import { ArtikelTable, SORT_VALUE, type Sort, type SortKey } from "./artikel-table"
import { ListingSheet } from "./listing-sheet"
import { ago, Est, money, plural, shortDate, Signed, STATE_LABEL } from "./shared"
import { TagManager, TagsPopover } from "./tags-menu"

// Every listing of our shops with its numbers over a date range, from the
// daily sync: what it was seen, liked and sold, and what the sales left after
// Etsy's fees and Gelato. Filtered and sorted in the browser; picked listings
// (or a whole shop, tag or section) get bulk actions that run on Etsy in the
// background.

const DAY = 24 * 60 * 60 * 1000
const STEP = 100
const PRELOAD_MARGIN = "0px 0px 1200px 0px"
const PRESETS = ["7", "30", "90"] as const

const localDay = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
const dayMs = (key: string) => new Date(`${key}T12:00:00`).getTime()

const noSubscribe = () => () => {}

/** Today's key in the browser; empty while prerendering. */
function useToday() {
  return React.useSyncExternalStore(noSubscribe, () => localDay(Date.now()), () => "")
}

/** A search param kept in the address, so a reload or link lands on the same view. */
function useParams() {
  const searchParams = useSearchParams()
  const set = React.useCallback((changes: Record<string, string | null>) => {
    const params = new URLSearchParams(window.location.search)
    for (const [name, value] of Object.entries(changes)) {
      if (value === null) params.delete(name)
      else params.set(name, value)
    }
    const query = params.toString()
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
  }, [])
  return [searchParams, set] as const
}

type Filters = { search: string; state: string; section: string; tag: string; withSales: boolean }
const NO_FILTERS: Filters = { search: "", state: "all", section: "all", tag: "all", withSales: false }

export function ArtikelView() {
  const [searchParams, setParams] = useParams()
  const today = useToday()
  const account = searchParams.get("shop")
  const preset = searchParams.get("range")
  const customFrom = searchParams.get("from")
  const customTo = searchParams.get("to")
  const custom = !!customFrom && !!customTo && /^\d{4}-\d{2}-\d{2}$/.test(customFrom) && /^\d{4}-\d{2}-\d{2}$/.test(customTo)
  const days = PRESETS.includes(preset as (typeof PRESETS)[number]) ? Number(preset) : 30

  const query: ArtikelQuery | null = today
    ? custom
      ? { account, from: customFrom! <= customTo! ? customFrom! : customTo!, to: customTo! >= customFrom! ? customTo! : customFrom! }
      : { account, from: localDay(dayMs(today) - (days - 1) * DAY), to: today }
    : null
  const { state, loading, error, actions } = useArtikel(query)

  const [filters, setFilters] = React.useState<Filters>(NO_FILTERS)
  const [sort, setSort] = React.useState<Sort>({ key: "revenue", desc: true })
  const [shown, setShown] = React.useState(STEP)
  const [openId, setOpenId] = React.useState<number | null>(null)
  const [launch, setLaunch] = React.useState<{ kind: ActionKind; ids?: number[] } | null>(null)
  const [managingTags, setManagingTags] = React.useState(false)
  const search = React.useRef<HTMLInputElement>(null)

  const rows = React.useMemo(() => (state ? filterRows(state, filters, sort) : []), [state, filters, sort])
  const keys = React.useMemo(() => rows.map((r) => r.listingId), [rows])
  const selection = useSelection(keys)
  const tags = React.useMemo(() => new Map((state?.tags ?? []).map((t) => [t.id, t])), [state?.tags])

  // Infinite scroll: grow the table when the sentinel nears the viewport. Re-observing on every
  // growth keeps loading while the sentinel stays in view.
  const more = shown < rows.length
  const sentinel = React.useCallback(
    (node: HTMLElement | null) => {
      if (!node || !more) return
      const observer = new IntersectionObserver(
        ([entry]) => entry.isIntersecting && setShown((n) => n + STEP),
        { root: scrollParent(node), rootMargin: PRELOAD_MARGIN }
      )
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
      search.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  function filter(change: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...change }))
    setShown(STEP)
  }

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "title" && key !== "section" && key !== "endsAt" }))
    setShown(STEP)
  }

  if (!state) {
    return (
      <div className="flex flex-col gap-3 px-4 lg:px-6">
        {error ? (
          <Empty className="min-h-[40svh] border border-dashed">
            <EmptyHeader>
              <EmptyTitle>Artikel didn&apos;t load</EmptyTitle>
              <EmptyDescription>{error}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <Skeleton className="h-8 w-[28rem] max-w-full rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-[50svh] rounded-lg" />
          </>
        )}
      </div>
    )
  }

  const range = state.range
  const openRow = openId !== null ? (state.rows.find((r) => r.listingId === openId) ?? null) : null
  const picked = [...selection.selected]
  const launchIds = launch?.ids ?? picked
  const choices = launch ? targetChoices(state, launchIds, account) : []
  const defaultTarget = launchIds.length ? "listings" : account ? `shop:${account}` : state.shops.length === 1 ? `shop:${state.shops[0].account}` : "all"
  const neverSynced = state.sync.every((s) => !s.listings)

  return (
    <div className="flex flex-col gap-3 px-4 lg:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <ShopSelect state={state} account={account} onChange={(next) => setParams({ shop: next })} />
        <RangePicker
          days={custom ? null : days}
          range={range}
          today={today}
          onPreset={(next) => setParams({ range: next === 30 ? null : String(next), from: null, to: null })}
          onCustom={(from, to) => setParams({ range: null, from, to })}
        />
        {loading && <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Loading" />}
        <SyncStatusLine sync={state.sync} account={account} />
      </div>

      {state.shops.length === 0 ? (
        <Empty className="min-h-[40svh] border border-dashed">
          <EmptyHeader>
            <EmptyTitle>No shop of ours is linked yet</EmptyTitle>
            <EmptyDescription>Link a shop to an account under Settings and connect it to Etsy: its listings and numbers come in with the next sync.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" nativeButton={false} render={<Link href="/settings" />}>
              <Settings2Icon />
              Settings
            </Button>
          </EmptyContent>
        </Empty>
      ) : neverSynced && state.rows.length === 0 ? (
        <NotSynced sync={state.sync} />
      ) : (
        <>
          <Notices state={state} />
          <Summary state={state} />
          {actions && actions.length > 0 && <ActionsPanel actions={actions} />}

          <section aria-labelledby="artikel-listings" className="flex flex-col gap-3 rounded-lg border p-3">
            <h2 id="artikel-listings" className="sr-only">
              Listings
            </h2>
            <FilterBar
              state={state}
              account={account}
              filters={filters}
              onFilter={filter}
              count={rows.length}
              searchRef={search}
              onManageTags={() => setManagingTags(true)}
              onBulk={(kind) => setLaunch({ kind, ids: [] })}
            />
            {rows.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center">
                <p className="text-sm font-medium">No listing matches</p>
                <Button size="sm" variant="ghost" onClick={() => filter(NO_FILTERS)}>
                  Clear the filters
                </Button>
              </div>
            ) : (
              <ArtikelTable
                rows={rows.slice(0, shown)}
                sort={sort}
                onSort={toggleSort}
                selection={selection}
                tags={tags}
                showShop={!account && state.shops.length > 1}
                openId={openId}
                onOpen={setOpenId}
                now={dayMs(today)}
              />
            )}
            {more && <div ref={sentinel} aria-hidden className="h-px" />}
          </section>
        </>
      )}

      <SelectionBar count={selection.count} total={rows.length} onSelectAll={selection.selectAll} onClear={selection.clear}>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
            <CircleDollarSignIcon />
            Price
            <ChevronDownIcon className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" sideOffset={8}>
            <DropdownMenuItem onClick={() => setLaunch({ kind: "price" })}>Raise or lower…</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLaunch({ kind: "profile" })}>Apply a price profile…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="sm" onClick={() => setLaunch({ kind: "section" })}>
          <FolderIcon />
          Section
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setLaunch({ kind: "state" })}>
          <PowerIcon />
          State
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
            <ImagesIcon />
            Photos
            <ChevronDownIcon className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" sideOffset={8}>
            <DropdownMenuItem onClick={() => setLaunch({ kind: "reorderPhotos" })}>Change the order…</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLaunch({ kind: "swapPhoto" })}>Swap one photo…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <TagsPopover picked={picked} rows={state.rows} tags={state.tags} />
      </SelectionBar>

      <ActionDialog
        kind={launch?.kind ?? null}
        onClose={() => setLaunch(null)}
        state={state}
        choices={choices}
        defaultTarget={defaultTarget}
      />
      <ListingSheet
        row={openRow}
        range={range}
        tags={tags}
        onClose={() => setOpenId(null)}
        onAction={(kind, listingId) => setLaunch({ kind, ids: [listingId] })}
      />
      <TagManager open={managingTags} onOpenChange={setManagingTags} tags={state.tags} rows={state.rows} />
    </div>
  )
}

function filterRows(state: ArtikelState, f: Filters, sort: Sort) {
  const words = f.search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const filtered = state.rows.filter((r) => {
    if (f.state !== "all" && r.state !== f.state) return false
    if (f.section === "none" ? r.sectionId !== null : f.section !== "all" && `${r.account}:${r.sectionId}` !== f.section) return false
    if (f.tag === "none" ? r.tags.length > 0 : f.tag !== "all" && !r.tags.includes(f.tag)) return false
    if (f.withSales && r.sales === 0) return false
    if (words.length) {
      const text = `${r.title} ${r.listingId} ${r.section ?? ""}`.toLowerCase()
      if (!words.every((w) => text.includes(w))) return false
    }
    return true
  })
  const value = SORT_VALUE[sort.key]
  const dir = sort.desc ? -1 : 1
  return filtered.toSorted((a, b) => {
    const x = value(a)
    const y = value(b)
    const by = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number)
    return by * dir || b.views - a.views || a.listingId - b.listingId
  })
}

// --- Toolbar ---

function ShopSelect({ state, account, onChange }: { state: ArtikelState; account: string | null; onChange: (account: string | null) => void }) {
  const items = [
    { value: "all", label: "All shops" },
    ...state.shops.map((s) => ({ value: s.account, label: s.shop })),
  ]
  return (
    <Select value={account ?? "all"} items={items} onValueChange={(value) => value && onChange(value === "all" ? null : value)}>
      <SelectTrigger size="sm" className="min-w-36" aria-label="Shop">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RangePicker({
  days,
  range,
  today,
  onPreset,
  onCustom,
}: {
  days: number | null
  range: { from: string; to: string }
  today: string
  onPreset: (days: number) => void
  onCustom: (from: string, to: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [from, setFrom] = React.useState(range.from)
  const [to, setTo] = React.useState(range.to)
  const valid = !!from && !!to && from <= to && to <= today
  return (
    <div className="flex items-center gap-1">
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={0}
        value={days ? [String(days)] : []}
        onValueChange={(value) => value[0] && onPreset(Number(value[0]))}
        aria-label="Date range"
      >
        {PRESETS.map((p) => (
          <ToggleGroupItem key={p} value={p} className="tabular-nums">
            {p} days
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) {
            setFrom(range.from)
            setTo(range.to)
          }
        }}
      >
        <PopoverTrigger
          render={<Button variant={days ? "ghost" : "outline"} size="sm" className={cn("tabular-nums", days && "text-muted-foreground")} />}
        >
          <CalendarIcon />
          {days ? "Custom" : `${shortDate(range.from)} – ${shortDate(range.to)}`}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 gap-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              From
              <Input type="date" value={from} max={to || today} onChange={(event) => setFrom(event.target.value)} className="h-8" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              To
              <Input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} className="h-8" />
            </label>
          </div>
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!valid}
              onClick={() => {
                onCustom(from, to)
                setOpen(false)
              }}
            >
              Show
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function SyncStatusLine({ sync, account }: { sync: SyncStatus[]; account: string | null }) {
  const [busy, setBusy] = React.useState(false)
  const shown = account ? sync.filter((s) => s.account === account) : sync
  const running = shown.filter((s) => s.running)
  const ready = shown.filter((s) => !s.blocked)
  const last = Math.min(...ready.map((s) => s.listings ?? 0))
  const errors = shown.filter((s) => s.error && !s.running)
  const nextAt = ready.map((s) => s.nextAt).find((n) => !!n)

  async function start() {
    setBusy(true)
    try {
      await syncNow(account ?? undefined)
    } catch (error) {
      toast.error(`Couldn't start the sync: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <span className="truncate tabular-nums" title={shown.map((s) => `${s.shopName ?? s.label}: ${s.blocked ?? (s.listings ? `synced ${ago(s.listings)}` : "never synced")}${s.error ? ` (${s.error})` : ""}`).join("\n")}>
        {running.length ? (
          <>
            Syncing {running.map((s) => s.shopName ?? s.label).join(", ")}
            {running[0].step && ` · ${running[0].step}`}
          </>
        ) : !ready.length ? (
          <span className="text-amber-700 dark:text-amber-400">{shown[0]?.blocked ?? "No shop"}{shown.length > 1 ? " (every shop)" : ""}</span>
        ) : last ? (
          <>
            Synced {ago(last)}
            {nextAt && ` · next ${new Date(nextAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}
          </>
        ) : (
          "Not synced yet"
        )}
        {errors.length > 0 && (
          <span className="ml-1.5 text-destructive" title={errors.map((e) => `${e.shopName ?? e.label}: ${e.error}`).join("\n")}>
            · last sync failed
          </span>
        )}
      </span>
      <Button variant="outline" size="sm" onClick={start} disabled={busy || running.length > 0 || !ready.length} className="active:scale-[0.97]">
        <RefreshCwIcon className={cn(running.length > 0 && "animate-spin motion-reduce:animate-none")} />
        Sync now
      </Button>
    </div>
  )
}

// --- Above the table ---

function Notices({ state }: { state: ArtikelState }) {
  const notes: React.ReactNode[] = []
  const blocked = state.sync.filter((s) => s.blocked)
  if (blocked.length) {
    notes.push(
      <>
        {blocked.map((s) => `${s.shopName ?? s.label}: ${s.blocked}`).join(" · ")}. Numbers stay as last synced, and bulk actions wait, until it&apos;s{" "}
        <Link href="/settings" className="underline underline-offset-2">connected in Settings</Link>.
      </>
    )
  }
  const first = state.coverage.firstSnapshot
  if (!first) notes.push("No daily snapshot yet: views and favourites per range start counting with the first sync.")
  else if (first > state.range.from) {
    notes.push(`Views and favourites count from ${shortDate(first)}, the first daily snapshot: Etsy only gives running totals, so earlier days can't be split out.`)
  }
  if (state.summary.mixedCurrency) notes.push(`Shops in another currency than ${state.summary.currency} are left out of the totals.`)
  if (!notes.length) return null
  return (
    <ul className="flex flex-col gap-1">
      {notes.map((note, i) => (
        <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>{note}</span>
        </li>
      ))}
    </ul>
  )
}

function Summary({ state }: { state: ArtikelState }) {
  const s = state.summary
  const c = s.currency
  const at = state.coverage.viewsUntil
  const until = at && new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  return (
    <div className="flex flex-col gap-1.5">
      <StatStrip
        stats={[
          { label: "Listings", value: <>{formatNumber(s.listings)}<span className="ml-1 text-xs font-normal text-muted-foreground">{formatNumber(s.active)} active</span></>, hint: "In every state; active ones in small" },
          { label: "Views", value: formatNumber(s.views), hint: `From the daily snapshots: Etsy only gives running totals${until ? `. Counted up to ${until}` : ""}` },
          { label: "Favourites", value: formatNumber(s.favorites) },
          { label: "Orders", value: <>{formatNumber(s.orders)}<span className="ml-1 text-xs font-normal text-muted-foreground">{plural(s.sales, "item")}</span></>, hint: "Orders, and the items in them" },
          { label: "Revenue", value: money(s.revenueCents, c), hint: "Items and shipping, less discounts and refunds" },
          { label: "Etsy fees", value: <>{money(s.feesCents, c)}{s.estimated && <Est title="Fees on sales the payment ledger hasn't booked yet are worked out at Etsy's rates" />}</>, hint: "Everything Etsy charged but Etsy Ads: transaction, processing, listing and Offsite Ads fees, VAT on them" },
          { label: "Etsy Ads", value: money(s.adsCents, c), hint: "As the payment ledger books them: one charge a day for the whole shop" },
          { label: "Gelato", value: money(s.costCents, c), hint: "What Gelato charged for printing and shipping, VAT included" },
          { label: "Profit", value: <Signed cents={s.profitCents} currency={c} />, hint: "Revenue less Etsy fees, Etsy Ads and Gelato" },
        ]}
      />
      <p className="text-[11px] text-muted-foreground">
        Etsy&apos;s API has no ad clicks or impressions, and books ad spend per shop only: per listing it&apos;s shared out by views and marked est. Fees and Gelato marked est. are worked out until they&apos;re booked.
      </p>
    </div>
  )
}

function NotSynced({ sync }: { sync: SyncStatus[] }) {
  const ready = sync.filter((s) => !s.blocked)
  const running = sync.some((s) => s.running)
  return (
    <Empty className="min-h-[40svh] border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <RefreshCwIcon className={cn(running && "animate-spin motion-reduce:animate-none")} />
        </EmptyMedia>
        <EmptyTitle>{running ? "The first sync is running" : "Nothing synced yet"}</EmptyTitle>
        <EmptyDescription>
          {running
            ? "Listings, sales, Etsy's payment ledger and Gelato's orders are coming in. This page fills as soon as it's done."
            : ready.length
              ? "The sync reads every listing, sale and fee once a day, early in the morning. Start the first one now."
              : "The sync needs each shop's Etsy connection, made by the shop owner under Settings."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {sync.map((s) => (
            <li key={s.account}>
              {s.shopName ?? s.label}: {s.blocked ?? (s.running ? (s.step ?? "syncing…") : s.error ? `last try failed (${s.error})` : "ready")}
            </li>
          ))}
        </ul>
        {!ready.length && (
          <Button variant="outline" nativeButton={false} render={<Link href="/settings" />}>
            <Settings2Icon />
            Settings
          </Button>
        )}
      </EmptyContent>
    </Empty>
  )
}

function FilterBar({
  state,
  account,
  filters,
  onFilter,
  count,
  searchRef,
  onManageTags,
  onBulk,
}: {
  state: ArtikelState
  account: string | null
  filters: Filters
  onFilter: (change: Partial<Filters>) => void
  count: number
  searchRef: React.RefObject<HTMLInputElement | null>
  onManageTags: () => void
  onBulk: (kind: ActionKind) => void
}) {
  const states = new Map<string, number>()
  for (const r of state.rows) states.set(r.state, (states.get(r.state) ?? 0) + 1)
  const stateItems = [
    { value: "all", label: "Every state" },
    ...Object.keys(STATE_LABEL)
      .filter((s) => states.has(s))
      .map((s) => ({ value: s, label: `${STATE_LABEL[s]} (${formatNumber(states.get(s)!)})` })),
  ]
  const shops = account ? state.shops.filter((s) => s.account === account) : state.shops
  const sectionItems = [
    { value: "all", label: "Every section", group: "" },
    { value: "none", label: "No section", group: "" },
    ...shops.flatMap((s) =>
      s.sections.map((x) => ({ value: `${s.account}:${x.id}`, label: x.title, group: shops.length > 1 ? s.shop : "Sections" }))
    ),
  ]
  const tagItems = [
    { value: "all", label: "Every tag" },
    { value: "none", label: "Untagged" },
    ...state.tags.map((t) => ({ value: t.id, label: t.name })),
  ]
  const active = filters.search || filters.state !== "all" || filters.section !== "all" || filters.tag !== "all" || filters.withSales

  return (
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup className="w-full max-w-64 sm:w-64">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          ref={searchRef}
          value={filters.search}
          onChange={(event) => onFilter({ search: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape" && filters.search) {
              event.stopPropagation()
              onFilter({ search: "" })
            }
          }}
          placeholder="Search titles"
          aria-label="Search listings"
          autoComplete="off"
          spellCheck={false}
        />
        <InputGroupAddon align="inline-end">
          {filters.search ? (
            <InputGroupButton size="icon-xs" aria-label="Clear the search" onClick={() => onFilter({ search: "" })}>
              <XIcon />
            </InputGroupButton>
          ) : (
            <Kbd>/</Kbd>
          )}
        </InputGroupAddon>
      </InputGroup>

      <FilterSelect value={filters.state} items={stateItems} label="State" onChange={(value) => onFilter({ state: value })} />
      <FilterSelect value={filters.section} items={sectionItems} label="Section" onChange={(value) => onFilter({ section: value })} />
      <div className="flex items-center">
        <FilterSelect value={filters.tag} items={tagItems} label="Internal tag" onChange={(value) => onFilter({ tag: value })} />
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Manage internal tags" title="Manage internal tags" onClick={onManageTags}>
          <Settings2Icon />
        </Button>
      </div>
      <Toggle variant="outline" size="sm" pressed={filters.withSales} onPressedChange={(pressed) => onFilter({ withSales: pressed })}>
        With sales
      </Toggle>
      {active && (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onFilter(NO_FILTERS)}>
          Clear
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {plural(count, "listing")}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            Bulk action
            <ChevronDownIcon className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>On a shop, every shop, a tag or a section</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onBulk("price")}>Raise or lower prices…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onBulk("profile")}>Apply a price profile…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onBulk("section")}>Move to a section…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onBulk("state")}>Activate or deactivate…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onBulk("reorderPhotos")}>Change the photo order…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onBulk("swapPhoto")}>Swap one photo…</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function FilterSelect({
  value,
  items,
  label,
  onChange,
}: {
  value: string
  items: { value: string; label: string; group?: string }[]
  label: string
  onChange: (value: string) => void
}) {
  const groups = [...new Set(items.map((i) => i.group ?? ""))]
  return (
    <Select value={value} items={items} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger size="sm" className={cn("max-w-48", value !== "all" && "border-brand/50 bg-brand/5")} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {groups.map((group) => (
          <SelectGroup key={group || "-"}>
            {group && <SelectLabel>{group}</SelectLabel>}
            {items
              .filter((i) => (i.group ?? "") === group)
              .map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
