"use client"

import * as React from "react"

import { reloadArtikel } from "@/hooks/use-artikel"
import type { ProposalEdit, SeoRun } from "@/lib/citys/seo"

// The SEO analyses of our city listings: read while the sheet is open,
// followed every couple of seconds while one is analysing or applying; the
// Artikel table reads again once proposals land on Etsy.

const POLL = 2000

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result as T
}

const busy = (run: SeoRun) => run.status === "running" || run.proposals.some((p) => p.status === "queued")
const applied = (runs: SeoRun[]) => runs.reduce((n, r) => n + r.proposals.filter((p) => p.status === "applied").length, 0)

export function useSeoRuns(open: boolean) {
  const [runs, setRuns] = React.useState<SeoRun[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const seen = React.useRef(-1)

  const take = React.useCallback((next: SeoRun[]) => {
    const count = applied(next)
    if (seen.current !== -1 && count > seen.current) reloadArtikel()
    seen.current = count
    setRuns(next)
  }, [])

  const refresh = React.useCallback(async () => {
    try {
      take(await json<SeoRun[]>("/api/citys/seo"))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [take])

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    json<SeoRun[]>("/api/citys/seo").then(
      (next) => !cancelled && take(next),
      (e: Error) => !cancelled && setError(e.message)
    )
    return () => {
      cancelled = true
    }
  }, [open, take])

  const working = !!runs?.some(busy)
  React.useEffect(() => {
    if (!open || !working) return
    const timer = setInterval(() => void refresh(), POLL)
    return () => clearInterval(timer)
  }, [open, working, refresh])

  const replace = React.useCallback((run: SeoRun) => setRuns((list) => (list ? list.map((r) => (r.id === run.id ? run : r)) : [run])), [])

  return {
    runs,
    error,
    refresh,
    async start(listingIds: number[]) {
      const run = await json<SeoRun>("/api/citys/seo", { method: "POST", body: JSON.stringify({ listingIds }) })
      setRuns((list) => [run, ...(list ?? []).filter((r) => r.id !== run.id)])
      return run
    },
    async edit(id: string, edit: ProposalEdit) {
      replace(await json<SeoRun>(`/api/citys/seo/${id}`, { method: "PATCH", body: JSON.stringify(edit) }))
    },
    async apply(id: string, listingIds: number[]) {
      replace(await json<SeoRun>(`/api/citys/seo/${id}/apply`, { method: "POST", body: JSON.stringify({ listingIds }) }))
    },
    async remove(id: string) {
      take(await json<SeoRun[]>(`/api/citys/seo/${id}`, { method: "DELETE" }))
    },
  }
}
