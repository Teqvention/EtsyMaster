"use client"

import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { refreshCosts, updatePricesSettings } from "@/hooks/use-prices"
import { formatDate } from "@/lib/etsy/format"
import { DESTINATION_LABEL, DESTINATIONS, type PricesState, type ProfitAssumptions } from "@/lib/pricing/types"

// The few numbers every profit on the page depends on, in one row: where the
// sale ships to (Gelato's prices differ), whether VAT on costs comes back,
// whether the price holds VAT. Gelato's costs and when they were asked sit at the end.

const COST_VAT = [
  { value: "0.19", label: "Costs + 19 % VAT" },
  { value: "0", label: "Costs net (VAT reclaimed)" },
]

const SALES_VAT = [
  { value: "0", label: "No VAT in price" },
  { value: "0.19", label: "Price holds 19 % VAT" },
]

const DESTINATION_ITEMS = DESTINATIONS.map((d) => ({ value: d, label: `Ships to ${DESTINATION_LABEL[d]}` }))

export function Assumptions({ state }: { state: PricesState }) {
  const { assumptions, costs } = state

  async function change(patch: Partial<ProfitAssumptions>) {
    try {
      await updatePricesSettings({ assumptions: patch })
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  async function ask() {
    try {
      await refreshCosts()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Choice
        label="Destination"
        value={assumptions.destination}
        items={DESTINATION_ITEMS}
        onChange={(destination) => change({ destination: destination as ProfitAssumptions["destination"] })}
      />
      <Choice
        label="VAT on costs"
        value={String(assumptions.costVat)}
        items={withCurrent(COST_VAT, assumptions.costVat, "Costs")}
        onChange={(value) => change({ costVat: Number(value) })}
      />
      <Choice
        label="VAT in price"
        value={String(assumptions.salesVat)}
        items={withCurrent(SALES_VAT, assumptions.salesVat, "Price holds")}
        onChange={(value) => change({ salesVat: Number(value) })}
      />

      <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        {costs.refreshing ? (
          <span className="flex items-center gap-1.5">
            <LoaderCircleIcon className="size-3 animate-spin" /> Asking Gelato…
          </span>
        ) : costs.error ? (
          <span className="text-destructive" title={costs.error}>
            Gelato: {costs.error}
          </span>
        ) : (
          <span title={costs.source === "live" ? "Gelato's price quote, cheapest shipping method" : undefined}>
            {costs.source === "live"
              ? `Gelato costs from ${formatDate(costs.at, { month: "short", day: "numeric" })}`
              : "Print costs as Gelato showed them in October; shipping not asked yet"}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Ask Gelato again"
          title="Ask Gelato again"
          onClick={ask}
          disabled={costs.refreshing}
        >
          <RefreshCwIcon />
        </Button>
      </span>
    </div>
  )
}

/** The usual choices, plus whatever odd rate settings.json holds. */
function withCurrent(items: { value: string; label: string }[], current: number, prefix: string) {
  return items.some((i) => Number(i.value) === current)
    ? items
    : [...items, { value: String(current), label: `${prefix} ${Math.round(current * 1000) / 10} % VAT` }]
}

function Choice({
  label,
  value,
  items,
  onChange,
}: {
  label: string
  value: string
  items: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={(next) => next !== null && next !== value && onChange(next)} items={items}>
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue />
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
