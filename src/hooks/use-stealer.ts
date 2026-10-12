"use client"

import * as React from "react"

import type { CityJob } from "@/lib/citys/generate"
import type { StealerCity, StealerRef, StealerState } from "@/lib/citys/stealer"
import type { CityTemplate, Inspiration } from "@/lib/citys/studio-types"

// The City Stealer's data: the places in priority order (with reference
// counts and our coverage), one place's references, strips of many places,
// the saved request templates and the inspirations. A place's crops come in
// over the next minute, so an open place is read again every few seconds
// while some are still on their way.

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result as T
}

// --- Places ---

const listeners = new Set<() => void>()
let state: StealerState | null = null
let loading: Promise<void> | null = null

function notify() {
  listeners.forEach((l) => l())
}

export function refreshStealer() {
  loading ??= json<StealerState>("/api/citys/stealer")
    .then((next) => {
      state = next
      notify()
    })
    .catch(() => {})
    .finally(() => {
      loading = null
    })
  return loading
}

export function useStealer() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      if (!state) void refreshStealer()
      return () => listeners.delete(l)
    },
    () => state,
    () => null
  )
}

/** Crops still being taken out of a place's photos. */
const cropping = (refs: StealerRef[]) => refs.some((r) => r.crop.status === "running" || r.crop.status === "pending")

/** One place's references, read again while its crops come in. */
export function useStealerCity(placeId: string | null) {
  const [data, setData] = React.useState<{ id: string; city: StealerCity } | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!placeId) return
    try {
      const city = await json<StealerCity>(`/api/citys/stealer/${encodeURIComponent(placeId)}`)
      setData({ id: placeId, city })
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [placeId])

  React.useEffect(() => {
    if (!placeId) return
    let cancelled = false
    json<StealerCity>(`/api/citys/stealer/${encodeURIComponent(placeId)}`).then(
      (city) => {
        if (cancelled) return
        setData({ id: placeId, city })
        setError(null)
      },
      (e: Error) => !cancelled && setError(e.message)
    )
    return () => {
      cancelled = true
    }
  }, [placeId])

  const city = data?.id === placeId ? data.city : null
  // The first look asks for the crops: read again a few times while they come in.
  const [polls, setPolls] = React.useState({ placeId, count: 0 })
  if (polls.placeId !== placeId) setPolls({ placeId, count: 0 })
  const waiting = !!city && (cropping(city.refs) || (polls.count < 6 && city.refs.slice(0, 36).some((r) => r.crop.status === "none")))
  React.useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => {
      setPolls((p) => ({ ...p, count: p.count + 1 }))
      void load()
    }, 4000)
    return () => clearTimeout(timer)
  }, [waiting, city, load])

  return { city, error, reload: load }
}

export async function fetchStrips(places: string[], per: number, photos: boolean) {
  return json<Record<string, StealerRef[]>>("/api/citys/stealer/strips", { method: "POST", body: JSON.stringify({ places, per, photos }) })
}

export async function cropAgain(refs: StealerRef[]) {
  return json<{ queued: number }>("/api/citys/refs/crop", {
    method: "POST",
    body: JSON.stringify({ refs: refs.map((r) => ({ listingId: r.listingId, shopId: r.shopId, image: r.short, title: r.title })) }),
  })
}

export async function generateCities(jobs: CityJob[]) {
  return json<{ sets: string[] }>("/api/citys/generate", { method: "POST", body: JSON.stringify({ jobs }) })
}

// --- Templates and inspirations ---

type Shared = { templates: CityTemplate[] | null; inspirations: Inspiration[] | null }
const sharedListeners = new Set<() => void>()
let shared: Shared = { templates: null, inspirations: null }
let sharedStarted = false

function setShared(next: Partial<Shared>) {
  shared = { ...shared, ...next }
  sharedListeners.forEach((l) => l())
}

export function refreshInspirations() {
  return json<Inspiration[]>("/api/citys/inspirations").then((inspirations) => setShared({ inspirations }), () => {})
}

function startShared() {
  if (sharedStarted) return
  sharedStarted = true
  void json<CityTemplate[]>("/api/citys/templates").then((templates) => setShared({ templates }), () => setShared({ templates: [] }))
  void refreshInspirations()
}

export function useCityShared() {
  return React.useSyncExternalStore(
    (l) => {
      sharedListeners.add(l)
      startShared()
      return () => sharedListeners.delete(l)
    },
    () => shared,
    () => ({ templates: null, inspirations: null })
  )
}

export async function saveTemplates(templates: CityTemplate[]) {
  setShared({ templates })
  const saved = await json<CityTemplate[]>("/api/citys/templates", { method: "PUT", body: JSON.stringify(templates) })
  setShared({ templates: saved })
  return saved
}
