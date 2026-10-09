"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"

import { buttonVariants } from "@/components/ui/button"
import {
  listingTarget,
  onBackgroundSettle,
  runProgress,
  useBackgroundAnalyses,
  type ShopRun,
} from "@/hooks/use-shop-analysis"
import { formatNumber } from "@/lib/etsy/format"
import type { ListingShop } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// In the header on every page: shop analyses still running after their page
// was left, each linking back to it, and a toast when one finishes meanwhile.

export function BackgroundAnalyses() {
  const runs = useBackgroundAnalyses()
  const router = useRouter()

  React.useEffect(
    () =>
      onBackgroundSettle(({ shop, run }) => {
        // Up longer than most toasts: you're busy with something else.
        const options = {
          duration: 10_000,
          action: { label: "Open", onClick: () => router.push(shopHref(shop)) },
        }
        const fetched = `${formatNumber(run.listings.length)} listings${
          run.plan.reviews !== "none" ? ` and ${formatNumber(run.reviews.length)} reviews` : ""
        }`
        if (run.status === "done") {
          toast.success(`Analysed ${shop.name}`, { ...options, description: `${fetched}.` })
        } else if (run.status === "error") {
          toast.error(`Couldn't finish analysing ${shop.name}`, {
            ...options,
            description: `${run.error} · ${fetched} kept.`,
          })
        }
      }),
    [router]
  )

  if (runs.length === 0) return null

  return (
    <div className="flex items-center gap-1.5">
      {runs.map(({ shop, run }) => (
        <RunLink key={shop.id} shop={shop} run={run} />
      ))}
    </div>
  )
}

function RunLink({ shop, run }: ShopRun) {
  const progress = runProgress(run, shop)
  const target = listingTarget(run)
  const detail =
    run.listings.length >= target && run.plan.reviews !== "none"
      ? `reviews ${formatNumber(run.reviews.length)}${
          run.reviewTotal !== null ? ` of ${formatNumber(run.reviewTotal)}` : ""
        }`
      : `listings ${formatNumber(run.listings.length)} of ${formatNumber(target)}`

  return (
    <Link
      href={shopHref(shop)}
      title={`Analysing ${shop.name}: ${detail} · open it`}
      aria-label={`Analysing ${shop.name}, ${Math.floor(progress * 100)}%: open it`}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-w-56 active:scale-[0.97]")}
    >
      <ProgressRing value={progress} />
      <span className="hidden truncate sm:inline">{shop.name}</span>
      <span className="text-muted-foreground tabular-nums">{Math.floor(progress * 100)}%</span>
    </Link>
  )
}

// Fills clockwise as pages land; starts with a sliver so it reads as under way.
function ProgressRing({ value }: { value: number }) {
  const circumference = 2 * Math.PI * 6
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0 -rotate-90">
      <circle cx="8" cy="8" r="6" fill="none" strokeWidth="2.5" className="stroke-brand/20" />
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.max(value, 0.05))}
        className="stroke-brand transition-[stroke-dashoffset] duration-300 ease-out-strong"
      />
    </svg>
  )
}

function shopHref(shop: ListingShop) {
  return `/shops?${new URLSearchParams({ shop: shop.name })}`
}
