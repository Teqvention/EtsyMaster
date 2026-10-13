"use client"

import Link from "next/link"
import * as React from "react"
import { CheckIcon, CombineIcon, ExternalLinkIcon, PencilIcon, ScanSearchIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { editPlace } from "@/hooks/use-city-ranking"
import { PLACE_KINDS, SETTINGS, type PlaceKind, type RankedPlace, type Setting } from "@/lib/citys/types"
import { formatCompact, formatNumber, formatRate } from "@/lib/etsy/format"

// One place opened in the ranking: its districts and landmarks with their
// own numbers (and, sold by their own name, their own tier and whether one
// is worth a poster of its own), its best listings across the shops, and what the register
// says about it, put right by hand when Gemini got it wrong (another kind,
// size or setting, its tags, or folded into the place it really is).

export function PlaceDetail({ place, all }: { place: RankedPlace; all: RankedPlace[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_17rem]">
      <section className="min-w-0" aria-label="Sub-places">
        <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">
          {place.children.length ? `In ${place.name}` : "No districts or landmarks of its own"}
        </h4>
        {place.children.length > 0 && (
          <ul className="flex max-h-64 flex-col overflow-y-auto">
            {place.children.map((c) => (
              <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_3.5rem_3rem_2.5rem] items-center gap-2 border-b py-1 text-xs last:border-b-0">
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium">{c.name}</span>
                    {c.poster && <span className="shrink-0 rounded-full bg-brand/10 px-1.5 text-[10px] font-medium text-brand">{c.poster === "test" ? "Test poster" : "Own poster"}</span>}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    <span className="capitalize">{c.kind}</span>
                    {c.own && (
                      <span title="The listings that lead with its own name, scored on the places' own scale">
                        {" "}
                        · by its own name {c.own.tier} {c.own.score} · {formatRate(c.own.spm)} sales/mo in {c.own.shops} shop{c.own.shops === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                </span>
                <span className="text-right tabular-nums" title="Sales a month">
                  {formatRate(c.spm)}
                </span>
                <span className="text-right text-muted-foreground tabular-nums" title="Favorites a month">
                  {formatRate(c.favMonth)}
                </span>
                <span className="text-right text-muted-foreground tabular-nums" title="Listings">
                  {formatCompact(c.listings)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="min-w-0" aria-label="Best listings">
        <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">Best listings</h4>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {place.top.map((l) => (
            <li key={l.listingId} className="min-w-0">
              <a
                href={`https://www.etsy.com/listing/${l.listingId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group/l flex flex-col gap-1 outline-none"
                title={l.title}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={l.image} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-md bg-muted object-cover transition-opacity duration-150 group-focus-visible/l:ring-2 group-focus-visible/l:ring-ring/50 [@media(hover:hover)]:group-hover/l:opacity-90" />
                <span className="truncate text-[11px] font-medium">{l.shop}</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {formatRate(l.spm)} sales/mo · {formatCompact(l.fav)} favs
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex min-w-0 flex-col gap-2" aria-label="About the place">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" nativeButton={false} render={<Link href={`/citys/stealer?place=${encodeURIComponent(place.id)}`} />}>
            <ScanSearchIcon />
            Open in Stealer
          </Button>
          <EditPlace place={place} />
          <MergePlace place={place} all={all} />
        </div>
        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Setting</dt>
          <dd className="capitalize">{place.setting}</dd>
          <dt className="text-muted-foreground">Tags</dt>
          <dd>{place.tags.join(", ") || "–"}</dd>
          <dt className="text-muted-foreground">Momentum</dt>
          <dd>{place.rising ? `${formatNumber(Math.round(place.rising))} listings rising or new and drawing` : "–"}</dd>
          <dt className="text-muted-foreground">Up for</dt>
          <dd>{place.exposureDays ? `${formatNumber(place.exposureDays)} days (oldest listing)` : "–"}</dd>
          <dt className="text-muted-foreground">Revenue</dt>
          <dd>{formatCompact(Math.round(place.rev / 100))} a month, est.</dd>
        </dl>
        <a
          href={`https://www.etsy.com/search?q=${encodeURIComponent(`${place.name} print`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          “{place.name} print” on Etsy
          <ExternalLinkIcon className="size-3" />
        </a>
      </section>
    </div>
  )
}

const KINDS = PLACE_KINDS.map((k) => ({ value: k, label: k.charAt(0).toUpperCase() + k.slice(1) }))
const SIZES = [
  { value: "none", label: "–" },
  { value: "big", label: "Big (over 1M)" },
  { value: "mid", label: "Mid-size (100k–1M)" },
  { value: "small", label: "Small (under 100k)" },
]
const SETTING_ITEMS = SETTINGS.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))

function EditPlace({ place }: { place: RankedPlace }) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(place.name)
  const [kind, setKind] = React.useState<PlaceKind>(place.kind)
  const [size, setSize] = React.useState<string>(place.size ?? "none")
  const [setting, setSetting] = React.useState<Setting>(place.setting)
  const [region, setRegion] = React.useState(place.region ?? "")
  const [tags, setTags] = React.useState(place.tags.join(", "))
  const [busy, setBusy] = React.useState(false)

  async function save() {
    setBusy(true)
    try {
      await editPlace(place.id, {
        name,
        kind,
        size: size === "none" ? undefined : (size as RankedPlace["size"]),
        setting,
        region,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      })
      setOpen(false)
      toast.success(`${name} saved`)
    } catch (error) {
      toast.error(`Couldn't save it: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setName(place.name)
          setKind(place.kind)
          setSize(place.size ?? "none")
          setSetting(place.setting)
          setRegion(place.region ?? "")
          setTags(place.tags.join(", "))
        }
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <PencilIcon />
        Edit
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-2.5">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Name
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <PickField label="Kind" value={kind} items={KINDS} onChange={(v) => setKind(v as PlaceKind)} />
          <PickField label="Size" value={size} items={SIZES} onChange={setSize} />
          <PickField label="Setting" value={setting} items={SETTING_ITEMS} onChange={(v) => setSetting(v as Setting)} />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Region
            <Input value={region} onChange={(e) => setRegion(e.target.value)} className="h-8" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Tags, comma separated
          <Input value={tags} onChange={(e) => setTags(e.target.value)} className="h-8" placeholder="beach, coastal, old town" />
        </label>
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy || !name.trim()}>
            <CheckIcon />
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function PickField({ label, value, items, onChange }: { label: string; value: string; items: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Select value={value} items={items} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

function MergePlace({ place, all }: { place: RankedPlace; all: RankedPlace[] }) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const needle = query.trim().toLowerCase()
  const matches = needle
    ? all.filter((p) => p.id !== place.id && p.name.toLowerCase().includes(needle)).slice(0, 8)
    : all.filter((p) => p.id !== place.id && p.country === place.country).slice(0, 8)

  async function merge(into: RankedPlace) {
    try {
      await editPlace(place.id, { mergeInto: into.id })
      setOpen(false)
      toast.success(`${place.name} is now part of ${into.name}`)
    } catch (error) {
      toast.error(`Couldn't merge: ${(error as Error).message}`)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <CombineIcon />
        Same as…
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-2 p-2">
        <p className="px-1 text-xs text-muted-foreground">
          Fold {place.name} into the place it really is: its listings, names and sub-places go there.
        </p>
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find the place" className="h-8" />
        <ul className="flex flex-col">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => merge(p)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm outline-none focus-visible:bg-accent [@media(hover:hover)]:hover:bg-accent"
              >
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{p.countryName}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
