"use client"

import * as React from "react"

import type { DraftPatch, DraftView, UploadsState } from "@/lib/uploads/types"

// The Uploads page's state: drafts, approved posters still without one, the
// mockup chains and the keyword library's size. While the copywriter is
// busy with any draft, re-read every couple of seconds for anyone looking.

const POLL = 2000

const listeners = new Set<() => void>()
let state: UploadsState | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function set(next: UploadsState) {
  state = next
  listeners.forEach((notify) => notify())
  schedule()
}

export const isWriting = (d: DraftView) => d.copy === "queued" || d.copy === "writing"

function schedule() {
  if (timer || !listeners.size || !state?.drafts.some(isWriting)) return
  timer = setTimeout(() => {
    timer = null
    refreshUploads()
  }, POLL)
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  if (state === null) refreshUploads()
  else schedule()
  return () => {
    listeners.delete(notify)
  }
}

/** Null until loaded. */
export function useUploads() {
  return React.useSyncExternalStore(subscribe, () => state, () => null)
}

export async function refreshUploads() {
  try {
    const response = await fetch("/api/uploads", { cache: "no-store" })
    if (response.ok) set(await response.json())
  } catch {
    // Keep what's there; the next poll or visit tries again.
    schedule()
  }
}

async function call(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  set(result as UploadsState)
}

/** Drafts for every approved poster without one, or for one poster. */
export function createDrafts(request: { all: true } | { generationId: string; outputId: string }) {
  return call("/api/uploads", { method: "POST", body: JSON.stringify(request) })
}

/** Change a draft; shows at once, undone if the server says no. */
export async function patchDraft(id: string, patch: DraftPatch) {
  const before = state
  if (state) {
    set({ ...state, drafts: state.drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)) })
  }
  try {
    await call(`/api/uploads/${id}`, { method: "PATCH", body: JSON.stringify(patch) })
  } catch (error) {
    if (before) set(before)
    throw error
  }
}

export async function deleteDraft(id: string) {
  const before = state
  if (state) set({ ...state, drafts: state.drafts.filter((d) => d.id !== id) })
  try {
    await call(`/api/uploads/${id}`, { method: "DELETE" })
  } catch (error) {
    if (before) set(before)
    throw error
  }
}

/** Write the copy again, optionally steered ("more gift-focused"). */
export async function rewriteDraft(id: string, hint?: string) {
  if (state) {
    set({ ...state, drafts: state.drafts.map((d) => (d.id === id ? { ...d, copy: "queued", error: undefined } : d)) })
  }
  await call(`/api/uploads/${id}/rewrite`, { method: "POST", body: JSON.stringify({ hint }) })
}
