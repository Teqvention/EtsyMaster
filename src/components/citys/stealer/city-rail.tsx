"use client"

import * as React from "react"
import { CornerDownRightIcon, SearchIcon, XIcon } from "lucide-react"

import { TierBadge } from "@/components/citys/tier"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import type { StealerCityRow } from "@/lib/citys/stealer"
import { TIERS, type Tier } from "@/lib/citys/types"
import { formatRate } from "@/lib/etsy/format"
import { cn } from "@/lib/utils"

// The places down the left of the Stealer, in priority order: tier, how
// much demand, whether we have it already. Filters on top keep it to what's
// worth making next (tiers A–C, open places, or places whose old listings
// get a new poster of the same place); ↑ and ↓ walk it.

export type RailFilter = { search: string; tiers: Tier[]; coverage: "all" | "open" | "have" | "replace"; photos: boolean }

export const DEFAULT_RAIL: RailFilter = { search: "", tiers: ["A", "B", "C"], coverage: "open", photos: false }

export function filterCities(cities: StealerCityRow[], f: RailFilter) {
  const words = f.search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return cities.filter((c) => {
    if (f.tiers.length && !f.tiers.includes(c.tier)) return false
    const have = !!c.coverage && (c.coverage.confirmed > 0 || c.coverage.open > 0)
    // Old listings to replace of a place with demand keep their place: a new poster of it replaces them.
    const replace = !!c.coverage && c.coverage.replace > 0 && c.tier !== "F"
    if (f.coverage === "open" && (have || replace)) return false
    if (f.coverage === "have" && !have) return false
    if (f.coverage === "replace" && !replace) return false
    if (f.photos ? c.photos === 0 : c.refs === 0) return false
    if (words.length) {
      const text = `${c.name} ${c.countryName} ${c.region ?? ""} ${c.setting} ${c.kind} ${c.tags.join(" ")}`.toLowerCase()
      if (!words.every((w) => text.includes(w))) return false
    }
    return true
  })
}

export function CityRail({
  cities,
  filter,
  onFilter,
  current,
  onPick,
}: {
  cities: StealerCityRow[]
  filter: RailFilter
  onFilter: (change: Partial<RailFilter>) => void
  current: string | null
  onPick: (id: string) => void
}) {
  const list = React.useRef<HTMLUListElement>(null)
  const [shown, setShown] = React.useState(150)
  // Other filters: the list starts at the top again.
  const [shownFor, setShownFor] = React.useState(filter)
  if (shownFor !== filter) {
    setShownFor(filter)
    setShown(150)
  }

  React.useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(current ?? "")}"]`)?.scrollIntoView({ block: "nearest" })
  }, [current])

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    const at = cities.findIndex((c) => c.id === current)
    const next = cities[Math.max(0, Math.min(cities.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))]
    if (next) onPick(next.id)
  }

  return (
    <div className="flex min-h-0 flex-col gap-2" onKeyDown={onKeyDown}>
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          value={filter.search}
          onChange={(e) => onFilter({ search: e.target.value })}
          placeholder="City, country, beach…"
          aria-label="Search places"
          autoComplete="off"
          spellCheck={false}
        />
        {filter.search && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" aria-label="Clear the search" onClick={() => onFilter({ search: "" })}>
              <XIcon />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      <div className="flex flex-wrap items-center gap-1">
        {TIERS.map((tier) => {
          const on = filter.tiers.includes(tier)
          return (
            <button
              key={tier}
              type="button"
              aria-pressed={on}
              onClick={() => onFilter({ tiers: on ? filter.tiers.filter((t) => t !== tier) : [...filter.tiers, tier].sort() })}
              className={cn("rounded-md outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring/50", !on && "opacity-35 hover:opacity-70")}
              title={on ? `Hide tier ${tier}` : `Show tier ${tier}`}
            >
              <TierBadge tier={tier} />
            </button>
          )
        })}
        <div className="ml-auto flex rounded-md border p-0.5 text-[11px]">
          {(["open", "replace", "have", "all"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onFilter({ coverage: c })}
              aria-pressed={filter.coverage === c}
              className={cn(
                "rounded px-1.5 py-0.5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
                filter.coverage === c ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              )}
              title={
                c === "open"
                  ? "Places we don't have yet"
                  : c === "replace"
                    ? "Places whose old listings get a new poster of the same place"
                    : c === "have"
                      ? "Places we have a listing of"
                      : "Every place"
              }
            >
              {c === "open" ? "Open" : c === "replace" ? "Replace" : c === "have" ? "Have" : "All"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between px-0.5 text-[11px] text-muted-foreground tabular-nums">
        <span>{cities.length.toLocaleString("en-US")} places</span>
        <span>sales/mo · refs</span>
      </div>
      <ul ref={list} className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 [scrollbar-width:thin]" role="listbox" aria-label="Places">
        {cities.slice(0, shown).map((c) => {
          const on = c.id === current
          const have = c.coverage && (c.coverage.confirmed > 0 || c.coverage.open > 0)
          return (
            <li key={c.id} data-id={c.id} role="option" aria-selected={on}>
              <button
                type="button"
                onClick={() => onPick(c.id)}
                className={cn(
                  "flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring/50",
                  on ? "bg-accent" : "[@media(hover:hover)]:hover:bg-accent/60"
                )}
              >
                {c.sub && <CornerDownRightIcon className="-mr-1 size-3 shrink-0 text-muted-foreground/70" aria-hidden />}
                <TierBadge tier={c.tier} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {c.sub ? `in ${c.sub.parentName}${c.sub.test ? " · test poster first" : " · own poster"}` : c.countryName}
                    {have && <span className="ml-1 text-emerald-700 dark:text-emerald-400">· {c.coverage!.confirmed + c.coverage!.open} ours</span>}
                    {!!c.coverage?.replace && <span className="ml-1 text-amber-700 dark:text-amber-400">· {c.coverage.replace} to replace</span>}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end text-[11px] tabular-nums">
                  <span className="font-medium">{formatRate(c.spm)}</span>
                  <span className="text-muted-foreground">{filter.photos ? c.photos : c.refs}</span>
                </span>
              </button>
            </li>
          )
        })}
        {shown < cities.length && (
          <li>
            <button type="button" onClick={() => setShown((n) => n + 300)} className="w-full rounded-md py-2 text-xs text-muted-foreground hover:bg-accent">
              Show more
            </button>
          </li>
        )}
      </ul>
    </div>
  )
}
