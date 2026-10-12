"use client"

import * as React from "react"

import type { KeywordResearch, KeywordStrategy, PlaceKeywords, StrategyPatch } from "@/lib/citys/keywords"
import type { Tier } from "@/lib/citys/types"

// The city keyword system for the Keywords page: the research over the city
// shops' tags and titles, and the strategy built on it, changed by hand a
// list at a time (shown at once, saved after).

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result as T
}

export type PlaceHit = { id: string; name: string; countryName: string; region?: string; tier: Tier; kind: string }

export function useCityKeywords() {
  const [research, setResearch] = React.useState<KeywordResearch | null>(null)
  const [strategy, setStrategy] = React.useState<KeywordStrategy | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    json<{ research: KeywordResearch; strategy: KeywordStrategy }>("/api/citys/keywords").then(
      (data) => {
        if (cancelled) return
        setResearch(data.research)
        setStrategy(data.strategy)
      },
      (e: Error) => !cancelled && setError(e.message)
    )
    return () => {
      cancelled = true
    }
  }, [])

  const edit = React.useCallback(async (patch: StrategyPatch) => {
    setStrategy((s) => (s ? { ...s, ...patch } : s))
    setStrategy(await json<KeywordStrategy>("/api/citys/keywords/strategy", { method: "PATCH", body: JSON.stringify(patch) }))
  }, [])

  return {
    research,
    strategy,
    error,
    edit,
    async researchAgain() {
      setResearch(await json<KeywordResearch>("/api/citys/keywords/research", { method: "POST" }))
    },
    async writeStrategy() {
      setStrategy(await json<KeywordStrategy>("/api/citys/keywords/strategy", { method: "POST" }))
    },
  }
}

export function searchPlaces(q: string) {
  return json<PlaceHit[]>(`/api/citys/keywords/places?${new URLSearchParams({ q })}`)
}

export function fetchPlaceKeywords(id: string) {
  return json<PlaceKeywords>(`/api/citys/keywords/places/${encodeURIComponent(id)}`)
}
