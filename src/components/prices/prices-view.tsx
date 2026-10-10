"use client"

import { useSearchParams } from "next/navigation"
import * as React from "react"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { StatStrip } from "@/components/listings/stat-strip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { createProfile, usePrices } from "@/hooks/use-prices"
import { SIZE_KEYS, type SizeKey } from "@/lib/catalog/sizes"
import { formatPercent } from "@/lib/etsy/format"
import { profitOf } from "@/lib/pricing/profit"

import { Assumptions } from "./assumptions"
import { MarketPanel } from "./market-panel"
import { ProfileEditor } from "./profile-editor"
import { ProfilesChart } from "./profiles-chart"
import { ProfitBars } from "./profit-bars"
import { Em, eur, Panel, shortSize } from "./shared"
import { ShopsPanel } from "./shops-panel"

// The price profiles the shops sell at, worked through: what each size
// leaves over once Gelato printed and shipped it and Etsy took its fees, how
// the profiles sit against each other and against strong shops, and which
// shop uses which. Every number reacts to unsaved prices as they're typed.

type Prices = Record<SizeKey, number>

export function PricesView() {
  const state = usePrices()
  const [profileId, setProfileId] = useProfileParam()
  const [drafts, setDrafts] = React.useState<Record<string, Prices>>({})
  const [creating, setCreating] = React.useState<{ from: Prices; name: string } | null>(null)

  if (!state) return <Loading />
  if (!state.profiles.length) {
    return (
      <div className="px-4 lg:px-6">
        <Empty className="min-h-[50svh] border border-dashed">
          <EmptyHeader>
            <EmptyTitle>No price profiles</EmptyTitle>
            <EmptyDescription>Low, mid and high are made the first time the page loads. Reload to try again.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  const profile = state.profiles.find((p) => p.id === profileId) ?? state.profiles.find((p) => p.id === "mid") ?? state.profiles[0]
  const draft = drafts[profile.id] ?? profile.prices
  const rows = SIZE_KEYS.map((key) => ({
    key,
    profit: profitOf(draft[key], state.costs.sizes[key], state.assumptions, state.usd.rate),
  }))

  const setDraft = (prices: Prices | null) =>
    setDrafts((all) => {
      const next = { ...all }
      if (prices) next[profile.id] = prices
      else delete next[profile.id]
      return next
    })

  return (
    <div className="flex flex-col gap-3 px-4 lg:px-6">
      <p className="max-w-2xl text-sm text-muted-foreground">
        What every size costs the buyer, and what it leaves over once Gelato printed and shipped it and Etsy took its
        fees. Each shop sells at one profile; new listings get its prices.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={profile.id} onValueChange={(value) => setProfileId(String(value))}>
          <TabsList>
            {state.profiles.map((p) => (
              <TabsTrigger key={p.id} value={p.id} className="px-2.5">
                {p.name}
                {drafts[p.id] && <span className="size-1.5 rounded-full bg-brand" aria-label="unsaved changes" />}
                {p.usedBy.length > 0 && (
                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px] tabular-nums" title={`Used by ${p.usedBy.join(", ")}`}>
                    {p.usedBy.length}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCreating({ from: draft, name: "" })}
          className="text-muted-foreground"
        >
          <PlusIcon />
          New profile
        </Button>
      </div>

      <Summary name={profile.name} rows={rows} />

      <div className="grid items-start gap-3 @5xl/main:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
          <Assumptions state={state} />
          <ProfileEditor
            key={profile.id}
            state={state}
            profile={profile}
            draft={draft}
            rows={rows}
            onDraft={setDraft}
          />
          <p className="text-xs text-muted-foreground">
            Shipping is free for the buyer, so it&apos;s inside the price. Not counted: Offsite Ads (12–15 % of a sale
            they bring), Etsy Ads, refunds and the shop&apos;s fixed costs; Performance has those as they happen.
          </p>
        </section>

        <div className="flex min-w-0 flex-col gap-3">
          <Panel title="Profiles against each other">
            <ProfilesChart state={state} shownId={profile.id} draft={draft} />
          </Panel>
          <ShopsPanel state={state} />
          <MarketPanel
            state={state}
            ours={{ name: profile.name, fromCents: Math.min(...Object.values(draft)) }}
            onUseSuggestion={() => state.suggestion && setCreating({ from: state.suggestion.prices, name: "Market" })}
          />
        </div>
      </div>

      <NewProfileDialog
        creating={creating}
        onClose={() => setCreating(null)}
        onCreated={(id) => {
          setCreating(null)
          setProfileId(id)
        }}
      />
    </div>
  )
}

// --- Headline ---

function Summary({
  name,
  rows,
}: {
  name: string
  rows: { key: SizeKey; profit: ReturnType<typeof profitOf> }[]
}) {
  const margins = rows.map((r) => r.profit.margin)
  const average = margins.reduce((sum, m) => sum + m, 0) / margins.length
  const weakest = rows.reduce((low, r) => (r.profit.margin < low.profit.margin ? r : low))
  const strongest = rows.reduce((high, r) => (r.profit.profitCents > high.profit.profitCents ? r : high))
  const losing = rows.filter((r) => r.profit.profitCents <= 0)
  const typical = rows.find((r) => r.key === "50x70") ?? rows[0]

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-pretty">
        {losing.length ? (
          <>
            At {name}, <Em>{losing.map((r) => shortSize(r.key)).join(", ")}</Em> {losing.length === 1 ? "loses" : "lose"}{" "}
            money on every sale.
          </>
        ) : (
          <>
            At {name}, a {shortSize(typical.key)} poster leaves <Em>{eur(typical.profit.profitCents)}</Em> of{" "}
            {eur(typical.profit.priceCents)}; the thinnest size is {shortSize(weakest.key)} at{" "}
            <Em>{formatPercent(weakest.profit.margin)}</Em>.
          </>
        )}
      </p>
      <StatStrip
        className="grid-cols-2 @xl/main:grid-cols-5"
        stats={[
          { label: "Average margin", value: formatPercent(average), hint: "Profit as a share of price, sizes weighted equally" },
          {
            label: "Thinnest",
            value: (
              <>
                {formatPercent(weakest.profit.margin)}{" "}
                <span className="text-sm font-normal text-muted-foreground">{shortSize(weakest.key)}</span>
              </>
            ),
          },
          {
            label: "Most per sale",
            value: (
              <>
                {eur(strongest.profit.profitCents)}{" "}
                <span className="text-sm font-normal text-muted-foreground">{shortSize(strongest.key)}</span>
              </>
            ),
          },
          {
            label: "From",
            value: eur(Math.min(...rows.map((r) => r.profit.priceCents))),
            hint: "The price Etsy shows on the listing: its cheapest size",
          },
          { label: "Per size", value: <ProfitBars rows={rows} /> },
        ]}
      />
    </div>
  )
}

// --- New profile ---

function NewProfileDialog({
  creating,
  onClose,
  onCreated,
}: {
  creating: { from: Prices; name: string } | null
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  // Each opening starts from the name it was opened with.
  const [opened, setOpened] = React.useState(creating)
  if (creating !== opened) {
    setOpened(creating)
    if (creating) setName(creating.name)
  }

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (!creating || !name.trim()) return
    setBusy(true)
    try {
      const profile = await createProfile({ name: name.trim(), tier: "custom", prices: creating.from })
      toast.success(`${profile.name} made`)
      onCreated(profile.id)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!creating} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={create} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New price profile</DialogTitle>
            <DialogDescription>
              Starts from {creating?.name === "Market" ? "the market's medians" : "the prices on screen"}, from{" "}
              {creating ? eur(Math.min(...Object.values(creating.from))) : ""}. Change them after.
            </DialogDescription>
          </DialogHeader>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name, e.g. Gallery" aria-label="Name" autoFocus />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()} className="active:scale-[0.97]">
              Make profile
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// --- Loading ---

function Loading() {
  return (
    <div className="flex flex-col gap-3 px-4 lg:px-6">
      <Skeleton className="h-4 w-96 max-w-full rounded" />
      <Skeleton className="h-8 w-72 rounded-lg" />
      <Skeleton className="h-16 rounded-lg" />
      <div className="grid gap-3 @5xl/main:grid-cols-[minmax(0,1fr)_24rem]">
        <Skeleton className="h-[30rem] rounded-lg" />
        <Skeleton className="h-[30rem] rounded-lg" />
      </div>
    </div>
  )
}

// --- The profile on screen, in the address ---

function useProfileParam() {
  const profile = useSearchParams().get("profile")
  const change = React.useCallback((next: string) => {
    const params = new URLSearchParams(window.location.search)
    params.set("profile", next)
    window.history.replaceState(null, "", `?${params}`)
  }, [])
  return [profile, change] as const
}
