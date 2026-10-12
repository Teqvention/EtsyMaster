"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import { CheckIcon, ImagesIcon, LayersIcon, ListIcon, LoaderCircleIcon, ScanSearchIcon, SlidersHorizontalIcon, SparklesIcon, StoreIcon } from "lucide-react"
import { toast } from "sonner"

import { RequestEditor, TemplatePicker } from "@/components/citys/request-editor"
import { CityRail, DEFAULT_RAIL, filterCities, type RailFilter } from "@/components/citys/stealer/city-rail"
import { RefCard } from "@/components/citys/stealer/ref-card"
import { RefStudio } from "@/components/citys/stealer/ref-studio"
import { TierBadge } from "@/components/citys/tier"
import { SelectionBar } from "@/components/selection"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { patchCitySettings } from "@/hooks/use-city-ranking"
import { fetchStrips, generateCities, refreshStealer, useStealer, useStealerCity } from "@/hooks/use-stealer"
import { useStored } from "@/hooks/use-stored"
import type { StealerCityRow, StealerRef, StealerState } from "@/lib/citys/stealer"
import { DEFAULT_REQUEST, normalizeRequest, requestSize, type CityRequest } from "@/lib/citys/studio-types"
import { formatNumber, formatRate } from "@/lib/etsy/format"
import { cn } from "@/lib/utils"

// The City Stealer: the places worth making, best first, down the left; the
// competitors' city photos of the open place on the right, taken out of
// their posters. A click opens a photo with everything that can be asked
// for; Scale mode turns clicks into a pick (across places, in the
// all-places view too), and one button sends the whole pick off with one
// set of settings, each photo keeping settings of its own where it has some.

type Kind = "photos" | "art" | "all"
type View = "city" | "all"

const RAIL_KEY = "citys-stealer:rail"
const REQUEST_KEY = "citys-stealer:request"

/** A pick's key: place and listing, as the same photo can belong to two places. */
const keyOf = (placeId: string, listingId: number) => `${placeId}|${listingId}`

export function StealerView() {
  const state = useStealer()
  const params = useSearchParams()
  const router = useRouter()
  // The rail's filters and the request are remembered by the browser; the search isn't.
  const [storedRail, keepRail] = useStored<RailFilter>(RAIL_KEY, DEFAULT_RAIL)
  const [search, setSearch] = React.useState("")
  const rail = React.useMemo(() => ({ ...storedRail, search }), [storedRail, search])
  const [storedRequest, keepRequest] = useStored<CityRequest>(REQUEST_KEY, DEFAULT_REQUEST)
  // Saved before skies, a request reads as the nearest one now.
  const request = React.useMemo(() => normalizeRequest(storedRequest), [storedRequest])
  const [view, setView] = React.useState<View>("city")
  const [kind, setKind] = React.useState<Kind>("photos")
  const [current, setCurrent] = React.useState<string | null>(params.get("place"))
  const [scaling, setScaling] = React.useState(false)
  const [picked, setPicked] = React.useState<Map<string, { city: StealerCityRow; ref: StealerRef }>>(new Map())
  const [overrides, setOverrides] = React.useState<Map<string, CityRequest>>(new Map())
  const [studio, setStudio] = React.useState<{ ref: StealerRef; city: StealerCityRow; mode: "open" | "settings"; request: CityRequest } | null>(null)
  const [busy, setBusy] = React.useState(false)

  const cities = React.useMemo(() => (state ? filterCities(state.cities, { ...rail, photos: kind === "photos" }) : []), [state, rail, kind])
  const byId = React.useMemo(() => new Map((state?.cities ?? []).map((c) => [c.id, c])), [state])
  // The open place: the one asked for, else the first of the list.
  const placeId = current && byId.has(current) ? current : (cities[0]?.id ?? null)
  const city = placeId ? (byId.get(placeId) ?? null) : null

  function updateRail(change: Partial<RailFilter>) {
    const { search: typed, ...rest } = change
    if (typed !== undefined) setSearch(typed)
    if (Object.keys(rest).length) keepRail({ ...storedRail, ...rest, search: "" })
  }

  function updateRequest(next: CityRequest) {
    keepRequest(next)
  }

  function pick(id: string) {
    setCurrent(id)
    const url = new URL(window.location.href)
    url.searchParams.set("place", id)
    window.history.replaceState(null, "", url)
  }

  function toggle(c: StealerCityRow, ref: StealerRef) {
    setPicked((map) => {
      const next = new Map(map)
      const key = keyOf(c.id, ref.listingId)
      if (next.has(key)) next.delete(key)
      else next.set(key, { city: c, ref })
      return next
    })
  }

  function open(c: StealerCityRow, ref: StealerRef, event?: React.MouseEvent) {
    if (scaling || event?.shiftKey || event?.metaKey) return toggle(c, ref)
    setStudio({ ref, city: c, mode: "open", request: overrides.get(keyOf(c.id, ref.listingId)) ?? request })
  }

  function settings(c: StealerCityRow, ref: StealerRef) {
    setStudio({ ref, city: c, mode: "settings", request: overrides.get(keyOf(c.id, ref.listingId)) ?? request })
  }

  const total = [...picked.keys()].reduce((n, key) => n + requestSize(overrides.get(key) ?? request), 0)
  const placesPicked = new Set([...picked.values()].map((p) => p.city.id)).size

  async function generatePick() {
    setBusy(true)
    try {
      const jobs = [...picked.entries()].map(([key, { city: c, ref }]) => ({
        placeId: c.id,
        place: c.name,
        country: c.country,
        ref: { listingId: ref.listingId, shopId: ref.shopId, shop: ref.shop, title: ref.title, image: ref.short, tags: ref.tags, labels: ref.labels },
        request: overrides.get(key) ?? request,
      }))
      await generateCities(jobs)
      toast.success(`${formatNumber(total)} images of ${placesPicked} ${placesPicked === 1 ? "place" : "places"} on their way`, {
        description: "They land in Citys → Outputs.",
        action: { label: "Open", onClick: () => router.push("/citys/outputs") },
      })
      setPicked(new Map())
      setOverrides(new Map())
    } catch (error) {
      toast.error(`Couldn't start it: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  if (!state) {
    return (
      <div className="grid gap-4 px-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:px-6">
        <Skeleton className="h-[70svh] rounded-lg" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/5] rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 px-4 lg:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border p-0.5" role="group" aria-label="View">
          <ViewButton on={view === "city"} onClick={() => setView("city")} icon={<ImagesIcon />} label="One place" />
          <ViewButton on={view === "all"} onClick={() => setView("all")} icon={<ListIcon />} label="All places" />
        </div>
        <div className="flex rounded-lg border p-0.5" role="group" aria-label="References shown">
          {(["photos", "art", "all"] as const).map((k) => (
            <ViewButton key={k} on={kind === k} onClick={() => setKind(k)} label={k === "photos" ? "Photo refs" : k === "art" ? "Illustration refs" : "Both"} />
          ))}
        </div>
        <ShopsPopover state={state} />
        <div className="ml-auto flex items-center gap-2">
          <label
            className={cn(
              "flex h-7 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition-[border-color,background-color] duration-150",
              request.realPhoto ? "border-brand/50 bg-brand/5" : "text-muted-foreground"
            )}
            title={request.realPhoto ? "Everything comes out as a real photo, even from an illustration" : "Off: every image keeps the reference's own look (a sketch makes sketches)"}
          >
            Real photos
            <Switch size="sm" checked={request.realPhoto} onCheckedChange={(realPhoto) => updateRequest({ ...request, realPhoto })} />
          </label>
          <TemplatePicker value={request} onPick={(next) => updateRequest(normalizeRequest(next))} />
          <Popover>
            <PopoverTrigger render={<Button variant="outline" size="sm" />}>
              <SlidersHorizontalIcon />
              {request.auto.on ? `Auto · ${requestSize(request)} per photo` : `${requestSize(request)} per photo`}
            </PopoverTrigger>
            <PopoverContent align="end" className="max-h-[75svh] w-[24rem] overflow-y-auto">
              <RequestEditor value={request} onChange={updateRequest} compact />
            </PopoverContent>
          </Popover>
          <Button
            variant={scaling ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setScaling((s) => !s)
              if (scaling) setPicked(new Map())
            }}
            className="active:scale-[0.97]"
            aria-pressed={scaling}
            title="Scale mode: clicks pick photos, one button makes them all"
          >
            <LayersIcon />
            Scale mode
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-0 lg:h-[calc(100svh-var(--header-height)-6.5rem)]">
          <CityRail cities={cities} filter={rail} onFilter={updateRail} current={placeId} onPick={pick} />
        </aside>
        <main className="min-w-0">
          {view === "city" ? (
            city ? (
              <CityRefs
                city={city}
                kind={kind}
                scaling={scaling}
                picked={picked}
                overrides={overrides}
                onOpen={open}
                onSettings={settings}
                onPickAll={(refs) =>
                  setPicked((map) => {
                    const next = new Map(map)
                    for (const ref of refs) next.set(keyOf(city.id, ref.listingId), { city, ref })
                    return next
                  })
                }
              />
            ) : (
              <NoPlace />
            )
          ) : (
            <AllPlaces cities={cities} kind={kind} scaling={scaling} picked={picked} overrides={overrides} onOpen={open} onSettings={settings} onFocus={pick} />
          )}
        </main>
      </div>

      <SelectionBar count={picked.size} total={picked.size} onSelectAll={() => {}} onClear={() => setPicked(new Map())}>
        <span className="px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {placesPicked} {placesPicked === 1 ? "place" : "places"} · {formatNumber(total)} images
        </span>
        <Button size="sm" onClick={generatePick} disabled={busy || !total} className="active:scale-[0.97]">
          {busy ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
          Generate
        </Button>
      </SelectionBar>

      <RefStudio
        item={studio?.ref ?? null}
        city={studio?.city ?? null}
        request={studio?.request ?? request}
        onRequest={(next) => setStudio((s) => (s ? { ...s, request: next } : s))}
        mode={studio?.mode ?? "open"}
        onClose={() => setStudio(null)}
        onKeep={(next) => {
          if (!studio) return
          const key = keyOf(studio.city.id, studio.ref.listingId)
          setOverrides((map) => {
            const out = new Map(map)
            if (next) out.set(key, next)
            else out.delete(key)
            return out
          })
          if (next && !picked.has(key)) toggle(studio.city, studio.ref)
          setStudio(null)
        }}
      />
    </div>
  )
}

function ViewButton({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon?: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5",
        on ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function ShopsPopover({ state }: { state: StealerState }) {
  const picked = state.shops.filter((s) => s.picked).length
  async function toggle(shopId: number, on: boolean) {
    const current = state.shops.filter((s) => s.picked).map((s) => s.shopId)
    const next = on ? [...current, shopId] : current.filter((id) => id !== shopId)
    try {
      await patchCitySettings({ stealer: next.length === state.shops.length ? [] : next })
      await refreshStealer()
    } catch (error) {
      toast.error(`Couldn't change the shops: ${(error as Error).message}`)
    }
  }
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <StoreIcon />
        {picked === state.shops.length ? "All shops" : `${picked} of ${state.shops.length} shops`}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-0">
        <p className="border-b px-3 py-2 text-xs text-muted-foreground">Shops the Stealer takes reference photos from.</p>
        <ul className="max-h-[55svh] overflow-y-auto p-1">
          {state.shops.map((s) => (
            <li key={s.shopId}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm [@media(hover:hover)]:hover:bg-accent">
                <Checkbox checked={s.picked} onCheckedChange={(checked) => toggle(s.shopId, checked === true)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{s.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{s.secondary.join(", ") || "no style tag"}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function NoPlace() {
  return (
    <Empty className="min-h-[50svh] border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ScanSearchIcon />
        </EmptyMedia>
        <EmptyTitle>No place matches</EmptyTitle>
        <EmptyDescription>Show more tiers or every place on the left.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

const kindFilter = (kind: Kind) => (r: StealerRef) => (kind === "all" ? true : kind === "photos" ? r.photo : !r.photo)

function CityRefs({
  city,
  kind,
  scaling,
  picked,
  overrides,
  onOpen,
  onSettings,
  onPickAll,
}: {
  city: StealerCityRow
  kind: Kind
  scaling: boolean
  picked: Map<string, unknown>
  overrides: Map<string, CityRequest>
  onOpen: (city: StealerCityRow, ref: StealerRef, event?: React.MouseEvent) => void
  onSettings: (city: StealerCityRow, ref: StealerRef) => void
  onPickAll: (refs: StealerRef[]) => void
}) {
  const { city: data, error } = useStealerCity(city.id)
  const refs = (data?.refs ?? []).filter(kindFilter(kind))
  const ours = data?.coverage

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <TierBadge tier={city.tier} className="size-6 text-xs" />
          <h2 className="truncate text-lg font-semibold">{city.name}</h2>
          <span className="truncate text-sm text-muted-foreground">{city.countryName}</span>
        </div>
        <dl className="flex gap-4 text-xs tabular-nums">
          <Stat label="Score" value={String(city.score)} />
          <Stat label="Sales/mo" value={formatRate(city.spm)} />
          <Stat label="Favs/mo" value={formatRate(city.favMonth)} />
          <Stat label="Shops" value={String(city.shops)} />
        </dl>
        {ours && ours.listings.length > 0 && (
          <span className="flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs" title={ours.listings.map((l) => `${l.shop}: ${l.title}`).join("\n")}>
            <CheckIcon className="size-3.5 text-emerald-600" />
            {ours.confirmed + ours.open} ours{ours.replace > 0 && <span className="text-amber-700 dark:text-amber-400"> · {ours.replace} to replace</span>}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {scaling && refs.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => onPickAll(refs.slice(0, 6))}>
              Pick the best 6
            </Button>
          )}
          <Link href={`/citys/ranking`} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            Ranking
          </Link>
        </div>
      </header>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !data ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/5] rounded-lg" />
          ))}
        </div>
      ) : refs.length === 0 ? (
        <Empty className="min-h-[40svh] border border-dashed">
          <EmptyHeader>
            <EmptyTitle>No {kind === "photos" ? "real photos" : kind === "art" ? "illustrations" : "references"} of {city.name}</EmptyTitle>
            <EmptyDescription>Switch to {kind === "photos" ? "illustrations or both" : "both"} above, or pick more shops.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-4 gap-y-5">
          {refs.map((ref) => (
            <li key={ref.listingId}>
              <RefCard
                item={ref}
                selecting={scaling}
                selected={picked.has(keyOf(city.id, ref.listingId))}
                custom={overrides.has(keyOf(city.id, ref.listingId))}
                onClick={(event) => onOpen(city, ref, event)}
                onSettings={() => onSettings(city, ref)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  )
}

const STRIP_CHUNK = 12

function AllPlaces({
  cities,
  kind,
  scaling,
  picked,
  overrides,
  onOpen,
  onSettings,
  onFocus,
}: {
  cities: StealerCityRow[]
  kind: Kind
  scaling: boolean
  picked: Map<string, unknown>
  overrides: Map<string, CityRequest>
  onOpen: (city: StealerCityRow, ref: StealerRef, event?: React.MouseEvent) => void
  onSettings: (city: StealerCityRow, ref: StealerRef) => void
  onFocus: (id: string) => void
}) {
  const [strips, setStrips] = React.useState<Record<string, StealerRef[]>>({})
  const [shown, setShown] = React.useState(STRIP_CHUNK)
  const visible = cities.slice(0, shown)
  const missing = visible.filter((c) => !(c.id in strips)).map((c) => c.id)
  const missingKey = missing.join(",")

  // Another list (filters, photos or all): its strips are read anew.
  const [basis, setBasis] = React.useState({ cities, kind })
  if (basis.cities !== cities || basis.kind !== kind) {
    setBasis({ cities, kind })
    setStrips({})
    setShown(STRIP_CHUNK)
  }

  React.useEffect(() => {
    if (!missingKey) return
    let alive = true
    fetchStrips(missingKey.split(","), 10, kind === "photos")
      .then((got) => alive && setStrips((s) => ({ ...s, ...got })))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [missingKey, kind])

  // Strips whose crops are on their way are read again a little later.
  const waiting = visible.filter((c) => strips[c.id]?.some((r) => r.crop.status === "none" || r.crop.status === "running")).map((c) => c.id)
  const waitingKey = waiting.join(",")
  React.useEffect(() => {
    if (!waitingKey) return
    const timer = setTimeout(() => {
      fetchStrips(waitingKey.split(","), 10, kind === "photos").then((got) => setStrips((s) => ({ ...s, ...got })), () => {})
    }, 6000)
    return () => clearTimeout(timer)
  }, [waitingKey, kind, strips])

  const sentinel = React.useCallback(
    (node: HTMLElement | null) => {
      if (!node || shown >= cities.length) return
      const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setShown((n) => n + STRIP_CHUNK), { rootMargin: "0px 0px 800px 0px" })
      observer.observe(node)
      return () => observer.disconnect()
    },
    [shown, cities.length]
  )

  return (
    <div className="flex flex-col gap-6">
      {visible.map((c) => {
        const refs = (strips[c.id] ?? []).filter(kindFilter(kind))
        return (
          <section key={c.id} className="flex flex-col gap-2">
            <header className="flex items-center gap-2">
              <TierBadge tier={c.tier} />
              <button type="button" onClick={() => onFocus(c.id)} className="truncate text-sm font-semibold outline-none hover:underline focus-visible:underline">
                {c.name}
              </button>
              <span className="truncate text-xs text-muted-foreground">
                {c.countryName} · {formatRate(c.spm)} sales/mo · {kind === "photos" ? c.photos : c.refs} refs
              </span>
            </header>
            {!(c.id in strips) ? (
              <div className="flex gap-3 overflow-hidden">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="aspect-[4/5] w-36 shrink-0 rounded-lg" />
                ))}
              </div>
            ) : refs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No references of this kind.</p>
            ) : (
              <ul className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
                {refs.map((ref) => (
                  <li key={ref.listingId} className="w-36 shrink-0">
                    <RefCard
                      size="sm"
                      item={ref}
                      selecting={scaling}
                      selected={picked.has(keyOf(c.id, ref.listingId))}
                      custom={overrides.has(keyOf(c.id, ref.listingId))}
                      onClick={(event) => onOpen(c, ref, event)}
                      onSettings={() => onSettings(c, ref)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
      {shown < cities.length && <div ref={sentinel} aria-hidden className="h-px" />}
    </div>
  )
}
