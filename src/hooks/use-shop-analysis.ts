"use client"

import * as React from "react"

import { notifyEtsyRequest } from "@/hooks/use-etsy-usage"
import { reviewsSince, type AnalysisPlan } from "@/lib/etsy/analysis"
import type { Listing, ListingPage, ShopReview, ShopReviewPage } from "@/lib/etsy/types"

// Fetches a shop's listings (then its reviews) page by page, so the analysis
// fills in as data lands and the run can be stopped part way. Each page goes
// through the server's cache, so re-running a plan costs no quota; finished
// runs are also kept for the session, so coming back to one is instant.

const PAGE = 100

export type AnalysisStatus = "idle" | "running" | "done" | "stopped" | "error"

export type AnalysisRun = {
  shopId: number
  plan: AnalysisPlan
  status: AnalysisStatus
  listings: Listing[]
  /** Active listings Etsy reports; the run stops at the plan's limit or this. */
  listingTotal: number | null
  reviews: ShopReview[]
  /** Reviews in the window, once the first page says. */
  reviewTotal: number | null
  error: string | null
}

const finished = new Map<string, AnalysisRun>()

function runKey(shopId: number, plan: AnalysisPlan) {
  return `${shopId}:${plan.limit}:${plan.sort}:${plan.reviews}`
}

/** A finished run from earlier in the session, if there is one. */
export function cachedRun(shopId: number, plan: AnalysisPlan) {
  return finished.get(runKey(shopId, plan)) ?? null
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  notifyEtsyRequest()
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? res.statusText)
  return data
}

export function useShopAnalysis() {
  const [run, setRun] = React.useState<AnalysisRun | null>(null)
  const controller = React.useRef<AbortController | null>(null)
  // Bumped by every start/reset, so a superseded run can't write over a newer one.
  const generation = React.useRef(0)

  const stop = React.useCallback(() => {
    controller.current?.abort()
    controller.current = null
  }, [])

  // Leaving the page cancels whatever is in flight.
  React.useEffect(() => stop, [stop])

  const start = React.useCallback(
    async (shopId: number, plan: AnalysisPlan) => {
      stop()
      const id = ++generation.current
      const cached = cachedRun(shopId, plan)
      if (cached) {
        setRun(cached)
        return
      }

      const abort = new AbortController()
      controller.current = abort
      let current: AnalysisRun = {
        shopId,
        plan,
        status: "running",
        listings: [],
        listingTotal: null,
        reviews: [],
        reviewTotal: null,
        error: null,
      }
      const update = (patch: Partial<AnalysisRun>) => {
        current = { ...current, ...patch }
        if (generation.current === id) setRun(current)
      }
      update({})

      try {
        // Listings, in the plan's order, up to its limit.
        const seen = new Set<number>()
        for (let offset: number | null = 0; offset !== null; ) {
          const remaining = plan.limit - current.listings.length
          if (remaining <= 0) break
          const params = new URLSearchParams({
            offset: String(offset),
            limit: String(Math.min(PAGE, remaining)),
            sort: plan.sort,
          })
          const page: ListingPage = await getJson<ListingPage>(
            `/api/shops/${shopId}/listings?${params}`,
            abort.signal
          )
          // Offset paging over a live shop can repeat a listing across pages.
          const fresh = page.listings.filter((l) => !seen.has(l.id))
          fresh.forEach((l) => seen.add(l.id))
          update({
            listings: [...current.listings, ...fresh].slice(0, plan.limit),
            listingTotal: page.total,
          })
          offset = page.nextOffset
        }

        // Then every review in the window, newest first.
        if (plan.reviews !== "none") {
          const since = reviewsSince(plan.reviews)
          for (let offset: number | null = 0; offset !== null; ) {
            const params = new URLSearchParams({ offset: String(offset) })
            if (since) params.set("since", String(since))
            const page: ShopReviewPage = await getJson<ShopReviewPage>(
              `/api/shops/${shopId}/reviews?${params}`,
              abort.signal
            )
            update({ reviews: [...current.reviews, ...page.reviews], reviewTotal: page.total })
            offset = page.nextOffset
          }
        }

        update({ status: "done" })
        finished.set(runKey(shopId, plan), current)
      } catch (error) {
        if (abort.signal.aborted) {
          update({ status: "stopped" })
        } else {
          update({
            status: "error",
            error: error instanceof Error ? error.message : "Couldn't load the shop",
          })
        }
      } finally {
        if (controller.current === abort) controller.current = null
      }
    },
    [stop]
  )

  const reset = React.useCallback(() => {
    generation.current++
    stop()
    setRun(null)
  }, [stop])

  return { run, start, stop, reset }
}
