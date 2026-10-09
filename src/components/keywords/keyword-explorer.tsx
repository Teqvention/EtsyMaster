"use client"

import Image from "next/image"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  ImageIcon,
  SearchIcon,
  TrophyIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatCompactCurrency, formatNumber, formatRate } from "@/lib/etsy/format"
import type { KeywordInsight, KeywordListing, LibraryOverview } from "@/lib/keywords/types"
import { cn } from "@/lib/utils"

// Every tag and title phrase in the library, ranked. Search narrows it, the
// column heads sort it, and opening a keyword shows the listings using it.

type Kind = KeywordInsight["kind"]
type SortKey = "keyword" | "score" | "listings" | "shops" | "salesPerMonth" | "avgSalesPerMonth" | "topShare"
type Scope = "all" | "shared" | "sweet"

const COLUMNS: { key: SortKey; label: string; hint: string; className?: string }[] = [
  { key: "score", label: "Score", hint: "Sales carried, weighted towards top sellers and keywords many shops use (0–100)", className: "w-32" },
  { key: "listings", label: "Listings", hint: "Listings using it", className: "w-20 text-right" },
  { key: "shops", label: "Shops", hint: "Shops using it", className: "w-16 text-right" },
  { key: "salesPerMonth", label: "Sales / mo", hint: "Estimated sales per month of those listings, summed", className: "w-24 text-right" },
  { key: "avgSalesPerMonth", label: "Avg", hint: "Estimated sales per month of the average listing using it", className: "w-20 text-right" },
  { key: "topShare", label: "Top sellers", hint: "Share of those listings in the best fifth of their shop", className: "w-28" },
]

const STEP = 100

export function KeywordExplorer({
  library,
  query,
  onQueryChange,
  currency,
  ref,
}: {
  library: LibraryOverview
  query: string
  onQueryChange: (query: string) => void
  currency: string
  ref?: React.Ref<HTMLElement>
}) {
  const [kind, setKind] = useKind()
  const [scope, setScope] = React.useState<Scope>("all")
  const [sort, setSort] = React.useState<{ key: SortKey; desc: boolean }>({ key: "score", desc: true })
  const [shown, setShown] = React.useState(STEP)
  // The open keyword, for the query it was opened under; otherwise an exact
  // match of the query opens by itself.
  const [open, setOpen] = React.useState<{ query: string; key: string | null }>({ query: "", key: null })
  const search = React.useRef<HTMLInputElement>(null)

  const average = library.averageSalesPerMonth
  const all = kind === "tag" ? library.tags : library.phrases
  const needle = query.trim().toLowerCase().replace(/\s+/g, " ")

  const rows = React.useMemo(() => {
    const words = needle.split(" ").filter(Boolean)
    const filtered = all.filter(
      (k) =>
        words.every((w) => k.keyword.includes(w)) &&
        (scope === "all" ||
          (scope === "shared" && k.shops > 1) ||
          (scope === "sweet" && k.listings <= 12 && k.listings >= 2 && k.avgSalesPerMonth >= average * 1.5))
    )
    const dir = sort.desc ? -1 : 1
    return filtered.toSorted((a, b) => {
      const by =
        sort.key === "keyword" ? a.keyword.localeCompare(b.keyword) : (a[sort.key] as number) - (b[sort.key] as number)
      return by * dir || b.score - a.score
    })
  }, [all, needle, scope, sort, average])

  const other = kind === "tag" ? library.phrases : library.tags
  const elsewhere = React.useMemo(
    () => (needle && rows.length === 0 ? other.filter((k) => k.keyword.includes(needle)).length : 0),
    [needle, rows.length, other]
  )

  const exactKey = rows.find((r) => r.keyword === needle)?.keyword ?? null
  const openKey = open.query === query ? open.key : exactKey
  const maxScore = rows.reduce((m, r) => Math.max(m, r.score), 0) || 100

  // "/" jumps to the search, like most tables of this kind.
  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return
      const target = event.target as HTMLElement
      if (target.closest("input, textarea, [contenteditable=true]")) return
      event.preventDefault()
      search.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "keyword" }))
    setShown(STEP)
  }

  // ↑/↓ walk the rows' keyword buttons.
  function onRowsKeyDown(event: React.KeyboardEvent<HTMLTableSectionElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-keyword]")]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (at === -1) return
    const next = buttons[at + (event.key === "ArrowDown" ? 1 : -1)]
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  return (
    <section ref={ref} aria-labelledby="keyword-table" className="flex scroll-mt-4 flex-col gap-3 rounded-lg border p-3">
      <h2 id="keyword-table" className="sr-only">
        Keywords
      </h2>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Tabs
          value={kind}
          onValueChange={(value) => {
            setKind(value as Kind)
            setShown(STEP)
          }}
        >
          <TabsList>
            <TabsTrigger value="tag" className="px-3">
              Tags
              <span className="text-[11px] text-muted-foreground tabular-nums">{formatNumber(library.tags.length)}</span>
            </TabsTrigger>
            <TabsTrigger value="phrase" className="px-3">
              Title phrases
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {formatNumber(library.phrases.length)}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <InputGroup className="w-full max-w-72 sm:w-72">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            ref={search}
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value)
              setShown(STEP)
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.stopPropagation()
                onQueryChange("")
              }
            }}
            placeholder={kind === "tag" ? "Search tags" : "Search title phrases"}
            aria-label="Search keywords"
            autoComplete="off"
            spellCheck={false}
          />
          <InputGroupAddon align="inline-end">
            {query ? (
              <InputGroupButton size="icon-xs" aria-label="Clear the search" onClick={() => onQueryChange("")}>
                <XIcon />
              </InputGroupButton>
            ) : (
              <Kbd>/</Kbd>
            )}
          </InputGroupAddon>
        </InputGroup>

        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[scope]}
          onValueChange={(value) => {
            if (!value[0]) return
            setScope(value[0] as Scope)
            setShown(STEP)
          }}
          aria-label="Which keywords"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="shared" title="Used by two shops or more: a pattern, not one shop's habit">
            2+ shops
          </ToggleGroupItem>
          <ToggleGroupItem
            value="sweet"
            title="Few listings (2–12) use it, and they sell at least 1.5× the library's average"
          >
            Sweet spots
          </ToggleGroupItem>
        </ToggleGroup>

        <span className="ml-auto text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {formatNumber(rows.length)} {kind === "tag" ? (rows.length === 1 ? "tag" : "tags") : rows.length === 1 ? "phrase" : "phrases"}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center">
          <p className="text-sm font-medium">
            {needle ? <>No {kind === "tag" ? "tag" : "title phrase"} matches “{query.trim()}”</> : "Nothing here yet"}
          </p>
          <p className="text-xs text-muted-foreground">
            {scope !== "all" ? "Try all keywords, or a shorter search." : "Try a shorter search."}
          </p>
          <div className="flex gap-2 pt-1">
            {elsewhere > 0 && (
              <Button size="sm" variant="outline" className="active:scale-[0.97]" onClick={() => setKind(kind === "tag" ? "phrase" : "tag")}>
                {formatNumber(elsewhere)} in {kind === "tag" ? "title phrases" : "tags"}
              </Button>
            )}
            {scope !== "all" && (
              <Button size="sm" variant="ghost" onClick={() => setScope("all")}>
                Show all
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="-mx-3 overflow-x-auto">
          <table className="w-full min-w-[54rem] border-separate border-spacing-0 text-xs">
            <thead className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
              <tr>
                <SortHead column={{ key: "keyword", label: kind === "tag" ? "Tag" : "Phrase", hint: "A–Z" }} sort={sort} onSort={toggleSort} className="pl-3 text-left" />
                {COLUMNS.map((column) => (
                  <SortHead key={column.key} column={column} sort={sort} onSort={toggleSort} className={column.className} />
                ))}
                <th className="w-3 border-b" aria-hidden />
              </tr>
            </thead>
            <tbody onKeyDown={onRowsKeyDown}>
              {rows.slice(0, shown).map((row) => (
                <KeywordRow
                  key={row.keyword}
                  row={row}
                  needle={needle}
                  open={openKey === row.keyword}
                  onToggle={() => setOpen({ query, key: openKey === row.keyword ? null : row.keyword })}
                  maxScore={maxScore}
                  average={average}
                  library={library}
                  currency={currency}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {shown < rows.length && (
        <Button variant="outline" className="self-center active:scale-[0.97]" onClick={() => setShown((n) => n + STEP)}>
          Show {formatNumber(Math.min(STEP, rows.length - shown))} more
          <span className="text-muted-foreground tabular-nums">of {formatNumber(rows.length - shown)}</span>
        </Button>
      )}
    </section>
  )
}

// The tab lives in the URL (`?kind=phrase`), so a reload keeps it.
function useKind() {
  const searchParams = useSearchParams()
  const [kind, setLocal] = React.useState<Kind>(() => (searchParams.get("kind") === "phrase" ? "phrase" : "tag"))
  const setKind = React.useCallback((next: Kind) => {
    setLocal(next)
    const params = new URLSearchParams(window.location.search)
    if (next === "phrase") params.set("kind", "phrase")
    else params.delete("kind")
    const search = params.toString()
    window.history.replaceState(null, "", search ? `?${search}` : window.location.pathname)
  }, [])
  return [kind, setKind] as const
}

function SortHead({
  column,
  sort,
  onSort,
  className,
}: {
  column: { key: SortKey; label: string; hint: string }
  sort: { key: SortKey; desc: boolean }
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = sort.key === column.key
  const right = className?.includes("text-right")
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
      className={cn("border-b px-2 pb-1.5 font-medium", className)}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        title={column.hint}
        className={cn(
          "inline-flex items-center gap-0.5 rounded uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:text-foreground",
          right && "flex-row-reverse",
          active && "text-foreground"
        )}
      >
        {column.label}
        <span className="grid size-3 place-items-center">
          {active && (sort.desc ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" />)}
        </span>
      </button>
    </th>
  )
}

function KeywordRow({
  row,
  needle,
  open,
  onToggle,
  maxScore,
  average,
  library,
  currency,
}: {
  row: KeywordInsight
  needle: string
  open: boolean
  onToggle: () => void
  maxScore: number
  average: number
  library: LibraryOverview
  currency: string
}) {
  const lift = average > 0 ? row.avgSalesPerMonth / average : 0
  const cell = "border-b px-2 py-1.5 tabular-nums"
  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          "cursor-pointer transition-[background-color] duration-150 ease-out [@media(hover:hover)]:hover:bg-muted/50",
          open && "bg-muted/50"
        )}
      >
        <td className={cn(cell, "max-w-0 pl-3")}>
          <button
            type="button"
            data-keyword
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation()
              onToggle()
            }}
            className="flex w-full min-w-0 items-center gap-1 rounded text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ChevronRightIcon
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none",
                open && "rotate-90"
              )}
            />
            <span className="truncate">
              <Highlight text={row.keyword} needle={needle} />
            </span>
          </button>
        </td>
        <td className={cell}>
          <span className="flex items-center gap-2">
            <span className="h-1.5 flex-1 rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-brand"
                style={{ width: `${Math.max((row.score / maxScore) * 100, 2)}%` }}
              />
            </span>
            <span className="w-6 text-right font-medium">{row.score}</span>
          </span>
        </td>
        <td className={cn(cell, "text-right")}>{formatNumber(row.listings)}</td>
        <td className={cn(cell, "text-right", row.shops > 1 ? "text-foreground" : "text-muted-foreground")}>
          {formatNumber(row.shops)}
        </td>
        <td className={cn(cell, "text-right")}>{formatRate(row.salesPerMonth)}</td>
        <td
          className={cn(cell, "text-right", lift >= 2 ? "font-medium text-brand" : lift < 0.5 && "text-muted-foreground")}
          title={average > 0 ? `${lift.toFixed(1)}× the library's average listing` : undefined}
        >
          {formatRate(row.avgSalesPerMonth)}
        </td>
        <td className={cell}>
          <span className="flex items-center gap-2">
            <span className="h-1.5 flex-1 rounded-full bg-muted">
              <span
                className={cn("block h-full rounded-full", row.topShare >= 0.5 ? "bg-amber-500" : "bg-muted-foreground/40")}
                style={{ width: `${Math.max(row.topShare * 100, row.topShare > 0 ? 3 : 0)}%` }}
              />
            </span>
            <span className="w-8 text-right">{Math.round(row.topShare * 100)}%</span>
          </span>
        </td>
        <td className="border-b" />
      </tr>
      {open && (
        <tr>
          <td colSpan={COLUMNS.length + 2} className="border-b bg-muted/30 px-3 py-3">
            <KeywordListings keyword={row.keyword} kind={row.kind} library={library} currency={currency} />
          </td>
        </tr>
      )}
    </>
  )
}

function Highlight({ text, needle }: { text: string; needle: string }) {
  const words = needle.split(" ").filter(Boolean)
  if (words.length === 0) return text
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g")
  return text.split(pattern).map((part, i) =>
    i % 2 ? (
      <mark key={i} className="rounded-[2px] bg-brand/15 text-inherit">
        {part}
      </mark>
    ) : (
      part
    )
  )
}

// --- Listings using a keyword ---

const listingCache = new Map<string, KeywordListing[]>()

function KeywordListings({
  keyword,
  kind,
  library,
  currency,
}: {
  keyword: string
  kind: Kind
  library: LibraryOverview
  currency: string
}) {
  // A change to the library invalidates what was fetched before it.
  const key = `${library.stats.shops}:${library.stats.listings}:${kind}:${keyword}`
  const [result, setResult] = React.useState<{ key: string; listings: KeywordListing[] | null; error: string | null }>(
    () => ({ key, listings: listingCache.get(key) ?? null, error: null })
  )
  const current = result.key === key ? result : { key, listings: listingCache.get(key) ?? null, error: null }

  React.useEffect(() => {
    if (listingCache.has(key)) return
    let cancelled = false
    const params = new URLSearchParams({ keyword, kind })
    fetch(`/api/keywords/listings?${params}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? res.statusText)
        return data as KeywordListing[]
      })
      .then((listings) => {
        listingCache.set(key, listings)
        if (!cancelled) setResult({ key, listings, error: null })
      })
      .catch((error: Error) => {
        if (!cancelled) setResult({ key, listings: null, error: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [key, keyword, kind])

  if (current.error) return <p className="text-xs text-destructive">{current.error}</p>

  if (!current.listings) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-md" />
        ))}
      </div>
    )
  }

  const listings = current.listings
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-muted-foreground">
        {listings.length >= 60 ? "The 60 best selling" : listings.length === 1 ? "The one listing" : `All ${listings.length} listings`}{" "}
        using “{keyword}” {kind === "tag" ? "as a tag" : "in the title"}, best selling first
      </p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
        {listings.map((l) => (
          <li key={l.id}>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group/listing flex h-full items-center gap-2.5 rounded-md border bg-card p-1.5 pr-2.5 outline-none transition-[border-color,transform] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99] [@media(hover:hover)]:hover:border-foreground/25"
            >
              <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded bg-muted">
                {l.thumb ? (
                  <Image src={l.thumb} alt="" fill unoptimized sizes="48px" className="object-cover" />
                ) : (
                  <ImageIcon className="size-4 text-muted-foreground" />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="line-clamp-2 text-xs leading-snug">{l.title}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
                  {l.top && (
                    <TrophyIcon className="size-3 shrink-0 text-amber-500" aria-label="Top seller in its shop" />
                  )}
                  <span className="truncate">{l.shop}</span>
                  <span className="ml-auto shrink-0 font-medium text-foreground">
                    {formatRate(l.salesPerMonth, true)}/mo
                  </span>
                  {l.revenuePerMonthCents > 0 && (
                    <span className="shrink-0">· {formatCompactCurrency(l.revenuePerMonthCents, currency)}</span>
                  )}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
