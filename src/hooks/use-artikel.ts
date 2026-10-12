"use client"

import * as React from "react"

import { refreshUsage } from "@/hooks/use-etsy-usage"
import type {
  ActionParams,
  ActionPreview,
  ActionTarget,
  ActionView,
  ArtikelDetail,
  ArtikelState,
  TagsFile,
} from "@/lib/artikel/types"
import type { CityStatus } from "@/lib/citys/ours"
import type { SyncStatus } from "@/lib/sync/types"

// Artikel's data: the table for one shop (or all) over a range, re-read when
// either changes, when a sync finishes and when a bulk action changed
// listings; the bulk actions, re-read every couple of seconds while one is at
// work; and the sync's state, followed while it runs.

export type ArtikelQuery = { account: string | null; from: string; to: string }

const ACTION_POLL = 2500
const WAITING_POLL = 15_000
const SYNC_POLL = 3000
/** Listings changed by actions show this long after the last change. */
const SETTLE = 3000

export type ArtikelData = {
  state: ArtikelState | null
  /** The query `state` answers; while it differs from the one asked, a new one loads. */
  key: string | null
  loading: boolean
  error: string | null
  actions: ActionView[] | null
}

const listeners = new Set<() => void>()
let data: ArtikelData = { state: null, key: null, loading: false, error: null, actions: null }
let query: ArtikelQuery | null = null
let actionTimer: ReturnType<typeof setTimeout> | null = null
let syncTimer: ReturnType<typeof setTimeout> | null = null
let settleTimer: ReturnType<typeof setTimeout> | null = null
/** Listings actions have finished so far, to notice new ones. */
let finished = -1
let request = 0

function set(next: Partial<ArtikelData>) {
  data = { ...data, ...next }
  listeners.forEach((notify) => notify())
}

const keyOf = (q: ArtikelQuery) => `${q.account ?? ""}|${q.from}|${q.to}`

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

// --- The table ---

async function loadState() {
  if (!query) return
  const asked = query
  const id = ++request
  set({ loading: true })
  try {
    const params = new URLSearchParams({ from: asked.from, to: asked.to })
    if (asked.account) params.set("account", asked.account)
    const state = await json<ArtikelState>(`/api/artikel?${params}`)
    if (id !== request) return
    set({ state, key: keyOf(asked), loading: false, error: null })
    followSync(state.sync)
  } catch (error) {
    if (id === request) set({ loading: false, error: (error as Error).message })
  }
}

/** Re-reads the table once things calm down. */
function settle() {
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    settleTimer = null
    void loadState()
  }, SETTLE)
}

/** Null `next` while the query isn't known yet (no clock while prerendering). */
export function useArtikel(next: ArtikelQuery | null) {
  const key = next ? keyOf(next) : null
  const snapshot = React.useSyncExternalStore(subscribe, () => data, () => SERVER)
  React.useEffect(() => {
    if (key === null) return
    const [account, from, to] = key.split("|")
    query = { account: account || null, from, to }
    if (data.key !== key) void loadState()
  }, [key])
  return snapshot
}

const SERVER: ArtikelData = { state: null, key: null, loading: false, error: null, actions: null }

function subscribe(notify: () => void) {
  listeners.add(notify)
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onVisible)
    void refreshActions()
    // Back on the page: what's shown may be old.
    if (query) void loadState()
  }
  return () => {
    listeners.delete(notify)
    if (listeners.size) return
    document.removeEventListener("visibilitychange", onVisible)
    for (const timer of [actionTimer, syncTimer, settleTimer]) if (timer) clearTimeout(timer)
    actionTimer = syncTimer = settleTimer = null
  }
}

function onVisible() {
  if (document.visibilityState !== "visible") return
  void refreshActions()
  if (data.state?.sync.some((s) => s.running)) void pollSync()
}

// --- Sync ---

function followSync(sync: SyncStatus[]) {
  if (syncTimer || !listeners.size || !sync.some((s) => s.running)) return
  syncTimer = setTimeout(() => {
    syncTimer = null
    void pollSync()
  }, SYNC_POLL)
}

async function pollSync() {
  try {
    const sync = await json<SyncStatus[]>("/api/sync")
    const was = data.state?.sync.some((s) => s.running)
    if (data.state) set({ state: { ...data.state, sync } })
    // Finished: the new numbers are in.
    if (was && !sync.some((s) => s.running)) {
      void loadState()
      refreshUsage()
    } else followSync(sync)
  } catch {
    followSync(data.state?.sync ?? [])
  }
}

/** Starts a sync of one account, or of every one. */
export async function syncNow(account?: string) {
  const sync = await json<SyncStatus[]>("/api/sync", { method: "POST", body: JSON.stringify({ account }) })
  if (data.state) set({ state: { ...data.state, sync } })
  followSync(sync)
}

// --- Bulk actions ---

const open = (a: ActionView) => a.status === "queued" || a.status === "running"

function setActions(actions: ActionView[]) {
  set({ actions })
  const done = actions.reduce((sum, a) => sum + a.counts.done, 0)
  if (finished !== -1 && done !== finished) {
    settle()
    refreshUsage()
  }
  finished = done
  if (actionTimer) clearTimeout(actionTimer)
  actionTimer = null
  if (!listeners.size) return
  const working = actions.some((a) => open(a) && !a.wakeAt)
  const waiting = actions.some((a) => open(a) && a.wakeAt)
  if (!working && !waiting) return
  actionTimer = setTimeout(
    () => {
      actionTimer = null
      if (document.visibilityState === "visible") void refreshActions()
    },
    working ? ACTION_POLL : WAITING_POLL
  )
}

export async function refreshActions() {
  try {
    setActions(await json<ActionView[]>("/api/artikel/actions"))
  } catch {
    // Keep what's there; the next look tries again.
  }
}

export function previewAction(params: ActionParams, target: ActionTarget) {
  return json<ActionPreview>("/api/artikel/actions/preview", { method: "POST", body: JSON.stringify({ params, target }) })
}

export async function startAction(params: ActionParams, target: ActionTarget) {
  setActions(await json<ActionView[]>("/api/artikel/actions", { method: "POST", body: JSON.stringify({ params, target }) }))
}

export async function changeAction(id: string, change: { status?: "paused" | "running" | "cancelled"; retry?: boolean }) {
  setActions(await json<ActionView[]>(`/api/artikel/actions/${id}`, { method: "PATCH", body: JSON.stringify(change) }))
}

export async function removeAction(id: string) {
  setActions(await json<ActionView[]>(`/api/artikel/actions/${id}`, { method: "DELETE" }))
}

// --- Internal tags ---

function setTags(file: TagsFile) {
  if (!data.state) return
  set({
    state: {
      ...data.state,
      tags: file.tags,
      rows: data.state.rows.map((r) => ({ ...r, tags: file.assigned[r.listingId] ?? [] })),
    },
  })
}

export async function createTag(name: string, color?: string) {
  const file = await json<TagsFile>("/api/artikel/tags", { method: "POST", body: JSON.stringify({ name, color }) })
  setTags(file)
  return file.tags.find((t) => t.name.toLowerCase() === name.trim().toLowerCase()) ?? null
}

export async function updateTag(id: string, patch: { name?: string; color?: string }) {
  setTags(await json<TagsFile>(`/api/artikel/tags/${id}`, { method: "PATCH", body: JSON.stringify(patch) }))
}

export async function deleteTag(id: string) {
  setTags(await json<TagsFile>(`/api/artikel/tags/${id}`, { method: "DELETE" }))
}

export async function assignTags(listingIds: number[], change: { add?: string[]; remove?: string[] }) {
  setTags(
    await json<TagsFile>("/api/artikel/tags/assign", { method: "POST", body: JSON.stringify({ listingIds, ...change }) })
  )
}

// --- One listing ---

export function fetchDetail(listingId: number, range: { from: string; to: string }) {
  return json<ArtikelDetail>(`/api/artikel/listings/${listingId}?${new URLSearchParams(range)}`)
}

// --- City columns ---

/** Reads the table again, e.g. once a classification has finished. */
export function reloadArtikel() {
  void loadState()
}

/** Sets our city listings' status by hand (null hands them back to the classification); shown at once. */
export async function setCityStatus(listingIds: number[], status: CityStatus | null) {
  const ids = new Set(listingIds)
  const before = data.state
  if (before && status) {
    set({
      state: {
        ...before,
        rows: before.rows.map((r) => (r.city && ids.has(r.listingId) ? { ...r, city: { ...r.city, status, manual: true, reason: "Set by hand" } } : r)),
      },
    })
  }
  try {
    await json("/api/citys/artikel/status", { method: "PATCH", body: JSON.stringify({ listingIds, status }) })
  } catch (error) {
    if (before) set({ state: before })
    throw error
  }
  if (!status) void loadState()
}
