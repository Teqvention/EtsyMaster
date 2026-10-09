"use client"

import * as React from "react"

import type { EtsyUsage } from "@/lib/etsy/usage"

// Reads the server's latest Etsy quota reading. It refreshes whenever the app
// finishes an Etsy-backed request (see `notifyEtsyRequest`), on focus, and on a
// slow poll for quota that trickles back as the 24-hour window rolls.

const EVENT = "etsy:request"
const POLL_MS = 60_000

/** Call after an `/api/*` request that may have spent Etsy quota. */
export function notifyEtsyRequest() {
  window.dispatchEvent(new Event(EVENT))
}

export function useEtsyUsage() {
  const [usage, setUsage] = React.useState<EtsyUsage | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)

  // Asks Etsy for a fresh reading now, whatever its age (costs one request).
  const refresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch("/api/usage?refresh")
      if (res.ok) setUsage((await res.json()) as EtsyUsage)
    } catch {
      // Keep the last reading.
    } finally {
      setRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function load() {
      try {
        const res = await fetch("/api/usage")
        if (res.ok && !cancelled) setUsage((await res.json()) as EtsyUsage)
      } catch {
        // Keep the last reading; the next trigger retries.
      }
    }

    // Coalesce bursts (a page of results plus the open listing and its shop).
    function schedule() {
      clearTimeout(timer)
      timer = setTimeout(load, 300)
    }

    function onVisible() {
      if (document.visibilityState === "visible") schedule()
    }

    load()
    const poll = setInterval(onVisible, POLL_MS)
    window.addEventListener(EVENT, schedule)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      clearTimeout(timer)
      clearInterval(poll)
      window.removeEventListener(EVENT, schedule)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  return { usage, refresh, refreshing }
}
