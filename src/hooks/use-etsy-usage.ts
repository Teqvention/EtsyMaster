"use client"

import * as React from "react"

import type { UsageState } from "@/lib/accounts/usage"

// The server's latest Etsy quota reading per account, shared by everyone
// looking. It refreshes whenever the app finishes an Etsy-backed request (see
// `notifyEtsyRequest`), on focus, and on a slow poll for quota that trickles
// back as the 24-hour window rolls; every few seconds while uploads run, so
// their progress moves.

const EVENT = "etsy:request"
const POLL_MS = 60_000
const UPLOAD_POLL_MS = 4_000

/** Call after an `/api/*` request that may have spent Etsy quota. */
export function notifyEtsyRequest() {
  window.dispatchEvent(new Event(EVENT))
}

const listeners = new Set<() => void>()
let state: UsageState | null = null
let refreshing = false
let timer: ReturnType<typeof setTimeout> | undefined
let poll: ReturnType<typeof setTimeout> | undefined

function emit() {
  listeners.forEach((notify) => notify())
}

const uploading = () => !!state?.accounts.some((a) => a.progress?.active)

async function load(refresh = false) {
  try {
    const res = await fetch(refresh ? "/api/usage?refresh" : "/api/usage", { cache: "no-store" })
    if (res.ok) {
      state = (await res.json()) as UsageState
      emit()
    }
  } catch {
    // Keep the last reading; the next trigger retries.
  }
  schedulePoll()
}

function schedulePoll() {
  clearTimeout(poll)
  if (!listeners.size) return
  poll = setTimeout(() => {
    if (document.visibilityState === "visible") load()
    else schedulePoll()
  }, uploading() ? UPLOAD_POLL_MS : POLL_MS)
}

// Coalesce bursts (a page of results plus the open listing and its shop).
function schedule() {
  clearTimeout(timer)
  timer = setTimeout(() => load(), 300)
}

function onVisible() {
  if (document.visibilityState === "visible") schedule()
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  if (listeners.size === 1) {
    window.addEventListener(EVENT, schedule)
    document.addEventListener("visibilitychange", onVisible)
    load()
  }
  return () => {
    listeners.delete(notify)
    if (!listeners.size) {
      clearTimeout(timer)
      clearTimeout(poll)
      window.removeEventListener(EVENT, schedule)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }
}

const snapshot = () => state
const refreshingSnapshot = () => refreshing

/** Asks Etsy for a fresh reading on every key now (one request each). */
async function refresh() {
  refreshing = true
  emit()
  try {
    await load(true)
  } finally {
    refreshing = false
    emit()
  }
}

/** Reads uploads progress again right away, e.g. after starting a job. */
export const refreshUsage = () => load()

export function useEtsyUsage() {
  const current = React.useSyncExternalStore(subscribe, snapshot, () => null)
  const busy = React.useSyncExternalStore(subscribe, refreshingSnapshot, () => false)
  return {
    state: current,
    /** Both analysis keys together: what research can still spend. */
    usage: current?.analysis ?? null,
    refresh,
    refreshing: busy,
  }
}
