"use client"

import * as React from "react"
import { ChevronDownIcon, FileUpIcon, HandIcon, LoaderCircleIcon, ScanEyeIcon, ScanIcon, SearchCheckIcon } from "lucide-react"
import { toast } from "sonner"

import { TierBadge } from "@/components/citys/tier"
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
import { reloadArtikel, setCityStatus } from "@/hooks/use-artikel"
import { importOrigins, useClassifyJob } from "@/hooks/use-city-classify"
import type { ArtikelRow, ArtikelState } from "@/lib/artikel/types"
import type { CityColumns } from "@/lib/citys/artikel"
import type { CityOrigin, CityStatus } from "@/lib/citys/ours"
import { TIERS } from "@/lib/citys/types"
import { cn } from "@/lib/utils"

import { ago, plural } from "./shared"

// Our city shops' listings in Artikel: what we decided about each (confirmed
// stays, replace frees its slot for a new poster, offline isn't live), where
// it came from (robin: reference photos; old: the prompt system before;
// system: made here) and how much demand its place has (the ranking's
// tier). The strip above the table counts the slots and runs the
// classification; a status set by hand outlasts every classification.

export const CITY_STATUSES: CityStatus[] = ["confirmed", "replace", "offline"]

export const CITY_STATUS: Record<CityStatus, { label: string; dot: string; bar: string; hint: string }> = {
  confirmed: { label: "Confirmed", dot: "bg-emerald-500", bar: "bg-emerald-500", hint: "Stays online" },
  replace: { label: "Replace", dot: "bg-amber-500", bar: "bg-amber-400 dark:bg-amber-500", hint: "Its slot goes to a new poster" },
  offline: { label: "Offline", dot: "bg-red-500", bar: "bg-red-500", hint: "Not live on Etsy" },
}

export const ORIGINS: CityOrigin[] = ["robin", "old", "system"]

export const ORIGIN_META: Record<CityOrigin, { hint: string; className: string }> = {
  robin: { hint: "Made from reference photos (from 16 Sept)", className: "bg-muted text-foreground" },
  old: { hint: "Made by the prompt system before, without a reference photo", className: "text-muted-foreground ring-1 ring-border ring-inset" },
  system: { hint: "Made here, by the city studio", className: "bg-brand/10 text-brand dark:text-orange-300" },
}

/** Sort order of the status column: what needs a decision first when ascending. */
export const STATUS_ORDER: Record<string, number> = { replace: 0, confirmed: 1, offline: 2, none: 3 }

export function CityStatusLabel({ city }: { city: CityColumns }) {
  if (!city.status) return <span className="text-muted-foreground/60" title="Not classified yet">—</span>
  const meta = CITY_STATUS[city.status]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={[meta.hint, city.reason].filter(Boolean).join(": ")}>
      <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
      {city.manual && <HandIcon className="size-3 text-muted-foreground" aria-label="Set by hand" />}
    </span>
  )
}

export function OriginLabel({ origin }: { origin: CityOrigin }) {
  const meta = ORIGIN_META[origin]
  return (
    <span title={meta.hint} className={cn("inline-flex h-[18px] items-center rounded px-1.5 text-[11px] leading-none font-medium", meta.className)}>
      {origin}
    </span>
  )
}

export function RankCell({ city }: { city: CityColumns }) {
  if (!city.place) return <span className="text-muted-foreground/60" title="No place read off the title">—</span>
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {city.tier ? (
        <TierBadge tier={city.tier} className="size-[18px] text-[10px]" />
      ) : (
        <span title="Not in the ranking: no city shop sells it" className="inline-grid size-[18px] shrink-0 place-items-center rounded-md border border-dashed text-[10px] text-muted-foreground">
          ?
        </span>
      )}
      <span className="truncate text-muted-foreground" title={city.place}>
        {city.place}
      </span>
    </span>
  )
}

// --- Above the table ---

type Counts = Record<CityStatus | "none", number>

function countStatuses(rows: ArtikelRow[]) {
  const counts: Counts = { confirmed: 0, replace: 0, offline: 0, none: 0 }
  for (const r of rows) if (r.city) counts[r.city.status ?? "none"]++
  return counts
}

/**
 * The city slots at a glance: how many listings are confirmed, to replace and
 * offline (each a filter), as one bar, and the classification's run.
 */
export function CityStrip({
  state,
  account,
  status,
  onStatus,
  onSeo,
}: {
  state: ArtikelState
  account: string | null
  status: string
  onStatus: (status: string) => void
  /** Opens the SEO analyses. */
  onSeo: () => void
}) {
  const rows = React.useMemo(() => state.rows.filter((r) => r.city && (!account || r.account === account)), [state.rows, account])
  const counts = countStatuses(rows)
  const total = rows.length
  const replaceF = rows.filter((r) => r.city?.status === "replace" && r.city.tier === "F").length
  const segments = [...CITY_STATUSES, "none" as const].filter((s) => counts[s] > 0)

  return (
    <section aria-label="City slots" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2">
      <div className="flex flex-wrap items-center gap-1">
        {[...CITY_STATUSES, "none" as const].map((s) => {
          const active = status === s
          const n = counts[s]
          if (s === "none" && !n) return null
          return (
            <button
              key={s}
              type="button"
              aria-pressed={active}
              onClick={() => onStatus(active ? "all" : s)}
              title={s === "none" ? "Not classified yet" : CITY_STATUS[s].hint}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-[background-color,transform] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97] [@media(hover:hover)]:hover:bg-muted",
                active && "bg-muted ring-1 ring-border ring-inset"
              )}
            >
              <span className={cn("size-2 rounded-full", s === "none" ? "border border-muted-foreground/60" : CITY_STATUS[s].dot)} aria-hidden />
              <span className="text-muted-foreground">{s === "none" ? "Not judged" : CITY_STATUS[s].label}</span>
              <span className="font-semibold tabular-nums">{n.toLocaleString("en-US")}</span>
            </button>
          )
        })}
      </div>

      <div className="flex h-2 min-w-32 flex-1 gap-[2px] overflow-hidden rounded-full bg-muted" role="img" aria-label={segments.map((s) => `${counts[s]} ${s === "none" ? "not judged" : s}`).join(", ")}>
        {segments.map((s) => (
          <span
            key={s}
            className={cn("h-full transition-[flex-grow] duration-300 ease-out", s === "none" ? "bg-muted-foreground/25" : CITY_STATUS[s].bar)}
            style={{ flexGrow: counts[s] / Math.max(1, total) }}
          />
        ))}
      </div>

      <div className="flex items-center gap-3">
        {counts.replace > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums" title="Slots to replace whose place has shown no demand: they go to a new place">
            {replaceF > 0 && <>{replaceF.toLocaleString("en-US")} of them on F places · </>}
            {plural(counts.replace, "slot")} free
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={onSeo} title="SEO analyses of picked city listings">
          <SearchCheckIcon />
          SEO
        </Button>
        <ClassifyControl classifiedAt={state.city?.classifiedAt} />
      </div>
    </section>
  )
}

function ClassifyControl({ classifiedAt }: { classifiedAt?: string }) {
  const file = React.useRef<HTMLInputElement>(null)
  const { job, start } = useClassifyJob((finished) => {
    reloadArtikel()
    if (finished.status === "done" && finished.result) {
      const r = finished.result
      toast.success("Listings classified", {
        description: `${r.confirmed.toLocaleString("en-US")} confirmed · ${r.replace.toLocaleString("en-US")} to replace · ${r.offline.toLocaleString("en-US")} offline${r.looked ? ` · ${r.looked} pictures looked at` : ""}${r.manual ? ` · ${r.manual} set by hand kept` : ""}`,
      })
    } else if (finished.status === "error") toast.error(`Classifying failed: ${finished.error}`)
  })
  const running = job?.status === "running"

  async function run(look: boolean) {
    try {
      await start(look)
    } catch (error) {
      toast.error(`Couldn't start: ${(error as Error).message}`)
    }
  }

  async function upload(picked: File | undefined) {
    if (!picked) return
    try {
      const { listings } = await importOrigins(picked)
      toast.success(`Origins of ${plural(listings, "listing")} read`, { description: "Classify again to use them." })
      reloadArtikel()
    } catch (error) {
      toast.error(`Couldn't read it: ${(error as Error).message}`)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {running ? (
          <>
            {job.step}
            {job.total > 0 && ` · ${job.done}/${job.total}`}
          </>
        ) : classifiedAt ? (
          `Classified ${ago(Date.parse(classifiedAt))}`
        ) : (
          "Not classified yet"
        )}
      </span>
      <div className="flex items-center" role="group" aria-label="Classify">
        <Button variant={classifiedAt ? "outline" : "default"} size="sm" disabled={running || !job} onClick={() => run(true)} className="rounded-r-none active:scale-[0.97]">
          {running ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <ScanEyeIcon />}
          {classifiedAt ? "Classify again" : "Classify"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant={classifiedAt ? "outline" : "default"}
                size="icon-sm"
                disabled={running || !job}
                aria-label="More ways to classify"
                className={cn("rounded-l-none active:scale-[0.97]", classifiedAt ? "-ml-px" : "border-l border-l-primary-foreground/20")}
              />
            }
          >
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Robin, system and sets stay; most old ones go</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => run(true)}>
                <ScanEyeIcon />
                Classify, Gemini judging the old pictures that perform
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => run(false)}>
                <ScanIcon />
                Classify by numbers only
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => file.current?.click()}>
              <FileUpIcon />
              Read an origin list (.md)…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <input
        ref={file}
        type="file"
        accept=".md,text/markdown,text/plain"
        className="hidden"
        onChange={(event) => {
          void upload(event.target.files?.[0])
          event.target.value = ""
        }}
      />
    </div>
  )
}

// --- Filters ---

export type CityFilters = { status: string; origin: string; rank: string }
export const NO_CITY_FILTERS: CityFilters = { status: "all", origin: "all", rank: "all" }

export function cityFilterItems(rows: ArtikelRow[]) {
  const counts = countStatuses(rows)
  const origins = new Map<string, number>()
  const ranks = new Map<string, number>()
  for (const r of rows) {
    if (!r.city) continue
    origins.set(r.city.origin, (origins.get(r.city.origin) ?? 0) + 1)
    const rank = r.city.tier ?? "none"
    ranks.set(rank, (ranks.get(rank) ?? 0) + 1)
  }
  const n = (value: number | undefined) => (value ?? 0).toLocaleString("en-US")
  return {
    status: [
      { value: "all", label: "Every status" },
      ...CITY_STATUSES.map((s) => ({ value: s, label: `${CITY_STATUS[s].label} (${n(counts[s])})` })),
      ...(counts.none ? [{ value: "none", label: `Not judged (${n(counts.none)})` }] : []),
    ],
    origin: [{ value: "all", label: "Every origin" }, ...ORIGINS.filter((o) => origins.has(o)).map((o) => ({ value: o, label: `${o} (${n(origins.get(o))})` }))],
    rank: [
      { value: "all", label: "Every rank" },
      { value: "ABC", label: `A–C (${n((ranks.get("A") ?? 0) + (ranks.get("B") ?? 0) + (ranks.get("C") ?? 0))})` },
      ...TIERS.filter((t) => ranks.has(t)).map((t) => ({ value: t, label: `${t} (${n(ranks.get(t))})` })),
      ...(ranks.has("none") ? [{ value: "none", label: `Not ranked (${n(ranks.get("none"))})` }] : []),
    ],
  }
}

export function matchesCity(r: ArtikelRow, f: CityFilters) {
  if (f.status === "all" && f.origin === "all" && f.rank === "all") return true
  if (!r.city) return false
  if (f.status !== "all" && (r.city.status ?? "none") !== f.status) return false
  if (f.origin !== "all" && r.city.origin !== f.origin) return false
  if (f.rank === "ABC") return r.city.tier === "A" || r.city.tier === "B" || r.city.tier === "C"
  if (f.rank !== "all" && (r.city.tier ?? "none") !== f.rank) return false
  return true
}

// --- On picked listings ---

/** The status menu of the selection bar: sets the picked city listings' status by hand. */
export function CityStatusMenu({ picked, rows }: { picked: number[]; rows: ArtikelRow[] }) {
  const ids = React.useMemo(() => {
    const set = new Set(picked)
    return rows.filter((r) => r.city && set.has(r.listingId)).map((r) => r.listingId)
  }, [picked, rows])
  if (!ids.length) return null

  async function apply(status: CityStatus | null) {
    try {
      await setCityStatus(ids, status)
      toast.success(status ? `${plural(ids.length, "listing")} set to ${CITY_STATUS[status].label.toLowerCase()}` : `${plural(ids.length, "listing")} handed back to the classification`)
    } catch (error) {
      toast.error(`Couldn't change it: ${(error as Error).message}`)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
        <span className="flex -space-x-0.5" aria-hidden>
          {CITY_STATUSES.map((s) => (
            <span key={s} className={cn("size-2 rounded-full ring-2 ring-popover", CITY_STATUS[s].dot)} />
          ))}
        </span>
        Status
        <ChevronDownIcon className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" sideOffset={8} className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{plural(ids.length, "city listing")}, by hand</DropdownMenuLabel>
          {CITY_STATUSES.map((s) => (
            <DropdownMenuItem key={s} onClick={() => apply(s)}>
              <span className={cn("size-2 rounded-full", CITY_STATUS[s].dot)} aria-hidden />
              {CITY_STATUS[s].label}
              <span className="ml-auto text-xs text-muted-foreground">{CITY_STATUS[s].hint}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => apply(null)}>Hand back to the classification</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
