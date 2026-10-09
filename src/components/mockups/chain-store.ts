"use client"

import * as React from "react"

import type { ChainPatch, MockupChain } from "@/lib/mockups/chain-types"

// Mockup chains in the browser. Loaded once per session; a change shows at
// once and the server's list then replaces it (or it's undone on failure).

const listeners = new Set<() => void>()
let chains: MockupChain[] | null = null
let loading: Promise<void> | null = null

function set(next: MockupChain[]) {
  chains = next
  listeners.forEach((notify) => notify())
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  if (chains === null) refreshChains()
  return () => {
    listeners.delete(notify)
  }
}

/** Null until loaded. */
export function useChains() {
  return React.useSyncExternalStore(subscribe, () => chains, () => null)
}

export function refreshChains() {
  loading ??= request("/api/mockups/chains")
    .then(set)
    .catch(() => {
      if (chains === null) set([])
    })
    .finally(() => {
      loading = null
    })
  return loading
}

/** A new chain (the default if it's the first); resolves to it. */
export async function createChain(name: string, scenes: string[] = []) {
  const list = await request("/api/mockups/chains", { method: "POST", body: JSON.stringify({ name, scenes }) })
  set(list)
  return list.at(-1)!
}

export function patchChain(id: string, patch: ChainPatch) {
  return change(
    (list) =>
      list.map((c) =>
        c.id === id ? { ...c, ...patch, isDefault: patch.isDefault ?? c.isDefault } : patch.isDefault ? { ...c, isDefault: false } : c
      ),
    `/api/mockups/chains/${id}`,
    { method: "PATCH", body: JSON.stringify(patch) }
  )
}

export function deleteChain(id: string) {
  return change((list) => list.filter((c) => c.id !== id), `/api/mockups/chains/${id}`, { method: "DELETE" })
}

async function change(apply: (list: MockupChain[]) => MockupChain[], url: string, init: RequestInit) {
  await (loading ?? (chains === null ? refreshChains() : null))
  const before = chains ?? []
  set(apply(before))
  try {
    set(await request(url, init))
  } catch (error) {
    set(before)
    throw error
  }
}

async function request(url: string, init?: RequestInit): Promise<MockupChain[]> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json" },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error ?? response.statusText)
  return body
}
