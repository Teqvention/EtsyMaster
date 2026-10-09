"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { CheckIcon, LibraryBigIcon, LoaderCircleIcon, RotateCwIcon } from "lucide-react"
import { toast } from "sonner"

import { Button, buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { addToLibrary, useLibraryMembership } from "@/hooks/use-keyword-library"
import { formatDate, formatNumber } from "@/lib/etsy/format"
import type { Listing, ListingShop } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// In an open shop's header: puts the analysed listings' titles and tags into
// the keyword library, or refreshes what the library has of the shop.
export function LibraryButton({
  shop,
  listings,
  analysedAt,
  running,
}: {
  shop: ListingShop
  /** The analysed listings once the run has settled; null while there are none to add. */
  listings: Listing[] | null
  /** When those listings were fetched. */
  analysedAt: string | null
  running: boolean
}) {
  const router = useRouter()
  const membership = useLibraryMembership(shop.id)
  const [pending, setPending] = React.useState(false)
  const ready = !!listings?.length && !running
  // The analysis on screen is newer, or covers more, than the library's copy.
  const behind =
    !!membership &&
    ready &&
    ((analysedAt !== null && Date.parse(analysedAt) > Date.parse(membership.updatedAt)) ||
      listings!.length !== membership.listings)

  async function add() {
    if (!listings?.length) return
    setPending(true)
    const updating = !!membership
    try {
      await addToLibrary(shop, listings)
      toast.success(
        updating ? `Updated ${shop.name} in the keyword library` : `Added ${shop.name} to the keyword library`,
        {
          description: `Titles and tags of ${formatNumber(listings.length)} ${listings.length === 1 ? "listing" : "listings"}.`,
          action: { label: "Open", onClick: () => router.push("/keywords") },
        }
      )
    } catch (error) {
      toast.error(`Couldn't ${updating ? "update" : "add"} ${shop.name}: ${(error as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  if (membership === undefined) return <Skeleton className="h-7 w-32 rounded-md" />

  if (!membership) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="active:scale-[0.97]"
        disabled={!ready || pending}
        onClick={add}
        title={
          running
            ? "Once the analysis is done"
            : ready
              ? `Keep the titles and tags of these ${formatNumber(listings!.length)} listings for the Keywords page`
              : "Analyse the shop first"
        }
      >
        {pending ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <LibraryBigIcon />}
        Add to library
      </Button>
    )
  }

  return (
    <div className="flex items-center" role="group" aria-label="Keyword library">
      <Link
        href="/keywords"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "rounded-r-none text-emerald-700 active:scale-[0.97] dark:text-emerald-400"
        )}
        title={`${formatNumber(membership.listings)} listings, updated ${formatDate(membership.updatedAt)} · open the Keywords page`}
      >
        <CheckIcon />
        In library
      </Link>
      {/* Spelled out only when there's something newer to put in; otherwise a quiet icon. */}
      <Button
        variant="outline"
        size={behind ? "sm" : "icon-sm"}
        className="-ml-px rounded-l-none active:scale-[0.97]"
        disabled={!ready || pending}
        onClick={add}
        aria-label={`Update ${shop.name} in the keyword library`}
        title={
          !ready
            ? running
              ? "Once the analysis is done"
              : "Analyse the shop first"
            : behind
              ? `Replace the library's ${formatNumber(membership.listings)} listings with the ${formatNumber(listings!.length)} analysed here`
              : "The library has this analysis — update anyway"
        }
      >
        {pending ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <RotateCwIcon />}
        {behind && (
          <>
            Update
            <span aria-hidden className="size-1.5 rounded-full bg-brand" />
          </>
        )}
      </Button>
    </div>
  )
}
