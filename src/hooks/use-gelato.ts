"use client"

import * as React from "react"

import type { GelatoStore } from "@/lib/gelato/client"

// The Gelato keys (their labels, never the keys) and every store they reach,
// as Settings shows them: which store prints for which shop. Loaded once per
// session; the server keeps Gelato's answer ten minutes, a refresh asks again.

export type GelatoStoreView = GelatoStore & { keyId: string; keyLabel: string }

export type GelatoState = {
  keys: { id: string; label: string }[]
  stores: GelatoStoreView[]
  /** Why nothing could be loaded. */
  error?: string
}

const listeners = new Set<() => void>()
let state: GelatoState | null = null
let loading: Promise<void> | null = null

function set(next: GelatoState) {
  state = next
  listeners.forEach((notify) => notify())
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  if (state === null) {
    loading ??= refreshGelato()
      .catch(() => {})
      .finally(() => {
        loading = null
      })
  }
  return () => {
    listeners.delete(notify)
  }
}

/** Null until loaded. */
export function useGelato() {
  return React.useSyncExternalStore(subscribe, () => state, () => null)
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json" } })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result as T
}

/** Loads keys and stores again; `fresh` asks Gelato instead of the server's copy. */
export async function refreshGelato(fresh = false) {
  try {
    set(await call<GelatoState>(`/api/gelato/stores${fresh ? "?refresh" : ""}`))
  } catch (error) {
    if (state === null) set({ keys: [], stores: [], error: (error as Error).message })
    throw error
  }
}

/** Saves a key once Gelato answers to it; resolves to its id and label. */
export async function addGelatoKey(label: string, key: string) {
  const added = await call<{ id: string; label: string }>("/api/gelato/stores", {
    method: "POST",
    body: JSON.stringify({ label, key }),
  })
  await refreshGelato().catch(() => {})
  return added
}

export async function removeGelatoKey(id: string) {
  await call(`/api/gelato/stores?id=${encodeURIComponent(id)}`, { method: "DELETE" })
  if (state) {
    set({ ...state, keys: state.keys.filter((k) => k.id !== id), stores: state.stores.filter((s) => s.keyId !== id) })
  }
}
