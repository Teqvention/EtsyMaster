"use client"

import * as React from "react"
import { ListPlusIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { analyseShops } from "@/hooks/use-shop-analysis"
import { notifyEtsyRequest } from "@/hooks/use-etsy-usage"
import { recordShopVisit } from "@/hooks/use-shop-history"
import { formatNumber } from "@/lib/etsy/format"
import type { ListingShop } from "@/lib/etsy/types"

// Next to the shop search: paste many shops, one per line (names, ids or
// links), and they're looked up and put into the recent shops list, ready to
// have their listings fetched in one go.

/** One shop per line; blank lines and repeats dropped. */
function parseShops(text: string) {
  const seen = new Set<string>()
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const key = line.toLowerCase()
      if (!line || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

async function lookUp(query: string): Promise<ListingShop> {
  const res = await fetch(`/api/shops?q=${encodeURIComponent(query)}`)
  notifyEtsyRequest()
  const data = await res.json()
  if (res.status === 404) throw new Error("not found")
  if (!res.ok) throw new Error(data.error ?? res.statusText)
  return data as ListingShop
}

export function ImportShops() {
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState("")
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)
  const queries = parseShops(text)

  async function importShops() {
    setProgress({ done: 0, total: queries.length })
    const found: ListingShop[] = []
    const missing: string[] = []
    for (const query of queries) {
      try {
        const shop = await lookUp(query)
        if (!found.some((s) => s.id === shop.id)) found.push(shop)
        recordShopVisit(shop)
      } catch {
        missing.push(query)
      }
      setProgress((p) => p && { ...p, done: p.done + 1 })
    }
    setProgress(null)
    // Lines that weren't found stay, to fix and import again.
    setText(missing.join("\n"))
    if (missing.length === 0) setOpen(false)

    if (found.length > 0) {
      toast.success(`Imported ${formatNumber(found.length)} ${found.length === 1 ? "shop" : "shops"}`, {
        description: missing.length ? `Not found: ${missing.join(", ")}` : undefined,
        duration: 10_000,
        action: { label: "Get all listings", onClick: () => getAllListings(found) },
      })
    } else {
      toast.error("None of the shops were found")
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto text-muted-foreground"
        onClick={() => setOpen(true)}
        title="Import many shops at once"
      >
        <ListPlusIcon />
        Import
      </Button>
      <Dialog open={open} onOpenChange={(next) => !progress && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import shops</DialogTitle>
            <DialogDescription>
              One shop per line: its name, numeric id or etsy.com/shop/… link.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={"ShopOne\nShopTwo\nhttps://www.etsy.com/shop/ShopThree"}
            className="max-h-[50svh] min-h-40 font-mono text-xs"
            disabled={!!progress}
            autoFocus
            aria-label="Shops, one per line"
          />
          <DialogFooter>
            <Button
              className="active:scale-[0.97]"
              disabled={queries.length === 0 || !!progress}
              onClick={importShops}
            >
              {progress ? (
                <>
                  <LoaderCircleIcon className="animate-spin" />
                  Looking up {formatNumber(progress.done)} of {formatNumber(progress.total)}
                </>
              ) : (
                `Import ${queries.length ? formatNumber(queries.length) : ""} ${queries.length === 1 ? "shop" : "shops"}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Fetches every listing of the shops, then says how it went. */
export function getAllListings(shops: ListingShop[]) {
  toast(`Getting all listings of ${formatNumber(shops.length)} ${shops.length === 1 ? "shop" : "shops"}`, {
    description: "Two at a time, over both analysis accounts.",
  })
  analyseShops(shops).then((batch) => {
    // Added to a batch already under way: that one reports.
    if (!batch) return
    const ok = batch.done - batch.failed.length
    if (batch.failed.length) {
      toast.error(`Got all listings of ${formatNumber(ok)} of ${formatNumber(batch.total)} shops`, {
        description: `Failed: ${batch.failed.join(", ")}`,
        duration: 10_000,
      })
    } else {
      toast.success(
        batch.done < batch.total
          ? `Stopped after ${formatNumber(batch.done)} of ${formatNumber(batch.total)} shops`
          : `Got all listings of ${formatNumber(batch.total)} ${batch.total === 1 ? "shop" : "shops"}`,
        { duration: 10_000 }
      )
    }
  })
}
