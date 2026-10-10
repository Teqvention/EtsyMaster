"use client"

import * as React from "react"

import type { PerformanceQuery, PerformanceReport } from "@/lib/performance/types"

// The Performance report per shop and range, kept per query so stepping back
// and forth shows what was there at once; a report half a minute old is asked
// for again in the background. While a sync runs, the shown report is asked
// for every few seconds, and the others are forgotten once it's done.

const FRESH = 30_000
const POLL = 4000

type Entry = { report: PerformanceReport; at: number }

const cache = new Map<string, Entry>()
const loading = new Set<string>()
const listeners = new Set<() => void>()
let version = 0
/** The last report that arrived, shown (dimmed) while another loads. */
let latest: PerformanceReport | null = null
let failure: string | null = null
let current: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function notify() {
  version++
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const queryKey = (query: PerformanceQuery) => {
  const params = new URLSearchParams({ account: query.account, range: query.range, offset: String(query.offset) })
  if (query.by) params.set("by", query.by)
  return params.toString()
}

async function load(key: string) {
  if (loading.has(key)) return
  loading.add(key)
  notify()
  try {
    const response = await fetch(`/api/performance?${key}`, { cache: "no-store" })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? response.statusText)
    const report = result as PerformanceReport
    const wasRunning = cache.get(key)?.report.sync.some((s) => s.running)
    const running = report.sync.some((s) => s.running)
    if (wasRunning && !running) cache.clear()
    cache.set(key, { report, at: Date.now() })
    latest = report
    failure = null
    if (timer) clearTimeout(timer)
    timer = running && listeners.size ? setTimeout(() => current && load(current), POLL) : null
  } catch (error) {
    failure = (error as Error).message
  } finally {
    loading.delete(key)
    notify()
  }
}

export function usePerformance(query: PerformanceQuery) {
  const key = queryKey(query)
  React.useSyncExternalStore(subscribe, () => version, () => 0)

  React.useEffect(() => {
    current = key
    const entry = cache.get(key)
    if (!entry || Date.now() - entry.at > FRESH) load(key)
  }, [key])

  const entry = cache.get(key)
  return {
    report: entry?.report ?? latest,
    /** The report shown isn't this query's yet (one kept is refreshed quietly). */
    loading: !entry,
    error: entry ? null : failure,
  }
}

/** Starts a sync of one account (or all) and asks for the report until it's done. */
export async function syncNow(account?: string) {
  const response = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(account ? { account } : {}),
  })
  if (response.status === 404) throw new Error("Syncing isn't set up yet")
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  for (const key of cache.keys()) if (key !== current) cache.delete(key)
  if (current) await load(current)
}
