"use client"

import * as React from "react"

import type {
  GenerateOptions,
  GenerationKind,
  GenerationSet,
  GenerationSource,
  Review,
} from "@/lib/generation/types"

// Generation sets, newest first. While any is queued or running, and anyone
// is looking, the list is re-read every couple of seconds.

const POLL = 2000

const listeners = new Set<() => void>()
let sets: GenerationSet[] | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function set(next: GenerationSet[]) {
  sets = next
  listeners.forEach((notify) => notify())
  schedule()
}

export const isActive = (s: GenerationSet) => s.status === "queued" || s.status === "running"

function schedule() {
  if (timer || !listeners.size || !sets?.some(isActive)) return
  timer = setTimeout(() => {
    timer = null
    refreshGenerations()
  }, POLL)
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  if (sets === null) refreshGenerations()
  else schedule()
  return () => {
    listeners.delete(notify)
  }
}

/** Null until loaded. */
export function useGenerations() {
  return React.useSyncExternalStore(subscribe, () => sets, () => null)
}

export async function refreshGenerations() {
  try {
    const response = await fetch("/api/generations", { cache: "no-store" })
    if (response.ok) set(await response.json())
  } catch {
    // Keep what's there; the next poll or visit tries again.
    schedule()
  }
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result
}

const replace = (updated: GenerationSet) =>
  set((sets ?? []).map((s) => (s.id === updated.id ? updated : s)))

/** Queues one set per source; they show up straight away. Poster sets make what `options` asks for. */
export async function generate(
  kind: GenerationKind,
  folder: string,
  sources: GenerationSource[],
  options?: GenerateOptions
) {
  const created = await call<GenerationSet[]>("/api/generations", {
    method: "POST",
    body: JSON.stringify({ kind, folder, sources, options }),
  })
  set([...created.toReversed(), ...(sets ?? [])])
  return created
}

/** Runs everything that failed in the set again. */
export async function retryGeneration(id: string) {
  replace(await call<GenerationSet>(`/api/generations/${id}`, { method: "POST", body: "{}" }))
}

/** More images from the set's posters, or (with `options.from`) a redo of one output. */
export async function generateMore(id: string, options: GenerateOptions) {
  replace(
    await call<GenerationSet>(`/api/generations/${id}`, {
      method: "POST",
      body: JSON.stringify({ options }),
    })
  )
}

/** Approve, reject or undecide outputs; shows at once, undone if the server says no. */
export async function reviewOutputs(id: string, ids: string[], review: Review | null) {
  const before = sets
  const reviewedAt = new Date().toISOString()
  set(
    (sets ?? []).map((s) =>
      s.id === id
        ? { ...s, outputs: s.outputs.map((o) => (ids.includes(o.id) ? { ...o, review, reviewedAt } : o)) }
        : s
    )
  )
  try {
    replace(
      await call<GenerationSet>(`/api/generations/${id}/outputs`, {
        method: "PATCH",
        body: JSON.stringify({ ids, review }),
      })
    )
  } catch (error) {
    if (before) set(before)
    throw error
  }
}

export async function deleteOutputs(id: string, ids: string[]) {
  const before = sets
  set((sets ?? []).map((s) => (s.id === id ? { ...s, outputs: s.outputs.filter((o) => !ids.includes(o.id)) } : s)))
  try {
    replace(
      await call<GenerationSet>(`/api/generations/${id}/outputs`, {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      })
    )
  } catch (error) {
    if (before) set(before)
    throw error
  }
}

export async function deleteGeneration(id: string) {
  const before = sets
  set((sets ?? []).filter((s) => s.id !== id))
  try {
    await call(`/api/generations/${id}`, { method: "DELETE" })
  } catch (error) {
    if (before) set(before)
    throw error
  }
}

export const generationFileUrl = (id: string, file: string) => `/api/generations/${id}/files/${file}`
