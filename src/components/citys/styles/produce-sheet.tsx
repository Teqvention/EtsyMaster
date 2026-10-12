"use client"

import Link from "next/link"
import * as React from "react"
import { ArrowRightIcon, ClockIcon, FactoryIcon, LoaderCircleIcon, SearchIcon, SparklesIcon, XIcon, ZapIcon } from "lucide-react"
import { toast } from "sonner"

import { SkyPicker, Stepper } from "@/components/citys/request-editor"
import { TierBadge } from "@/components/citys/tier"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { useStealer } from "@/hooks/use-stealer"
import type { Production } from "@/lib/citys/produce"
import type { SkyId } from "@/lib/citys/skies"
import type { StealerCityRow } from "@/lib/citys/stealer"
import { SET_MAX, SET_MIN, type Follow } from "@/lib/citys/studio-types"
import { SETTINGS, TIERS, type Setting, type Tier } from "@/lib/citys/types"
import { formatNumber, formatRate } from "@/lib/etsy/format"
import { cn } from "@/lib/utils"

// Producing a style over a list of places: pick the places (filters on the
// ranking, or a quick pick like "Top 100 cities"), how many posters each
// gets (a set that hangs together, single posters on top), and how the
// compositions are found: freely, or after the place's best sellers (a
// little, halfway, closely). The art director then works out per place
// what shows it best and everything lands in Outputs under the style.

type Filter = { tiers: Tier[]; settings: Setting[]; tags: string[]; coverage: "all" | "open" | "have"; search: string; limit: number }

const ALL: Filter = { tiers: [], settings: [], tags: [], coverage: "all", search: "", limit: 50 }

type Preset = { id: string; label: string; filter: Partial<Filter>; set: number; singles: number }

const PRESETS: Preset[] = [
  { id: "Top 100 cities", label: "Top 100 cities", filter: { settings: ["city"], limit: 100 }, set: 0, singles: 1 },
  { id: "Top 50 · set of 3", label: "Top 50 · set of 3", filter: { limit: 50 }, set: 3, singles: 0 },
  { id: "30 best still open", label: "30 best still open", filter: { tiers: ["A", "B", "C"], coverage: "open", limit: 30 }, set: 3, singles: 1 },
  { id: "Top 20 beaches & islands", label: "Top 20 beaches & islands", filter: { settings: ["beach", "island"], limit: 20 }, set: 3, singles: 0 },
  { id: "Top 20 nature", label: "Top 20 nature", filter: { settings: ["nature", "mountains", "lake"], limit: 20 }, set: 3, singles: 0 },
]

const FOLLOW_LABEL: Record<Exclude<Follow, "free">, { label: string; hint: string }> = {
  low: { label: "Low", hint: "Loosely inspired by what sells" },
  mid: { label: "Mid", hint: "The kinds of compositions that sell, made our own" },
  high: { label: "High", hint: "Close to the best sellers' compositions" },
}

function filterPlaces(cities: StealerCityRow[], f: Filter) {
  const words = f.search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return cities
    .filter((c) => {
      if (f.tiers.length && !f.tiers.includes(c.tier)) return false
      if (f.settings.length && !f.settings.includes(c.setting)) return false
      if (f.tags.length && !f.tags.some((t) => c.tags.includes(t))) return false
      const have = !!c.coverage && (c.coverage.confirmed > 0 || c.coverage.open > 0)
      if (f.coverage === "open" && have) return false
      if (f.coverage === "have" && !have) return false
      if (words.length && !words.every((w) => `${c.name} ${c.countryName} ${c.region ?? ""} ${c.tags.join(" ")}`.toLowerCase().includes(w))) return false
      return true
    })
    .sort((a, b) => a.position - b.position)
    .slice(0, f.limit)
}

function useProductions(styleId: string) {
  const [list, setList] = React.useState<Production[] | null>(null)
  const [asked, setAsked] = React.useState(0)
  React.useEffect(() => {
    let alive = true
    fetch(`/api/citys/productions?style=${encodeURIComponent(styleId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((got: Production[] | null) => alive && got && setList(got))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [styleId, asked])
  return [list, () => setAsked((n) => n + 1)] as const
}

export function ProduceSheet({ open, onOpenChange, styleId, styleName, medium }: { open: boolean; onOpenChange: (open: boolean) => void; styleId: string; styleName: string; medium: "photo" | "art" }) {
  const state = useStealer()
  const [productions, refresh] = useProductions(styleId)
  const [filter, setFilter] = React.useState<Filter>(ALL)
  const [preset, setPreset] = React.useState<string | null>(null)
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set())
  const [set, setSet] = React.useState({ on: true, count: 3 })
  const [singles, setSingles] = React.useState(0)
  const [follow, setFollow] = React.useState<Follow>("free")
  const [sky, setSky] = React.useState<SkyId>("auto")
  const [delivery, setDelivery] = React.useState<"now" | "batch">("batch")
  const [busy, setBusy] = React.useState(false)

  const cities = React.useMemo(() => state?.cities ?? [], [state])
  const shown = React.useMemo(() => filterPlaces(cities, filter), [cities, filter])
  const picked = shown.filter((c) => !excluded.has(c.id))
  const perPlace = (set.on ? set.count : 0) + singles
  const total = picked.length * perPlace
  const tags = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of cities.slice(0, 400)) for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t)
  }, [cities])

  const change = (next: Partial<Filter>) => {
    setFilter((f) => ({ ...f, ...next }))
    setPreset(null)
  }
  const applyPreset = (p: Preset) => {
    setFilter({ ...ALL, ...p.filter })
    setSet({ on: p.set > 0, count: p.set || 3 })
    setSingles(p.singles)
    setExcluded(new Set())
    setPreset(p.id)
  }
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

  async function start() {
    setBusy(true)
    try {
      const response = await fetch("/api/citys/productions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          styleId,
          places: picked.map((c) => ({ id: c.id, name: c.name, country: c.country })),
          set: set.on ? set.count : 0,
          singles,
          follow,
          sky,
          delivery,
          ...(preset && { preset }),
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? response.statusText)
      const made = result as Production
      toast.success(`${formatNumber(total)} posters of ${picked.length} places on their way`, {
        description: `“${made.name}” lands in Citys → Outputs.`,
        action: { label: "Open", onClick: () => window.open(`/citys/outputs?group=production:${made.id}`, "_self") },
      })
      void refresh()
    } catch (error) {
      toast.error(`Couldn't start it: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 data-[side=right]:sm:max-w-4xl">
        <SheetHeader className="gap-1 border-b p-4 pr-12">
          <SheetTitle className="flex items-center gap-2 text-base">
            <FactoryIcon className="size-4 text-muted-foreground" />
            Produce cities in “{styleName}”
          </SheetTitle>
          <SheetDescription className="text-xs text-pretty">
            For every place we work out what shows it best (London: Big Ben and a red bus) and paint it in exactly this style
            {medium === "photo" ? ", as real photos in its look" : ""}. Everything lands in Outputs under this style.
          </SheetDescription>
        </SheetHeader>

        <div className="grid min-h-0 flex-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto border-b p-4 md:border-r md:border-b-0">
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p)}
                  aria-pressed={preset === p.id}
                  className={cn(
                    "h-7 rounded-full border px-3 text-xs font-medium outline-none transition-[border-color,background-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97]",
                    preset === p.id ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <FilterRow label="Tier">
                {TIERS.map((t) => (
                  <ToggleChip key={t} on={filter.tiers.includes(t)} onClick={() => change({ tiers: toggle(filter.tiers, t) })}>
                    {t}
                  </ToggleChip>
                ))}
              </FilterRow>
              <FilterRow label="Setting">
                {SETTINGS.map((s) => (
                  <ToggleChip key={s} on={filter.settings.includes(s)} onClick={() => change({ settings: toggle(filter.settings, s) })}>
                    {s}
                  </ToggleChip>
                ))}
              </FilterRow>
              {tags.length > 0 && (
                <FilterRow label="Tags">
                  {tags.map((t) => (
                    <ToggleChip key={t} on={filter.tags.includes(t)} onClick={() => change({ tags: toggle(filter.tags, t) })}>
                      {t}
                    </ToggleChip>
                  ))}
                </FilterRow>
              )}
              <FilterRow label="Ours">
                {(["all", "open", "have"] as const).map((c) => (
                  <ToggleChip key={c} on={filter.coverage === c} onClick={() => change({ coverage: c })}>
                    {c === "all" ? "Any" : c === "open" ? "Not ours yet" : "Ours already"}
                  </ToggleChip>
                ))}
              </FilterRow>
              <div className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">Top</span>
                <Slider value={[filter.limit]} min={5} max={200} step={5} onValueChange={(v) => change({ limit: Array.isArray(v) ? v[0] : v })} aria-label="How many places" />
                <span className="w-8 text-right text-sm font-medium tabular-nums">{filter.limit}</span>
              </div>
              <InputGroup className="h-8">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput value={filter.search} onChange={(e) => change({ search: e.target.value })} placeholder="Place, country, tag" aria-label="Search places" autoComplete="off" />
                {filter.search && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton size="icon-xs" aria-label="Clear" onClick={() => change({ search: "" })}>
                      <XIcon />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="tabular-nums">
                {picked.length} of {shown.length} places picked
              </span>
              {excluded.size > 0 && (
                <button type="button" className="underline-offset-2 hover:underline" onClick={() => setExcluded(new Set())}>
                  Pick all again
                </button>
              )}
            </div>
            {!state ? (
              <div className="flex flex-col gap-1.5">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-8 rounded-md" />
                ))}
              </div>
            ) : shown.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No place matches these filters.</p>
            ) : (
              <ul className="flex flex-col">
                {shown.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 [@media(hover:hover)]:hover:bg-accent">
                      <Checkbox
                        checked={!excluded.has(c.id)}
                        onCheckedChange={(checked) =>
                          setExcluded((s) => {
                            const next = new Set(s)
                            if (checked === true) next.delete(c.id)
                            else next.add(c.id)
                            return next
                          })
                        }
                      />
                      <span className="w-7 text-right text-xs text-muted-foreground tabular-nums">{c.position}</span>
                      <TierBadge tier={c.tier} />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {c.name}
                        <span className="text-muted-foreground"> · {c.countryName}</span>
                      </span>
                      <span className="hidden text-xs text-muted-foreground sm:inline">{c.setting}</span>
                      <span className="w-14 text-right text-xs text-muted-foreground tabular-nums">{formatRate(c.spm)}/mo</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Per place</h3>
              <label className="flex items-center justify-between gap-2 text-sm">
                Set that hangs together
                <Switch size="sm" checked={set.on} onCheckedChange={(on) => setSet((s) => ({ ...s, on }))} />
              </label>
              {set.on && (
                <div className="flex items-center gap-2">
                  <Slider value={[set.count]} min={SET_MIN} max={SET_MAX} step={1} onValueChange={(v) => setSet({ on: true, count: Array.isArray(v) ? v[0] : v })} aria-label="Images in the set" />
                  <span className="w-4 text-right text-sm font-medium tabular-nums">{set.count}</span>
                </div>
              )}
              <p className="text-[11px] text-pretty text-muted-foreground">At least three different motifs that capture the place; the rest creative variations.</p>
              <div className="flex items-center justify-between gap-2 text-sm">
                Single posters
                <Stepper value={singles} max={6} onChange={setSingles} />
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Compositions</h3>
              <div className="flex rounded-lg border p-0.5">
                <Segment on={follow === "free"} onClick={() => setFollow("free")}>
                  100% freedom
                </Segment>
                <Segment on={follow !== "free"} onClick={() => setFollow(follow === "free" ? "mid" : follow)}>
                  After best sellers
                </Segment>
              </div>
              {follow !== "free" && (
                <div className="flex rounded-lg border p-0.5" role="group" aria-label="How closely">
                  {(["low", "mid", "high"] as const).map((f) => (
                    <Segment key={f} on={follow === f} onClick={() => setFollow(f)} title={FOLLOW_LABEL[f].hint}>
                      {FOLLOW_LABEL[f].label}
                    </Segment>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-pretty text-muted-foreground">
                {follow === "free" ? "We compose every place the way this style shows it best." : FOLLOW_LABEL[follow].hint + ": we look at the place's top-selling posters first."}
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Sky</h3>
              <div className="flex items-center gap-2">
                <SkyPicker value={sky} onChange={setSky} />
                <span className="text-[11px] text-muted-foreground">{sky === "auto" ? "The style decides" : "For every poster"}</span>
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Paint</h3>
              <div className="flex rounded-lg border p-0.5">
                <Segment on={delivery === "batch"} onClick={() => setDelivery("batch")} title="Half the price, back in minutes to hours">
                  <ClockIcon className="size-3.5" />
                  In batch
                </Segment>
                <Segment on={delivery === "now"} onClick={() => setDelivery("now")} title="Full price, a few at a time right away">
                  <ZapIcon className="size-3.5" />
                  Now
                </Segment>
              </div>
            </section>

            {productions && productions.length > 0 && (
              <section className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Productions of this style</h3>
                <ul className="flex flex-col gap-1">
                  {productions.slice(0, 8).map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/citys/outputs?group=production:${p.id}`}
                        className="group/p flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:bg-accent"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{p.name}</span>
                          <span className="block truncate text-muted-foreground">
                            {p.places.length} {p.places.length === 1 ? "place" : "places"} · {p.set ? `set of ${p.set}` : "no set"}
                            {p.singles ? ` + ${p.singles}` : ""} · {p.follow === "free" ? "free" : `best sellers ${p.follow}`}
                          </span>
                        </span>
                        <ArrowRightIcon className="size-3.5 text-muted-foreground transition-transform duration-150 group-hover/p:translate-x-0.5" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>

        <SheetFooter className="flex-row items-center justify-between gap-3 border-t p-4">
          <span className="text-xs text-muted-foreground tabular-nums">
            {picked.length} places × {perPlace} = <span className="font-medium text-foreground">{formatNumber(total)} posters</span>
            {delivery === "batch" ? " · in batch" : " · now"}
          </span>
          <Button onClick={start} disabled={busy || !total} className="active:scale-[0.97]">
            {busy ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
            Produce
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1 w-14 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  )
}

function ToggleChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "h-6 rounded-full border px-2 text-xs capitalize outline-none transition-[border-color,background-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
        on ? "border-brand/60 bg-brand/10 text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

function Segment({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className={cn(
        "inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
        on ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}
