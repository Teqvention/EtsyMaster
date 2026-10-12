"use client"

import * as React from "react"

import type { CityUploadSettings, CityUploadState, UploadPlanView } from "@/lib/citys/upload"

// Citys → Upload's data: the state (groups, shops, compositions, styles,
// uploads under way), the plan the groups make, read again whenever a group
// or an option changes (after a moment, so typing a count doesn't plan
// every keystroke), and the uploads followed while one runs.

const PLAN_DELAY = 500
const JOB_POLL = 4000

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result as T
}

export function useCityUpload() {
  const [state, setState] = React.useState<CityUploadState | null>(null)
  const [plan, setPlan] = React.useState<UploadPlanView | null>(null)
  const [planning, setPlanning] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const asked = React.useRef(0)

  const load = React.useCallback(async () => {
    try {
      setState(await json<CityUploadState>("/api/citys/upload"))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    json<CityUploadState>("/api/citys/upload").then(
      (next) => !cancelled && setState(next),
      (e: Error) => !cancelled && setError(e.message)
    )
    return () => {
      cancelled = true
    }
  }, [])

  const replan = React.useCallback(async (settings: CityUploadSettings) => {
    const id = ++asked.current
    setPlanning(true)
    try {
      const next = await json<UploadPlanView>("/api/citys/upload/plan", { method: "POST", body: JSON.stringify(settings) })
      if (id === asked.current) setPlan(next)
    } catch (e) {
      if (id === asked.current) setError((e as Error).message)
    } finally {
      if (id === asked.current) setPlanning(false)
    }
  }, [])

  // The settings change here at once; the plan follows a moment later.
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const change = React.useCallback(
    (next: CityUploadSettings) => {
      setState((s) => (s ? { ...s, settings: next } : s))
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void replan(next), PLAN_DELAY)
    },
    [replan]
  )

  // The first plan once the state is in.
  const settings = state?.settings
  const planned = React.useRef(false)
  React.useEffect(() => {
    if (!settings || planned.current) return
    planned.current = true
    void replan(settings)
  }, [settings, replan])

  const running = !!state?.jobs.some((j) => j.running > 0)
  React.useEffect(() => {
    if (!running) return
    const id = setInterval(() => void load(), JOB_POLL)
    return () => clearInterval(id)
  }, [running, load])

  return {
    state,
    plan,
    planning,
    error,
    change,
    reload: load,
    async start(dryRun: boolean) {
      const result = await json<{ job: string; items: number; skipped: number }>("/api/citys/upload/start", { method: "POST", body: JSON.stringify({ dryRun }) })
      await load()
      if (state) void replan(state.settings)
      return result
    },
    async retire(listingIds: number[]) {
      const result = await json<{ retired: number }>("/api/citys/upload/retire", { method: "POST", body: JSON.stringify({ listingIds }) })
      await load()
      return result
    },
  }
}

export function fetchCityCopy(setId: string, outputId: string) {
  return json<{ draftId: string; title: string; tags: string[]; description: string; reasoning: string }>("/api/citys/upload/copy", {
    method: "POST",
    body: JSON.stringify({ setId, outputId }),
  })
}

export const posterPreviewUrl = (setId: string, outputId: string, compositionId: string | null, width = 480) =>
  `/api/citys/upload/preview?${new URLSearchParams({ set: setId, output: outputId, ...(compositionId && { composition: compositionId }), w: String(width) })}`
