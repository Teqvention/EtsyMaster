"use client"

import * as React from "react"
import { LoaderCircleIcon, PercentIcon, RotateCcwIcon, TargetIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { deleteProfile, saveProfile } from "@/hooks/use-prices"
import { SIZE_BY_KEY, type SizeKey } from "@/lib/catalog/sizes"
import { formatPercent } from "@/lib/etsy/format"
import { mapPrices, priceForMargin, roundToEnding, type Profit as ProfitRow } from "@/lib/pricing/profit"
import type { PricesState, PriceSpread } from "@/lib/pricing/types"
import { cn } from "@/lib/utils"

import { eur, Profit, shortSize } from "./shared"

// One profile's twelve prices, editable, with what each size leaves over
// beside it and the market's prices where there are any. The tools above work
// on the unsaved prices: change them all by a share, price every size for a
// margin, move the endings, start over from another profile. Nothing counts
// until Save.

type Prices = Record<SizeKey, number>
type Profile = PricesState["profiles"][number]

/** A margin bar runs full at this share. */
const FULL_MARGIN = 0.6

export function ProfileEditor({
  state,
  profile,
  draft,
  rows,
  onDraft,
}: {
  state: PricesState
  profile: Profile
  draft: Prices
  rows: { key: SizeKey; profit: ProfitRow }[]
  /** New unsaved prices, or null once they're saved or thrown away. */
  onDraft: (prices: Prices | null) => void
}) {
  const [saving, setSaving] = React.useState(false)
  const dirty = rows.some(({ key }) => draft[key] !== profile.prices[key])
  const ending = endingOf(draft)
  const market = state.market.sizes
  const withMarket = Object.keys(market).length > 0
  const withVat = state.assumptions.salesVat > 0
  const vatNote = state.assumptions.costVat > 0 ? `, with ${Math.round(state.assumptions.costVat * 100)} % VAT` : ""

  const change = (next: Prices) => onDraft(rows.every(({ key }) => next[key] === profile.prices[key]) ? null : next)

  async function save() {
    setSaving(true)
    try {
      await saveProfile(profile.id, { prices: draft })
      onDraft(null)
      toast.success(`${profile.name} saved`, {
        description: profile.usedBy.length ? "New listings get these prices. Artikel moves existing ones." : undefined,
      })
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    try {
      await deleteProfile(profile.id)
      onDraft(null)
      toast.success(`${profile.name} deleted`)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <ChangeByShare onApply={(share) => change(mapPrices(draft, (c) => roundToEnding(c * (1 + share), ending)))} />
        <ForMargin
          ending={ending}
          onApply={(margin) => {
            const missed: SizeKey[] = []
            change(
              mapPrices(draft, (cents, key) => {
                const price = priceForMargin(margin, state.costs.sizes[key], state.assumptions, state.usd.rate)
                if (price === null) missed.push(key)
                return price === null ? cents : roundToEnding(price, ending, "up")
              })
            )
            if (missed.length) toast.info(`No price leaves that much on ${missed.map(shortSize).join(", ")}`)
          }}
        />
        <Select
          value={String(ending)}
          onValueChange={(value) => value !== null && change(mapPrices(draft, (c) => roundToEnding(c, Number(value))))}
          items={endingItems(ending)}
        >
          <SelectTrigger size="sm" aria-label="Price endings">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {endingItems(ending).map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <CopyFrom state={state} profile={profile} onCopy={change} />

        <div className="ml-auto flex items-center gap-1.5">
          {profile.tier === "custom" && (
            <Button
              variant="ghost"
              size="sm"
              disabled={profile.usedBy.length > 0}
              title={profile.usedBy.length ? `Used by ${profile.usedBy.join(", ")}` : undefined}
              onClick={remove}
              className="text-muted-foreground"
            >
              <Trash2Icon />
              Delete
            </Button>
          )}
          {dirty && (
            <>
              <Button variant="ghost" size="sm" onClick={() => onDraft(null)} disabled={saving}>
                <RotateCcwIcon />
                Reset
              </Button>
              <Button size="sm" onClick={save} disabled={saving} className="active:scale-[0.97]">
                {saving && <LoaderCircleIcon className="animate-spin" />}
                Save {profile.name}
              </Button>
            </>
          )}
        </div>
      </div>

      <Table className="text-[13px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent [&>th]:h-8 [&>th]:text-[11px] [&>th]:font-medium [&>th]:text-muted-foreground">
            <TableHead>Size</TableHead>
            <TableHead className="w-28">Price</TableHead>
            <TableHead className="text-right" title={`Gelato's print cost${vatNote}`}>
              Print
            </TableHead>
            <TableHead className="text-right" title={`Gelato's cheapest shipping to the destination${vatNote}`}>
              Shipping
            </TableHead>
            <TableHead
              className="text-right"
              title={`Transaction fee 6.5 %, payment processing 4 % + €0.30, and the $0.20 renewal each sale costs${vatNote}`}
            >
              Etsy
            </TableHead>
            {withVat && (
              <TableHead className="text-right" title="The VAT inside the price that goes to the tax office">
                VAT
              </TableHead>
            )}
            <TableHead className="text-right">Profit</TableHead>
            <TableHead title="Profit as a share of the price">Margin</TableHead>
            {withMarket && (
              <TableHead className="text-right" title="Median price of the size across the market's listings, and its middle half">
                Market
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ key, profit }) => {
            const size = SIZE_BY_KEY[key]
            const shipping = state.costs.sizes[key]?.shippingCents
            return (
              <TableRow key={key} className="[&>td]:py-1">
                <TableCell>
                  <span className="font-medium">{shortSize(key)}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {key.startsWith("a") ? size.cm.replace(/ \(A\d\)/, "") : size.inches}
                  </span>
                </TableCell>
                <TableCell>
                  <PriceInput
                    cents={draft[key]}
                    changed={draft[key] !== profile.prices[key]}
                    label={`Price of ${size.cm}`}
                    onChange={(cents) => change({ ...draft, [key]: cents })}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">{eur(profit.printCents)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {shipping === null || shipping === undefined ? (
                    <span className="text-muted-foreground" title="Gelato hasn't told the shipping cost yet: profit leaves it out">
                      —
                    </span>
                  ) : (
                    eur(profit.shippingCents)
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{eur(profit.feesCents + profit.listingCents)}</TableCell>
                {withVat && <TableCell className="text-right tabular-nums">{eur(profit.salesVatCents)}</TableCell>}
                <TableCell className="text-right font-medium">
                  <Profit cents={profit.profitCents} />
                </TableCell>
                <TableCell>
                  <MarginBar margin={profit.margin} />
                </TableCell>
                {withMarket && (
                  <TableCell className="text-right">
                    <MarketCell spread={market[key]} price={draft[key]} />
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

// --- Cells ---

const euros = (cents: number) => (cents / 100).toFixed(2)

function parseEuros(text: string) {
  const value = Number(text.replace(/[€\s]/g, "").replace(",", "."))
  return text.trim() && Number.isFinite(value) && value >= 0.2 && value < 10_000 ? Math.round(value * 100) : null
}

/** Typed freely; each readable keystroke goes through, and leaving the field shows the price as saved. */
function PriceInput({
  cents,
  changed,
  label,
  onChange,
}: {
  cents: number
  changed: boolean
  label: string
  onChange: (cents: number) => void
}) {
  const [text, setText] = React.useState<string | null>(null)
  const invalid = text !== null && parseEuros(text) === null
  return (
    <div className="relative w-20">
      <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-muted-foreground">€</span>
      <Input
        value={text ?? euros(cents)}
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid || undefined}
        onFocus={(event) => {
          setText(euros(cents))
          event.currentTarget.select()
        }}
        onChange={(event) => {
          setText(event.target.value)
          const next = parseEuros(event.target.value)
          if (next !== null) onChange(next)
        }}
        onBlur={() => setText(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
        }}
        className={cn("h-7 pl-5 text-right tabular-nums md:text-[13px]", changed && "border-brand/60 bg-brand/5")}
      />
    </div>
  )
}

function MarginBar({ margin }: { margin: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("w-12 text-right tabular-nums", margin < 0 && "text-destructive")}>{formatPercent(margin)}</span>
      <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-brand transition-[width] duration-200 ease-out-strong motion-reduce:transition-none"
          style={{ width: `${Math.min(Math.max(margin / FULL_MARGIN, 0), 1) * 100}%` }}
        />
      </span>
    </div>
  )
}

function MarketCell({ spread, price }: { spread?: PriceSpread; price: number }) {
  if (!spread) return <span className="text-muted-foreground">—</span>
  const where = price < spread.p25 ? "below most" : price > spread.p75 ? "above most" : "within the middle half"
  return (
    <span className="tabular-nums" title={`${spread.count} listings · yours is ${where}`}>
      {eur(spread.median)}{" "}
      <span className="text-xs text-muted-foreground">
        {Math.round(spread.p25 / 100)}–{Math.round(spread.p75 / 100)}
      </span>
    </span>
  )
}

// --- Tools ---

/** The cents most prices end in: 90 for x.90. */
function endingOf(prices: Prices) {
  const counts = new Map<number, number>()
  for (const cents of Object.values(prices)) counts.set(cents % 100, (counts.get(cents % 100) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 90
}

const ENDINGS = [90, 95, 99, 0]

function endingItems(current: number) {
  return [...new Set([...ENDINGS, current])].map((cents) => ({
    value: String(cents),
    label: `Ends in .${String(cents).padStart(2, "0")}`,
  }))
}

function ChangeByShare({ onApply }: { onApply: (share: number) => void }) {
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState("")
  const share = Number(text.replace(",", ".")) / 100
  const valid = text.trim() !== "" && Number.isFinite(share) && share > -0.9 && share < 5 && share !== 0

  const apply = (value: number) => {
    onApply(value)
    setOpen(false)
    setText("")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <PercentIcon />
        Change all
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-2 p-3">
        <p className="text-xs text-muted-foreground">Every size up or down by a share, keeping the price endings.</p>
        <div className="grid grid-cols-4 gap-1">
          {[-10, -5, 5, 10].map((p) => (
            <Button key={p} variant="outline" size="xs" onClick={() => apply(p / 100)} className="tabular-nums">
              {p > 0 ? `+${p}` : `−${-p}`} %
            </Button>
          ))}
        </div>
        <form
          className="flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (valid) apply(share)
          }}
        >
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            inputMode="decimal"
            placeholder="e.g. 7.5 or -3"
            aria-label="Change in percent"
            className="h-7"
          />
          <Button type="submit" size="sm" disabled={!valid}>
            Apply
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function ForMargin({ ending, onApply }: { ending: number; onApply: (margin: number) => void }) {
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState("35")
  const margin = Number(text.replace(",", ".")) / 100
  const valid = Number.isFinite(margin) && margin > 0 && margin < 0.8

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <TargetIcon />
        Price for a margin
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-2 p-3">
        <p className="text-xs text-muted-foreground">
          Each size priced to leave this share of its price after Gelato and Etsy, rounded up to the next .
          {String(ending).padStart(2, "0")}.
        </p>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!valid) return
            onApply(margin)
            setOpen(false)
          }}
        >
          <div className="relative flex-1">
            <Input
              value={text}
              onChange={(event) => setText(event.target.value)}
              inputMode="decimal"
              aria-label="Margin in percent"
              className="h-7 pr-6"
            />
            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
          </div>
          <Button type="submit" size="sm" disabled={!valid}>
            Apply
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

const SUGGESTION = "market"

function CopyFrom({ state, profile, onCopy }: { state: PricesState; profile: Profile; onCopy: (prices: Prices) => void }) {
  const items = [
    ...state.profiles.filter((p) => p.id !== profile.id).map((p) => ({ value: p.id, label: p.name })),
    ...(state.suggestion ? [{ value: SUGGESTION, label: "Market medians" }] : []),
  ]
  if (!items.length) return null
  return (
    <Select
      value={null as string | null}
      onValueChange={(value) => {
        if (value === SUGGESTION && state.suggestion) onCopy(state.suggestion.prices)
        else {
          const source = state.profiles.find((p) => p.id === value)
          if (source) onCopy(source.prices)
        }
      }}
      items={items}
    >
      <SelectTrigger size="sm" aria-label="Copy prices from">
        <SelectValue placeholder="Copy from…" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
