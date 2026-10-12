"use client"

import * as React from "react"

import type { ReadJob } from "@/lib/citys/job"
import type { PlaceEdit } from "@/lib/citys/places"
import type { CitySettings, SettingsPatch } from "@/lib/citys/settings"
import type { Ranking } from "@/lib/citys/types"

// The ranking, the run reading the city shops' titles, and the city setup,
// for every city page. The ranking loads once per session and again when
// the scope changes; while a run reads titles it's followed every few
// seconds and the ranking re-read as the run gets on, so places fill in.

const JOB_POLL = 3000
/** While titles are read, the ranking is re-read this often. */
const RANKING_POLL = 20_000

type State = {
  ranking: Ranking | null
  loading: boolean
  error: string | null
  job: ReadJob | null
  settings: CitySettings | null
}

const listeners = new Set<() => void>()
let state: State = { ranking: null, loading: false, error: null, job: null, settings: null }
let started = false
let jobTimer: ReturnType<typeof setTimeout> | null = null
let lastRankingAt = 0
let request = 0

function set(next: Partial<State>) {
  state = { ...state, ...next }
  listeners.forEach((notify) => notify())
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result as T
}

export async function refreshRanking() {
  const id = ++request
  set({ loading: true })
  try {
    const ranking = await json<Ranking>("/api/citys/ranking")
    if (id !== request) return
    lastRankingAt = Date.now()
    set({ ranking, loading: false, error: null })
  } catch (error) {
    if (id !== request) return
    set({ loading: false, error: (error as Error).message })
  }
}

async function pollJob() {
  if (jobTimer) clearTimeout(jobTimer)
  try {
    const job = await json<ReadJob>("/api/citys/read")
    const was = state.job?.status
    set({ job })
    if (job.status === "running") {
      if (Date.now() - lastRankingAt > RANKING_POLL) void refreshRanking()
      jobTimer = setTimeout(pollJob, JOB_POLL)
    } else if (was === "running") {
      void refreshRanking()
    }
  } catch {
    jobTimer = setTimeout(pollJob, JOB_POLL * 5)
  }
}

function start() {
  if (started) return
  started = true
  void refreshRanking()
  void pollJob()
  void json<CitySettings>("/api/citys/settings").then((settings) => set({ settings }), () => {})
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  start()
  return () => {
    listeners.delete(notify)
  }
}

const read = () => state
const EMPTY: State = { ranking: null, loading: false, error: null, job: null, settings: null }

export function useCityRanking() {
  return React.useSyncExternalStore(subscribe, read, () => EMPTY)
}

/** Starts reading new and changed titles (and matching their places). */
export async function startReading() {
  const job = await json<ReadJob>("/api/citys/read", { method: "POST" })
  set({ job })
  void pollJob()
}

export async function stopReading() {
  const job = await json<ReadJob>("/api/citys/read", { method: "DELETE" })
  set({ job })
}

export async function patchCitySettings(patch: SettingsPatch) {
  const settings = await json<CitySettings>("/api/citys/settings", { method: "PATCH", body: JSON.stringify(patch) })
  set({ settings })
  if (patch.scope) await refreshRanking()
  return settings
}

export async function editPlace(id: string, edit: PlaceEdit | { mergeInto: string }) {
  await json(`/api/citys/places/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(edit) })
  await refreshRanking()
}
