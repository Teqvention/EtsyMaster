"use client"

import * as React from "react"

import { notifyEtsyRequest } from "@/hooks/use-etsy-usage"
import type { Listing, ListingPage } from "@/lib/etsy/types"

// Offset-paged listings from one of our API routes, loaded as a sentinel
// element nears the bottom of its scroll container. Changing `endpoint` starts
// over. Pass null to stay idle.

type State = {
  endpoint: string | null
  listings: Listing[]
  total: number | null
  nextOffset: number | null
  loading: boolean
  error: string | null
}

const initialState = (endpoint: string | null): State => ({
  endpoint,
  listings: [],
  total: null,
  nextOffset: endpoint ? 0 : null,
  loading: false,
  error: null,
})

// Start the next request roughly two screens before the user gets there.
const PRELOAD_MARGIN = "0px 0px 1600px 0px"

export function useInfiniteListings(endpoint: string | null) {
  const [state, setState] = React.useState(() => initialState(endpoint))
  if (state.endpoint !== endpoint) setState(initialState(endpoint))

  const stateRef = React.useRef(state)
  const sentinelVisible = React.useRef(false)

  const loadMore = React.useCallback(async () => {
    const current = stateRef.current
    const { endpoint, nextOffset } = current
    if (!endpoint || nextOffset === null || current.loading || current.error) return

    // Flag synchronously so a second observer callback can't double-fetch.
    stateRef.current = { ...current, loading: true }
    setState((prev) => (prev.endpoint === endpoint ? { ...prev, loading: true } : prev))

    try {
      const url = new URL(endpoint, window.location.origin)
      url.searchParams.set("offset", String(nextOffset))
      const res = await fetch(url)
      notifyEtsyRequest()
      const data = (await res.json()) as ListingPage & { error?: string }
      if (!res.ok) throw new Error(data.error ?? res.statusText)

      setState((prev) => {
        if (prev.endpoint !== endpoint) return prev
        // Offset paging over a live index can repeat items across pages.
        const seen = new Set(prev.listings.map((l) => l.id))
        return {
          ...prev,
          loading: false,
          total: data.total,
          nextOffset: data.nextOffset,
          listings: [...prev.listings, ...data.listings.filter((l) => !seen.has(l.id))],
        }
      })
    } catch (error) {
      setState((prev) =>
        prev.endpoint === endpoint
          ? {
              ...prev,
              loading: false,
              error: error instanceof Error ? error.message : "Couldn't load listings",
            }
          : prev
      )
    }
  }, [])

  React.useEffect(() => {
    stateRef.current = state
    // Keep going while the sentinel is still on screen after a page lands
    // (tall viewports, or a page that was mostly duplicates).
    if (!state.loading && sentinelVisible.current) loadMore()
  }, [state, loadMore])

  const sentinelRef = React.useCallback(
    (node: HTMLElement | null) => {
      if (!node) return
      const observer = new IntersectionObserver(
        ([entry]) => {
          sentinelVisible.current = entry.isIntersecting
          if (entry.isIntersecting) loadMore()
        },
        { root: scrollParent(node), rootMargin: PRELOAD_MARGIN }
      )
      observer.observe(node)
      return () => observer.disconnect()
    },
    [loadMore]
  )

  const retry = React.useCallback(() => {
    stateRef.current = { ...stateRef.current, error: null }
    setState((prev) => ({ ...prev, error: null }))
    loadMore()
  }, [loadMore])

  return {
    listings: state.listings,
    total: state.total,
    loading: state.loading,
    error: state.error,
    done: state.endpoint !== null && state.nextOffset === null,
    sentinelRef,
    retry,
  }
}

// The margin only extends the root's box, so observe against the nearest
// scrolling ancestor rather than the viewport.
function scrollParent(node: HTMLElement) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el)
    if (overflowY === "auto" || overflowY === "scroll") return el
  }
  return null
}
