"use client"

import * as React from "react"
import { ClockIcon, LightbulbIcon, LoaderCircleIcon, PlusIcon, XIcon, ZapIcon } from "lucide-react"

import { LabTile } from "@/components/citys/styles/lab-rounds"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { Round } from "@/hooks/use-city-style"
import type { LabImage, StyleCandidate } from "@/lib/citys/studio-types"
import { cn } from "@/lib/utils"

// New ideas for a style: a few nearby but different styles, each painted on
// the same cities (one poster each, or a set of three), next to the style
// itself, and each with what holds it together. One that works becomes the
// main guide or a style of its own.

export type DirectionsAsk = { count: number; cities: { name: string; set: boolean }[]; main: boolean; delivery: "now" | "batch" }

const DEFAULT_CITIES = ["New York City", "London", "Paris"]

export function DirectionsDialog({
  open,
  onOpenChange,
  onStart,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStart: (ask: DirectionsAsk) => Promise<void>
}) {
  const [count, setCount] = React.useState(5)
  const [cities, setCities] = React.useState(DEFAULT_CITIES.map((name) => ({ name, set: false })))
  const [adding, setAdding] = React.useState("")
  const [main, setMain] = React.useState(true)
  const [delivery, setDelivery] = React.useState<"now" | "batch">("now")
  const [busy, setBusy] = React.useState(false)

  const perStyle = cities.reduce((n, c) => n + (c.set ? 3 : 1), 0)
  const total = perStyle * (count + (main ? 1 : 0))

  function add() {
    const name = adding.trim()
    if (!name || cities.length >= 6 || cities.some((c) => c.name.toLowerCase() === name.toLowerCase())) return
    setCities((list) => [...list, { name, set: false }])
    setAdding("")
  }

  async function start() {
    setBusy(true)
    try {
      await onStart({ count, cities, main, delivery })
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LightbulbIcon className="size-4 text-muted-foreground" />
            New ideas for this style
          </DialogTitle>
          <DialogDescription>Nearby but different styles, each painted on the same cities, with what holds it together. Keep one as the main guide or as a style of its own.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Directions</span>
            <div className="flex rounded-lg border p-0.5" role="group" aria-label="How many directions">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={count === n}
                  onClick={() => setCount(n)}
                  className={cn(
                    "h-7 flex-1 rounded-md text-sm font-medium tabular-nums outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
                    count === n ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Cities</span>
            <ul className="flex flex-col gap-1">
              {cities.map((c) => (
                <li key={c.name} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <button
                    type="button"
                    aria-pressed={c.set}
                    onClick={() => setCities((list) => list.map((x) => (x.name === c.name ? { ...x, set: !x.set } : x)))}
                    title="Three pictures of the city that hang together, instead of one poster"
                    className={cn(
                      "h-6 rounded-full border px-2 text-xs outline-none transition-[border-color,background-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
                      c.set ? "border-brand/60 bg-brand/10 text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {c.set ? "Set of 3" : "1 poster"}
                  </button>
                  <Button variant="ghost" size="icon-xs" aria-label={`Remove ${c.name}`} onClick={() => setCities((list) => list.filter((x) => x.name !== c.name))}>
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
            {cities.length < 6 && (
              <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault()
                  add()
                }}
              >
                <Input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Another city, e.g. Sydney" className="h-8" />
                <Button type="submit" variant="outline" size="icon-sm" aria-label="Add city" disabled={!adding.trim()}>
                  <PlusIcon />
                </Button>
              </form>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={main} onCheckedChange={(checked) => setMain(checked === true)} />
            Paint the style itself on them too, to compare
          </label>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Paint</span>
            <div className="flex rounded-lg border p-0.5">
              {(["now", "batch"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={delivery === d}
                  onClick={() => setDelivery(d)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5",
                    delivery === d ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {d === "now" ? <ZapIcon /> : <ClockIcon />}
                  {d === "now" ? "Now" : "In batch"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground tabular-nums">
            {count + (main ? 1 : 0)} styles × {perStyle} = {total} posters
          </span>
          <Button onClick={start} disabled={busy || !cities.length} className="active:scale-[0.97]">
            {busy ? <LoaderCircleIcon className="animate-spin" /> : <LightbulbIcon />}
            Find directions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The latest run of new ideas: the style itself, then each direction, city by city. */
export function DirectionsView({
  candidates,
  rounds,
  onOpen,
  onRate,
  onAdopt,
  onOwn,
  onDrop,
}: {
  candidates: StyleCandidate[]
  rounds: Round[]
  onOpen: (set: string, image: LabImage) => void
  onRate: (round: Round, image: LabImage, rating: "up" | "down" | null) => void
  onAdopt: (id: string) => void
  onOwn: (id: string) => void
  onDrop: (id: string) => void
}) {
  const directions = candidates.filter((c) => c.batch && !c.batch.startsWith("auto-"))
  const batch = directions.at(-1)?.batch
  if (!batch) return null
  const shown = directions.filter((c) => c.batch === batch)
  const main = rounds.find((r) => r.batch === batch && !r.candidate)
  return (
    <div className="flex flex-col gap-3">
      {main && <DirectionRow title="The style itself" round={main} onOpen={onOpen} onRate={onRate} />}
      {shown.map((c) => (
        <DirectionRow
          key={c.id}
          number={candidates.indexOf(c) + 1}
          title={c.name ?? c.label}
          label={c.name ? c.label : undefined}
          consistency={c.consistency}
          round={rounds.find((r) => r.id === c.round)}
          onOpen={onOpen}
          onRate={onRate}
          actions={
            <div className="flex shrink-0 items-center gap-1">
              <Button size="xs" onClick={() => onAdopt(c.id)}>
                Make main
              </Button>
              <Button size="xs" variant="outline" onClick={() => onOwn(c.id)}>
                Own style
              </Button>
              <Button size="xs" variant="ghost" onClick={() => onDrop(c.id)}>
                Drop
              </Button>
            </div>
          }
        />
      ))}
    </div>
  )
}

function DirectionRow({
  number,
  title,
  label,
  consistency,
  round,
  actions,
  onOpen,
  onRate,
}: {
  number?: number
  title: string
  label?: string
  consistency?: string
  round: Round | undefined
  actions?: React.ReactNode
  onOpen: (set: string, image: LabImage) => void
  onRate: (round: Round, image: LabImage, rating: "up" | "down" | null) => void
}) {
  const cities = [...new Set((round?.images ?? []).map((i) => i.city))]
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-3">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {number !== undefined && <span className="mt-0.5 inline-grid size-5 shrink-0 place-items-center rounded-md bg-brand/15 text-xs font-semibold text-brand tabular-nums">{number}</span>}
          <div className="min-w-0">
            <h4 className="text-sm font-semibold">{title}</h4>
            {label && <p className="text-xs text-pretty text-muted-foreground">{label}</p>}
            {consistency && (
              <p className="mt-1 text-[11px] text-pretty text-muted-foreground">
                <span className="font-medium text-foreground">Holds together by: </span>
                {consistency}
              </p>
            )}
          </div>
        </div>
        {actions}
      </header>
      {!round || round.status === "preparing" ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircleIcon className="size-3.5 animate-spin" />
          Getting it ready…
        </p>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {cities.map((city) => (
            <div key={city} className="flex shrink-0 flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">{city}</span>
              <ul className="flex gap-2">
                {round.images
                  .filter((i) => i.city === city)
                  .map((image) => (
                    <li key={image.id} className="w-32">
                      <LabTile set={round.set} image={image} onRate={(r) => onRate(round, image, r)} onOpen={() => onOpen(round.set, image)} />
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
