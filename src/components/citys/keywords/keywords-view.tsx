"use client"

import * as React from "react"
import { BanIcon, CheckIcon, LoaderCircleIcon, MapPinIcon, PlusIcon, RefreshCwIcon, SearchIcon, SparklesIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { TierBadge } from "@/components/citys/tier"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { fetchPlaceKeywords, searchPlaces, useCityKeywords, type PlaceHit } from "@/hooks/use-city-keywords"
import { useStyles } from "@/hooks/use-styles"
import type { KeywordResearch, KeywordStat, KeywordStrategy, PlaceKeywords } from "@/lib/citys/keywords"
import { cn } from "@/lib/utils"

// The city shop's keyword system. On the left the strategy every listing's
// title and tags follow (the copywriter and the SEO analysis both read it):
// patterns every listing carries, patterns listings take turns with,
// place-free keywords to vary from, what never to use, title formulas and
// each city style's own words, all tried on a place to see them filled in.
// On the right the research it rests on: the city shops' tags and titles
// with the place taken out, weighed by sales; any keyword goes into the
// strategy from there. Below, one place's own words.

type ListKey = "core" | "rotate" | "generic" | "avoid"

const LISTS: { key: ListKey; label: string; hint: string; tags: boolean }[] = [
  { key: "core", label: "Every listing", hint: "The strongest patterns: each listing carries most of them", tags: true },
  { key: "rotate", label: "Taking turns", hint: "Listings of one place vary these, so they cover different searches", tags: true },
  { key: "generic", label: "Place-free", hint: "Broad keywords without a place, to vary from", tags: true },
  { key: "avoid", label: "Never", hint: "Too niche, misleading for a print, or someone's trademark", tags: false },
]

const TOKEN = /(\{(?:city|landmark|region|country|demonym|style)\})/

/** A pattern with its tokens as quiet pills. */
function Pattern({ text }: { text: string }) {
  return (
    <>
      {text.split(TOKEN).map((part, i) =>
        TOKEN.test(part) ? (
          <span key={i} className="rounded-[4px] border border-dashed border-foreground/25 px-1 font-mono text-[10.5px] text-muted-foreground">
            {part.slice(1, -1)}
          </span>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  )
}

type Sample = { city: string; region?: string; country: string }

/** A pattern filled in for the sample place; tokens it can't fill stay. */
function filled(pattern: string, sample: Sample | null, title = false) {
  if (!sample) return pattern
  const out = pattern
    .replace(/\{city\}/g, sample.city)
    .replace(/\{region\}/g, sample.region ?? "{region}")
    .replace(/\{country\}/g, sample.country)
    .replace(/\{landmark\}/g, "{landmark}")
  return title ? out : out.toLowerCase()
}

export function KeywordsView() {
  const kw = useCityKeywords()
  const styles = useStyles()
  const [busy, setBusy] = React.useState<"research" | "strategy" | null>(null)
  const [sample, setSample] = React.useState<PlaceHit | null>(null)

  React.useEffect(() => {
    let cancelled = false
    searchPlaces("").then((hits) => !cancelled && setSample((s) => s ?? hits[0] ?? null), () => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function run(kind: "research" | "strategy") {
    setBusy(kind)
    try {
      if (kind === "research") await kw.researchAgain()
      else await kw.writeStrategy()
      toast.success(kind === "research" ? "Research made again" : "Strategy written")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (kw.error) {
    return (
      <div className="px-4 lg:px-6">
        <Empty className="min-h-[40svh] border border-dashed">
          <EmptyHeader>
            <EmptyTitle>Keywords didn&apos;t load</EmptyTitle>
            <EmptyDescription>{kw.error}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }
  if (!kw.research || !kw.strategy) {
    return (
      <div className="grid gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_26rem] lg:px-6">
        <Skeleton className="h-[70svh] rounded-lg" />
        <Skeleton className="h-[70svh] rounded-lg" />
      </div>
    )
  }

  const research = kw.research
  const strategy = kw.strategy
  const cityStyles = (styles ?? []).filter((s) => s.kind === "city")
  const sampleNames: Sample | null = sample ? { city: sample.name, region: sample.region, country: sample.countryName } : null
  const written = !!strategy.writtenAt || !!strategy.editedAt

  function add(list: ListKey, keyword: string) {
    const current = strategy[list]
    if (current.includes(keyword)) return
    void kw.edit({ [list]: [...current, keyword] }).catch((e: Error) => toast.error(e.message))
  }

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground tabular-nums">
          From {research.listings.toLocaleString("en-US")} listings of {research.shops} city shops for {research.places.toLocaleString("en-US")} places, weighed by their sales
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => run("research")} disabled={!!busy} className="active:scale-[0.97]">
            <RefreshCwIcon className={cn(busy === "research" && "animate-spin motion-reduce:animate-none")} />
            Research again
          </Button>
          <Button variant={written ? "outline" : "default"} size="sm" onClick={() => run("strategy")} disabled={!!busy} className="active:scale-[0.97]" title={written ? "Gemini writes it again from the research: changes by hand are replaced" : undefined}>
            {busy === "strategy" ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <SparklesIcon />}
            {written ? "Write again" : "Write the strategy"}
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <section aria-labelledby="kw-strategy" className="flex min-w-0 flex-col rounded-lg border">
          <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <h2 id="kw-strategy" className="text-sm font-semibold">
              Strategy
            </h2>
            <span className="text-xs text-muted-foreground">{strategy.editedAt ? "changed by hand" : strategy.writtenAt ? "written by Gemini" : "not written yet"}</span>
            <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              Tried on
              <PlacePicker value={sample} onChange={setSample} />
            </div>
          </header>

          <div className="flex flex-col divide-y">
            {LISTS.map((list) => (
              <Block key={list.key} label={list.label} hint={list.hint}>
                <ChipList
                  items={strategy[list.key]}
                  tags={list.tags}
                  sample={sampleNames}
                  onChange={(items) => kw.edit({ [list.key]: items }).catch((e: Error) => toast.error(e.message))}
                />
              </Block>
            ))}
            <Block label="Titles" hint="Formulas the titles follow; listings of one place take different ones">
              <FormulaList items={strategy.titles} sample={sampleNames} onChange={(titles) => kw.edit({ titles }).catch((e: Error) => toast.error(e.message))} />
            </Block>
            <Block label="Styles" hint="How each city style's look is searched: these join its listings' tags">
              {cityStyles.length ? (
                <div className="flex flex-col gap-3">
                  {cityStyles.map((style) => (
                    <div key={style.id} className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium">{style.name}</span>
                      <ChipList
                        items={strategy.styles[style.id] ?? []}
                        tags
                        sample={null}
                        onChange={(items) => kw.edit({ styles: { ...strategy.styles, [style.id]: items } }).catch((e: Error) => toast.error(e.message))}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No city style yet: make one under Citys → Styles.</p>
              )}
            </Block>
            <Block label="Why" hint="The reasoning behind it, for whoever changes it">
              <Notes value={strategy.notes} onSave={(notes) => kw.edit({ notes }).catch((e: Error) => toast.error(e.message))} />
            </Block>
          </div>
        </section>

        <ResearchPanel research={research} strategy={strategy} onAdd={add} />
      </div>

      <PlaceLookup />
    </div>
  )
}

function Block({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-2 px-4 py-3 md:grid-cols-[10rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-[11px] leading-snug text-pretty text-muted-foreground">{hint}</span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Keywords as chips: × takes one out, the field at the end adds (several at once, separated by commas). */
function ChipList({ items, tags, sample, onChange }: { items: string[]; tags: boolean; sample: Sample | null; onChange: (items: string[]) => void }) {
  const [draft, setDraft] = React.useState("")
  function commit() {
    const next = draft
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter((x) => x && !items.includes(x))
    setDraft("")
    if (next.length) onChange([...items, ...next])
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((item) => {
        const example = filled(item, sample)
        const long = tags && example.length > 20 && !example.includes("{")
        return (
          <span
            key={item}
            title={sample && example !== item ? `${example}${long ? ` · ${example.length} characters: Etsy takes 20` : ""}` : undefined}
            className={cn(
              "group/chip inline-flex h-6 items-center gap-0.5 rounded-md bg-muted pr-0.5 pl-2 text-xs",
              long && "bg-amber-500/12 text-amber-800 dark:text-amber-300"
            )}
          >
            <Pattern text={item} />
            <button
              type="button"
              onClick={() => onChange(items.filter((x) => x !== item))}
              aria-label={`Remove ${item}`}
              className="grid size-5 place-items-center rounded text-muted-foreground opacity-60 transition-opacity duration-150 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:group-hover/chip:opacity-100"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        )
      })}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          }
        }}
        onBlur={commit}
        placeholder={items.length ? "Add…" : "Add a keyword…"}
        aria-label="Add a keyword"
        className="h-6 w-28 min-w-0 rounded-md bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground/70 focus-visible:bg-muted/60"
      />
    </div>
  )
}

function FormulaList({ items, sample, onChange }: { items: string[]; sample: Sample | null; onChange: (items: string[]) => void }) {
  const [draft, setDraft] = React.useState("")
  return (
    <ol className="flex flex-col gap-1">
      {items.map((item, i) => {
        const example = filled(item, sample, true)
        return (
          <li key={item} className="group/row flex items-start gap-2 rounded-md px-1.5 py-1 [@media(hover:hover)]:hover:bg-muted/50">
            <span className="w-4 shrink-0 pt-px text-right text-[11px] text-muted-foreground tabular-nums">{i + 1}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-xs leading-snug">
                <Pattern text={item} />
              </span>
              {sample && (
                <span className={cn("text-[11px] leading-snug text-muted-foreground", example.length > 140 && "text-destructive")}>
                  {example}
                  {example.length > 140 && ` · ${example.length}/140`}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => onChange(items.filter((x) => x !== item))}
              aria-label="Remove this formula"
              className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity duration-150 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:group-hover/row:opacity-100"
            >
              <XIcon className="size-3.5" />
            </button>
          </li>
        )
      })}
      <li className="pl-7">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault()
              onChange([...items, draft.trim()])
              setDraft("")
            }
          }}
          placeholder="Add a formula, e.g. {city} Travel Poster, {landmark} Print, {country} Wall Art"
          aria-label="Add a title formula"
          className="h-7 w-full rounded-md bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground/70 focus-visible:bg-muted/60"
        />
      </li>
    </ol>
  )
}

function Notes({ value, onSave }: { value: string; onSave: (notes: string) => void }) {
  const [draft, setDraft] = React.useState(value)
  const [shown, setShown] = React.useState(value)
  if (shown !== value) {
    setShown(value)
    setDraft(value)
  }
  return (
    <Textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onSave(draft)}
      rows={4}
      placeholder="What ranks, what to vary, what to leave alone"
      className="text-xs leading-relaxed"
    />
  )
}

// --- Research ---

type ResearchTab = "patterns" | "generic" | "openers" | "looks"

function ResearchPanel({ research, strategy, onAdd }: { research: KeywordResearch; strategy: KeywordStrategy; onAdd: (list: ListKey, keyword: string) => void }) {
  const [tab, setTab] = React.useState<ResearchTab>("patterns")
  const [look, setLook] = React.useState(research.labels[0]?.label ?? "")
  const used = new Map<string, string>()
  for (const list of LISTS) for (const k of strategy[list.key]) used.set(k, list.label)
  const rows: KeywordStat[] =
    tab === "patterns"
      ? research.patterns
      : tab === "generic"
        ? research.generic
        : tab === "openers"
          ? [...research.openers, ...research.segments.filter((s) => !research.openers.some((o) => o.keyword === s.keyword))].slice(0, 60)
          : (research.labels.find((l) => l.label === look)?.keywords ?? [])
  const top = Math.max(...rows.map((r) => r.weight), 0.01)

  return (
    <section aria-labelledby="kw-research" className="flex min-w-0 flex-col rounded-lg border lg:sticky lg:top-4 lg:max-h-[calc(100svh-6rem)]">
      <header className="flex flex-col gap-2 border-b px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h2 id="kw-research" className="text-sm font-semibold">
            Research
          </h2>
          <span className="text-xs text-muted-foreground">sales a month of the listings using it</span>
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as ResearchTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="patterns">Patterns</TabsTrigger>
            <TabsTrigger value="generic">Place-free</TabsTrigger>
            <TabsTrigger value="openers">Titles</TabsTrigger>
            <TabsTrigger value="looks" disabled={!research.labels.length}>
              By look
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === "looks" && (
          <div className="flex flex-wrap gap-1">
            {research.labels.map((l) => (
              <button
                key={l.label}
                type="button"
                onClick={() => setLook(l.label)}
                aria-pressed={look === l.label}
                className={cn(
                  "h-6 rounded-md px-2 text-xs transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] [@media(hover:hover)]:hover:bg-muted",
                  look === l.label ? "bg-muted font-medium text-foreground" : "text-muted-foreground"
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {rows.map((row) => {
          const where = used.get(row.keyword)
          return (
            <li key={row.keyword} className="group/kw relative flex items-center gap-2 px-4 py-1.5 [@media(hover:hover)]:hover:bg-muted/50">
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs">
                    <Pattern text={row.keyword} />
                  </span>
                  <span
                    className="shrink-0 text-[10px] text-muted-foreground tabular-nums"
                    title={`${row.listings.toLocaleString("en-US")} listings · ${row.places.toLocaleString("en-US")} places · ${row.shops} shops`}
                  >
                    {row.weight.toLocaleString("en-US", { maximumFractionDigits: row.weight < 10 ? 1 : 0 })}/mo · {row.shops} shops
                  </span>
                </span>
                <span className="h-1 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-series-1" style={{ width: `${Math.max(2, (row.weight / top) * 100)}%` }} />
                </span>
              </span>
              {where ? (
                <span className="flex w-6 shrink-0 justify-center text-emerald-600 dark:text-emerald-400" title={`In “${where}”`}>
                  <CheckIcon className="size-3.5" />
                </span>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Add ${row.keyword} to the strategy`}
                        className="shrink-0 opacity-60 [@media(hover:hover)]:group-hover/kw:opacity-100"
                      />
                    }
                  >
                    <PlusIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Add to the strategy</DropdownMenuLabel>
                      {LISTS.filter((l) => l.key !== "avoid").map((l) => (
                        <DropdownMenuItem key={l.key} onClick={() => onAdd(l.key, row.keyword)}>
                          <PlusIcon />
                          {l.label}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuItem onClick={() => onAdd("avoid", row.keyword)}>
                        <BanIcon />
                        Never use it
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// --- One place ---

function PlacePicker({ value, onChange }: { value: PlaceHit | null; onChange: (place: PlaceHit) => void }) {
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState("")
  const [hits, setHits] = React.useState<PlaceHit[]>([])
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    const timer = setTimeout(() => void searchPlaces(q).then((h) => !cancelled && setHits(h), () => {}), q ? 150 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [q, open])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs active:scale-[0.97]" />}>
        <MapPinIcon className="size-3.5" />
        {value?.name ?? "a place"}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-0 p-1.5">
        <InputGroup className="mb-1 h-8">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a place" aria-label="Find a place" />
        </InputGroup>
        <ul className="flex flex-col">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(hit)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none focus-visible:bg-muted [@media(hover:hover)]:hover:bg-muted"
              >
                <TierBadge tier={hit.tier} className="size-[18px] text-[10px]" />
                <span className="truncate">{hit.name}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">{hit.countryName}</span>
              </button>
            </li>
          ))}
          {!hits.length && <li className="px-2 py-3 text-center text-xs text-muted-foreground">No place by that name</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function PlaceLookup() {
  const [place, setPlace] = React.useState<PlaceHit | null>(null)
  const [words, setWords] = React.useState<PlaceKeywords | null>(null)
  // Loading while the words shown are another place's.
  const loading = !!place && words?.placeId !== place.id

  React.useEffect(() => {
    if (!place) return
    let cancelled = false
    fetchPlaceKeywords(place.id).then(
      (w) => !cancelled && setWords(w),
      (e: Error) => !cancelled && toast.error(e.message)
    )
    return () => {
      cancelled = true
    }
  }, [place])

  const top = Math.max(...(words?.tags ?? []).map((t) => t.weight), 0.01)
  return (
    <section aria-labelledby="kw-place" className="flex flex-col rounded-lg border">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 id="kw-place" className="text-sm font-semibold">
          One place&apos;s own words
        </h2>
        <span className="text-xs text-muted-foreground">what the city shops&apos; listings for it use, tags as they are</span>
        <div className="ml-auto">
          <PlacePicker value={place} onChange={setPlace} />
        </div>
      </header>
      {!place ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">Pick a place to see its tags and best selling titles.</p>
      ) : loading && !words ? (
        <div className="p-4">
          <Skeleton className="h-32 rounded-md" />
        </div>
      ) : words ? (
        <div className={cn("grid gap-6 p-4 md:grid-cols-2", loading && "opacity-60")}>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Tags · {words.listings.toLocaleString("en-US")} listings</span>
            <ul className="flex flex-col gap-1">
              {words.tags.slice(0, 24).map((t) => (
                <li key={t.keyword} className="grid grid-cols-[minmax(0,1fr)_6rem_3rem] items-center gap-2 text-xs">
                  <span className="truncate">{t.keyword}</span>
                  <span className="h-1 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-series-1" style={{ width: `${Math.max(3, (t.weight / top) * 100)}%` }} />
                  </span>
                  <span className="text-right text-[10px] text-muted-foreground tabular-nums">{t.listings}×</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Best selling titles</span>
            <ul className="flex flex-col gap-2">
              {words.titles.map((t, i) => (
                <li key={i} className="flex flex-col gap-0.5">
                  <span className="text-xs leading-snug text-pretty">{t.title}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {t.shop} · {t.spm.toLocaleString("en-US", { maximumFractionDigits: 1 })} sales a month · {t.fav} favourites
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  )
}
