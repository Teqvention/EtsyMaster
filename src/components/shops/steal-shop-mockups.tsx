"use client"

import Link from "next/link"
import * as React from "react"
import { ChevronDownIcon, ImagesIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { fromListing, MockupDialog } from "@/components/saved/mockup-dialog"
import { gallerySort } from "@/components/shops/listing-gallery"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { isActive, useGenerations } from "@/hooks/use-generations"
import { formatNumber } from "@/lib/etsy/format"
import type { Listing, ListingShop } from "@/lib/etsy/types"
import type { SceneSummary } from "@/lib/mockups/types"
import { cn } from "@/lib/utils"

// In an open shop's header: the analysed listings' photos into mockups, best
// sellers first (the dialog looks at every photo and offers each room once),
// and the way to the mockups stolen from the shop before.

/** Best sellers to take short of the whole shop: a big one is tens of thousands of photos. */
const SCOPES = [50, 200]

export function StealShopMockups({
  shop,
  listings,
  running,
}: {
  shop: ListingShop
  /** The analysed listings once the run has settled; null while there are none. */
  listings: Listing[] | null
  running: boolean
}) {
  const [taking, setTaking] = React.useState<Listing[] | null>(null)
  const [open, setOpen] = React.useState(false)
  const stolen = useStolen(shop.name)
  const ready = !!listings?.length && !running
  const best = React.useMemo(() => (listings ? gallerySort(listings, "sales") : []), [listings])
  const scopes = SCOPES.filter((n) => n < best.length)
  const chosen = React.useMemo(() => taking?.map(fromListing) ?? [], [taking])

  function take(count: number) {
    setTaking(best.slice(0, count))
    setOpen(true)
  }

  const photos = (count: number) => best.slice(0, count).reduce((sum, l) => sum + l.images.length, 0)
  const title = running ? "Once the analysis is done" : ready ? undefined : "Analyse the shop first"

  return (
    <>
      {stolen.count > 0 || stolen.making > 0 ? (
        <Link
          href={`/mockups?shop=${encodeURIComponent(shop.name)}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "tabular-nums")}
          title={`The mockups stolen from ${shop.name}`}
        >
          {stolen.making > 0 && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
          {formatNumber(stolen.count)} stolen {stolen.count === 1 ? "mockup" : "mockups"}
          {stolen.making > 0 && <span className="text-muted-foreground">· {formatNumber(stolen.making)} coming</span>}
        </Link>
      ) : null}

      {scopes.length === 0 ? (
        <Button
          variant="outline"
          size="sm"
          className="active:scale-[0.97]"
          disabled={!ready}
          title={title ?? `Every photo of the ${formatNumber(best.length)} listings, each room once`}
          onClick={() => take(best.length)}
        >
          <ImagesIcon />
          Steal mockups
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="active:scale-[0.97]" disabled={!ready} title={title} />
            }
          >
            <ImagesIcon />
            Steal mockups
            <ChevronDownIcon className="text-muted-foreground" data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Photos of</DropdownMenuLabel>
              {[...scopes, best.length].map((count) => (
                <DropdownMenuItem key={count} onClick={() => take(count)}>
                  <span className="flex-1">
                    {count === best.length
                      ? `All ${formatNumber(count)} listings`
                      : `The ${formatNumber(count)} best sellers`}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatNumber(photos(count))} photos
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <MockupDialog
        open={open}
        onOpenChange={setOpen}
        listings={chosen}
        title={`Steal mockups · ${shop.name}`}
        description={
          taking && taking.length < best.length
            ? `Photos of its ${formatNumber(taking.length)} best-selling listings.`
            : `Photos of its ${formatNumber(best.length)} analysed listings.`
        }
      />
    </>
  )
}

/** Mockups stolen from `shop` so far, and how many are on their way. */
function useStolen(shop: string) {
  const sets = useGenerations()
  const name = shop.toLowerCase()
  const mine = (sets ?? []).filter((s) => s.kind === "mockup" && s.source.shop?.toLowerCase() === name)
  const making = mine.filter(isActive).length
  // Read again whenever one of them becomes a scene, or one is deleted.
  const made = mine.filter((s) => s.sceneId).length
  const [count, setCount] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    fetch("/api/mockups", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body?.error ?? response.statusText)
        if (!cancelled) setCount((body as SceneSummary[]).filter((s) => s.shop?.toLowerCase() === name).length)
      })
      .catch((error) => {
        if (!cancelled) toast.error(`Couldn't count the mockups from ${shop}: ${error.message}`)
      })
    return () => {
      cancelled = true
    }
  }, [name, shop, made])

  return { count, making }
}
