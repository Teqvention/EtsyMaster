"use client"

import { useEffect } from "react"

import { isAnalysing } from "@/hooks/use-shop-analysis"

const POLL_MS = 10_000

// Reloads the tab once the server runs a newer build — scripts/autoupdate.sh
// pulls, rebuilds and restarts it whenever new commits land on GitHub.
export function UpdateReloader() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return
    const timer = setInterval(async () => {
      try {
        const response = await fetch("/api/version", { cache: "no-store" })
        if (!response.ok) return
        const { version } = await response.json()
        // A shop analysis running in the background would be lost; wait it out.
        if (version !== process.env.APP_VERSION && !isAnalysing()) location.reload()
      } catch {
        // Server is down while it rebuilds; try again next tick.
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [])
  return null
}
