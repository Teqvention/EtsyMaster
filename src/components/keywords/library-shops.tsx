"use client"

import Image from "next/image"
import Link from "next/link"
import * as React from "react"
import { ArrowUpRightIcon, LoaderCircleIcon, PlusIcon, StoreIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button, buttonVariants } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { removeFromLibrary } from "@/hooks/use-keyword-library"
import { formatNumber, formatRate } from "@/lib/etsy/format"
import type { LibraryShopSummary } from "@/lib/keywords/types"
import { timeAgo } from "@/lib/shops/time-ago"
import { cn } from "@/lib/utils"

// The shops the library is made from. Updating one happens on its shop page
// (it needs a fresh analysis), so each row links there.

export function LibraryShops({ shops }: { shops: LibraryShopSummary[] }) {
  return (
    <section aria-labelledby="library-shops" className="flex min-w-0 flex-col gap-1 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2 pb-1">
        <h2 id="library-shops" className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          In the library
        </h2>
        <Link
          href="/shops"
          className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "-mr-1 text-muted-foreground active:scale-[0.97]")}
        >
          <PlusIcon />
          Add shop
        </Link>
      </div>
      <ul className="-mx-1 flex flex-col">
        {shops.map((shop) => (
          <ShopRow key={shop.id} shop={shop} />
        ))}
      </ul>
    </section>
  )
}

function ShopRow({ shop }: { shop: LibraryShopSummary }) {
  const [removing, setRemoving] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)

  async function remove() {
    setRemoving(true)
    setConfirming(false)
    try {
      await removeFromLibrary(shop.id)
      toast.success(`Took ${shop.name} out of the keyword library`)
    } catch (error) {
      toast.error(`Couldn't remove ${shop.name}: ${(error as Error).message}`)
      setRemoving(false)
    }
  }

  return (
    <li className="group/shop relative flex items-center gap-2.5 rounded-md px-1 py-1.5 has-[a:focus-visible]:bg-muted/60 [@media(hover:hover)]:hover:bg-muted/60">
      <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">
        {shop.iconUrl ? (
          <Image src={shop.iconUrl} alt="" fill unoptimized sizes="32px" className="object-cover" />
        ) : (
          <StoreIcon className="size-3.5 text-muted-foreground" />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          href={`/shops?shop=${encodeURIComponent(shop.name)}`}
          className="flex items-center gap-1 truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-md"
          title={`Open the shop — update its keywords from there${shop.totalSales ? ` · ${formatNumber(shop.totalSales)} sales, lifetime` : ""}`}
        >
          <span className="truncate">{shop.name}</span>
          <ArrowUpRightIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 ease-out group-has-[a:focus-visible]/shop:opacity-100 [@media(hover:hover)]:group-hover/shop:opacity-100" />
        </Link>
        <span className="truncate text-[11px] text-muted-foreground tabular-nums">
          {formatNumber(shop.listings)} listings · {formatNumber(shop.topSellers)} top ·{" "}
          {formatRate(shop.salesPerMonth, true)}/mo
        </span>
      </div>
      <time
        dateTime={shop.updatedAt}
        title={`Added ${new Date(shop.addedAt).toLocaleDateString()}, updated ${new Date(shop.updatedAt).toLocaleString()}`}
        className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
      >
        {timeAgo(shop.updatedAt)}
      </time>
      <Popover open={confirming} onOpenChange={setConfirming}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="relative z-10 shrink-0 text-muted-foreground active:scale-[0.97] data-popup-open:bg-muted [@media(hover:hover)]:hover:text-destructive"
              aria-label={`Remove ${shop.name} from the library`}
              disabled={removing}
            />
          }
        >
          {removing ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <Trash2Icon />}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 gap-3 p-3">
          <p className="text-sm text-pretty">
            Take <span className="font-medium">{shop.name}</span> out? Its {formatNumber(shop.listings)} listings
            leave the keyword statistics.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep
            </Button>
            <Button variant="destructive" size="sm" className="active:scale-[0.97]" onClick={remove} autoFocus>
              Remove
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </li>
  )
}
