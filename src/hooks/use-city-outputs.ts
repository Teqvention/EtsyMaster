"use client"

import * as React from "react"

import type { CityOutput } from "@/lib/citys/outputs"
import type { CityRequest } from "@/lib/citys/studio-types"

// City posters for the Outputs page, read again every few seconds while
// some are still being painted. Reviews show at once and go to the server
// behind them.

const POLL = 5000

const listeners = new Set<() => void>()
let outputs: CityOutput[] | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let loading: Promise<void> | null = null

function set(next: CityOutput[]) {
  outputs = next
  listeners.forEach((l) => l())
  schedule()
}

const busy = (list: CityOutput[] | null) => !!list?.some((o) => o.status === "pending" || o.status === "running")

function schedule() {
  if (timer) clearTimeout(timer)
  if (busy(outputs) && listeners.size) timer = setTimeout(() => void refreshOutputs(), POLL)
}

export function refreshOutputs() {
  loading ??= fetch("/api/citys/outputs", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
    .then((list: CityOutput[]) => set(list))
    .catch(() => {
      if (!outputs) set([])
    })
    .finally(() => {
      loading = null
    })
  return loading
}

export function useCityOutputs() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      if (!outputs) void refreshOutputs()
      else schedule()
      return () => listeners.delete(l)
    },
    () => outputs,
    () => null
  )
}

export async function reviewCityOutputs(items: { setId: string; outputId: string }[], review: CityOutput["review"]) {
  if (outputs) {
    const keys = new Set(items.map((i) => `${i.setId}/${i.outputId}`))
    set(outputs.map((o) => (keys.has(`${o.setId}/${o.outputId}`) && o.status === "done" ? { ...o, review } : o)))
  }
  const response = await fetch("/api/citys/outputs", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, review }),
  })
  if (!response.ok) {
    void refreshOutputs()
    throw new Error((await response.json().catch(() => ({}))).error ?? response.statusText)
  }
}

/** More from a poster with a whole request: from its reference photo, or with the poster itself as the reference. */
export async function recreateCityOutput(setId: string, outputId: string, base: "reference" | "ours", request: CityRequest) {
  const response = await fetch("/api/citys/outputs/recreate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ setId, outputId, base, request }),
  })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? response.statusText)
  await refreshOutputs()
}

export async function redoCityOutput(setId: string, outputId: string, notes: string, count = 1) {
  const response = await fetch("/api/citys/outputs/redo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ setId, outputId, notes, count }),
  })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? response.statusText)
  await refreshOutputs()
}
