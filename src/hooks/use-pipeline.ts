"use client"

import * as React from "react"

import { refreshUsage } from "@/hooks/use-etsy-usage"
import type { JobStatus, PipelineState, UploadPlan } from "@/lib/pipeline/types"

// The upload pipeline as the Uploads page shows it: jobs, their items and
// each account's share. Re-read every couple of seconds while anything is at
// work, less often while items only wait (Gelato publishing, the final
// check), and now and then otherwise. Every change also re-reads the sidebar's
// quota, so its green bars move at once.

const BUSY_POLL = 2500
const WAITING_POLL = 10_000
const IDLE_POLL = 30_000

export type PipelineView = {
  pipeline: PipelineState | null
  /** False while the server has no pipeline yet (its routes answer 404). */
  available: boolean
  loaded: boolean
}

const listeners = new Set<() => void>()
let view: PipelineView = { pipeline: null, available: true, loaded: false }
let timer: ReturnType<typeof setTimeout> | null = null

function set(next: Partial<PipelineView>) {
  view = { ...view, ...next, loaded: true }
  listeners.forEach((notify) => notify())
  schedule()
}

/** Items at work right now (or about to be), and items parked until later. */
function activity(pipeline: PipelineState | null) {
  const running = new Set(pipeline?.jobs.filter((j) => j.status === "running").map((j) => j.id))
  let busy = false
  let waiting = false
  for (const item of pipeline?.items ?? []) {
    if (!running.has(item.jobId)) continue
    if (item.status === "running" || item.status === "queued") busy = true
    else if (item.status === "waiting") waiting = true
  }
  return { busy: busy && !pipeline?.paused, waiting }
}

function schedule() {
  if (timer) clearTimeout(timer)
  timer = null
  if (!listeners.size) return
  const { busy, waiting } = activity(view.pipeline)
  timer = setTimeout(
    () => {
      timer = null
      if (document.visibilityState === "visible") refreshPipeline()
      else schedule()
    },
    !view.available ? IDLE_POLL : busy ? BUSY_POLL : waiting ? WAITING_POLL : IDLE_POLL
  )
}

function onVisible() {
  if (document.visibilityState === "visible") refreshPipeline()
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  if (listeners.size === 1) document.addEventListener("visibilitychange", onVisible)
  if (!view.loaded) refreshPipeline()
  else schedule()
  return () => {
    listeners.delete(notify)
    if (!listeners.size) {
      document.removeEventListener("visibilitychange", onVisible)
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}

const SERVER: PipelineView = { pipeline: null, available: true, loaded: false }

export function usePipeline() {
  return React.useSyncExternalStore(subscribe, () => view, () => SERVER)
}

export async function refreshPipeline() {
  try {
    const response = await fetch("/api/pipeline", { cache: "no-store" })
    if (response.status === 404) set({ pipeline: null, available: false })
    else if (response.ok) set({ pipeline: (await response.json()) as PipelineState, available: true })
    else schedule()
  } catch {
    // Keep what's there; the next poll tries again.
    schedule()
  }
}

async function call(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } })
  if (response.status === 404 && !view.pipeline) {
    set({ available: false })
    throw new Error("The upload pipeline isn't running on the server yet")
  }
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  set({ pipeline: result as PipelineState, available: true })
  refreshUsage()
  return result as PipelineState
}

/** Starts a job: the posters of the plan, each to its account. */
export async function startUpload(plan: UploadPlan) {
  const { skipped, ...pipeline } = (await call("/api/pipeline/jobs", {
    method: "POST",
    body: JSON.stringify(plan),
  })) as PipelineState & { skipped?: number }
  return { pipeline, skipped: skipped ?? 0 }
}

export function setJobStatus(id: string, status: Exclude<JobStatus, "done">) {
  return call(`/api/pipeline/jobs/${id}`, { method: "PATCH", body: JSON.stringify({ status }) })
}

/** Holds (or lets go of) every job at once. */
export function setPipelinePaused(paused: boolean) {
  return call("/api/pipeline", { method: "PATCH", body: JSON.stringify({ paused }) })
}

/** Runs a failed item's stage again. */
export function retryItem(id: string) {
  return call(`/api/pipeline/items/${id}/retry`, { method: "POST" })
}

/** Takes an item out of its job before anything of it is on Etsy. */
export function cancelItem(id: string) {
  return call(`/api/pipeline/items/${id}`, { method: "DELETE" })
}
