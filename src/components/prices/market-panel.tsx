"use client"

import Link from "next/link"
import * as React from "react"
import { LoaderCircleIcon, PlusIcon, RefreshCwIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { runMarket, updatePricesSettings } from "@/hooks/use-prices"
import { SIZE_KEYS } from "@/lib/catalog/sizes"
import { formatCompact, formatDate } from "@/lib/etsy/format"
import type { MarketShop, PricesState } from "@/lib/pricing/types"

import { Em, eur, Panel, shortSize } from "./shared"

// What strong shops charge: each one's best sellers, the price Etsy shows on
// them (their cheapest size) and, with a connected Etsy account, every size.
// Which shops is decided right here: add one by name or link, take one out,
// look again.

export function MarketPanel({
  state,
  ours,
  onUseSuggestion,
}: {
  state: PricesState
  /** The profile on screen: its name and cheapest price. */
  ours: { name: string; fromCents: number }
  onUseSuggestion: () => void
}) {
  const { market, marketShops, suggestion } = state
  const [adding, setAdding] = React.useState("")

  async function run() {
    try {
      await runMarket()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  async function setShops(names: string[]) {
    try {
      await updatePricesSettings({ marketShops: names })
      return true
    } catch (error) {
      toast.error((error as Error).message)
      return false
    }
  }

  const rows = marketShops.map((name) => ({
    name,
    result: market.shops.find((s) => s.name.toLowerCase() === name.toLowerCase()),
  }))
  const looked = rows.flatMap((r) => (r.result?.fromPrice ? [r.result] : []))

  return (
    <Panel
      title="Market"
      aside={
        <div className="flex items-center gap-2">
          {market.at && (
            <span className="text-[11px] text-muted-foreground">
              {formatDate(market.at, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: undefined })}
            </span>
          )}
          <Button variant="outline" size="xs" onClick={run} disabled={market.running || !marketShops.length}>
            {market.running ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
            {market.running ? "Looking…" : market.at ? "Look again" : "Look"}
          </Button>
        </div>
      }
      finding={
        looked.length ? (
          <>
            {looked.map((shop, i) => (
              <React.Fragment key={shop.shopId}>
                {i > 0 && (i === looked.length - 1 ? " and " : ", ")}
                {shop.name}&apos;s best sellers start at <Em>{eur(shop.fromPrice!.median)}</Em>
              </React.Fragment>
            ))}
            ; {ours.name} starts at <Em>{eur(ours.fromCents)}</Em>.
          </>
        ) : market.at ? (
          "None of the shops could be looked at."
        ) : (
          "Look at what strong poster shops charge for their best sellers."
        )
      }
    >
      <ul className="flex flex-col divide-y text-[13px]">
        {rows.map(({ name, result }) => (
          <li key={name} className="flex items-start gap-3 py-2 first:pt-0">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <a
                href={result?.url ?? `https://www.etsy.com/shop/${name}`}
                target="_blank"
                rel="noreferrer"
                className="truncate font-medium underline-offset-4 hover:underline"
              >
                {result?.name ?? name}
              </a>
              <ShopLine result={result} />
            </div>
            {result?.fromPrice && (
              <div className="flex flex-col items-end gap-0.5 tabular-nums" title="The price Etsy shows on each listing: usually its cheapest size">
                <span className="font-medium">from {eur(result.fromPrice.median)}</span>
                <span className="text-xs text-muted-foreground">
                  {eur(result.fromPrice.p25)}–{eur(result.fromPrice.p75)}
                </span>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Stop looking at ${name}`}
              onClick={() => setShops(marketShops.filter((n) => n !== name))}
              className="text-muted-foreground"
            >
              <XIcon />
            </Button>
          </li>
        ))}
      </ul>

      <form
        className="flex gap-1.5"
        onSubmit={async (event) => {
          event.preventDefault()
          const name = adding.trim()
          if (name && (await setShops([...marketShops, name]))) setAdding("")
        }}
      >
        <Input
          value={adding}
          onChange={(event) => setAdding(event.target.value)}
          placeholder="Another shop: name or link"
          aria-label="Shop to add"
          className="h-7 text-[13px]"
          disabled={marketShops.length >= 6}
        />
        <Button type="submit" variant="outline" size="sm" disabled={!adding.trim()}>
          <PlusIcon />
          Add
        </Button>
      </form>

      {market.inventoryNote && (
        <p className="text-xs text-muted-foreground">
          {market.inventoryNote}{" "}
          <Link href="/settings" className="font-medium text-foreground underline-offset-4 hover:underline">
            Connect one in Settings
          </Link>
          .
        </p>
      )}

      {suggestion && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-xs">
          <span className="text-muted-foreground">
            Market medians: {SIZE_KEYS.filter((k) => !suggestion.estimated.includes(k)).length} sizes priced
            {suggestion.estimated.length > 0 && `, ${suggestion.estimated.map(shortSize).join(", ")} estimated`}
          </span>
          <Button variant="outline" size="xs" onClick={onUseSuggestion} className="ml-auto">
            New profile from them
          </Button>
        </div>
      )}
    </Panel>
  )
}

function ShopLine({ result }: { result?: MarketShop }) {
  if (!result) return <span className="text-xs text-muted-foreground">Not looked at yet</span>
  if (result.error) return <span className="text-xs text-destructive">{result.error}</span>
  const sizes = Object.keys(result.sizes).length
  return (
    <span className="text-xs text-muted-foreground">
      {formatCompact(result.totalSales)} sales · {result.physical}{" "}
      {result.source === "library" ? "best sellers (keyword library)" : "most favourited listings"}
      {sizes > 0 && ` · ${sizes} of our sizes`}
      {result.otherSizes.length > 0 && ` · also ${result.otherSizes.slice(0, 3).map((s) => s.label).join(", ")}`}
    </span>
  )
}
