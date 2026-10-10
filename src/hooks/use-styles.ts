"use client"

import * as React from "react"

import type { Style, StyleGuide, StyleSummary } from "@/lib/styles/types"

// Styles for the Styles page and every picker. The list loads once per
// session and is refreshed whenever a picker opens; one style's full record
// is fetched by `useStyle`, which keeps polling while its guide is being read.

const listeners = new Set<() => void>()
let styles: StyleSummary[] | null = null
let loading: Promise<void> | null = null

function set(next: StyleSummary[]) {
  styles = next
  listeners.forEach((notify) => notify())
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  if (styles === null) refreshStyles()
  return () => {
    listeners.delete(notify)
  }
}

/** Null until loaded. Last changed first. */
export function useStyles() {
  return React.useSyncExternalStore(subscribe, () => styles, () => null)
}

export function refreshStyles() {
  loading ??= fetch("/api/styles", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then(set)
    .catch(() => {
      if (styles === null) set([])
    })
    .finally(() => {
      loading = null
    })
  return loading
}

/** A moodboard image; `width` asks for a smaller copy (160, 320, 480 or 960 px). */
export function styleFileUrl(id: string, file: string, width?: number) {
  return `/api/styles/${id}/files/${file}${width ? `?w=${width}` : ""}`
}

/** Adds `?w=` to a cover URL from a summary. */
export const sized = (url: string, width: number) => `${url}?w=${width}`

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result as T
}

/** Puts the style's summary in the list, so pickers show changes at once. */
function remember(style: Style) {
  if (styles === null) return
  const summary: StyleSummary = {
    id: style.id,
    name: style.name,
    guide: style.guide,
    guideStatus: style.guideStatus,
    incoming: style.incoming,
    createdAt: style.createdAt,
    updatedAt: style.updatedAt,
    count: style.images.length,
    covers: style.images.slice(0, 4).map((i) => styleFileUrl(style.id, i.file)),
  }
  set([summary, ...styles.filter((s) => s.id !== style.id)])
}

export async function createStyle(name: string) {
  const style = await api<Style>("/api/styles", { method: "POST", body: JSON.stringify({ name }) })
  remember(style)
  return style
}

export async function deleteStyle(id: string) {
  await api(`/api/styles/${id}`, { method: "DELETE" })
  if (styles) set(styles.filter((s) => s.id !== id))
}

export async function updateStyle(
  id: string,
  change: { name?: string; order?: string[]; guide?: StyleGuide | null }
) {
  const style = await api<Style>(`/api/styles/${id}`, { method: "PATCH", body: JSON.stringify(change) })
  remember(style)
  return style
}

export async function uploadStyleImages(id: string, files: File[]) {
  const body = new FormData()
  for (const file of files) body.append("files", file)
  const style = await api<Style>(`/api/styles/${id}/images`, { method: "POST", body })
  remember(style)
  return style
}

/** Copies posters from the Generation page onto the moodboard. */
export async function addGeneratedImages(id: string, items: { generation: string; file: string }[]) {
  const style = await api<Style>(`/api/styles/${id}/images`, {
    method: "POST",
    body: JSON.stringify({ items }),
  })
  remember(style)
  return style
}

/**
 * Puts the posters of saved listings on the moodboard: the server takes them
 * out of the photos in the background, the style counting them as `incoming`.
 */
export async function addSavedListings(
  id: string,
  listings: { listingId: number; title: string; image: string }[]
) {
  const style = await api<Style>(`/api/styles/${id}/saved`, {
    method: "POST",
    body: JSON.stringify({ listings }),
  })
  remember(style)
  return style
}

/** A suggested name for a style made of these generated posters. */
export async function suggestStyleName(items: { generation: string; file: string }[]) {
  const { name } = await api<{ name: string }>("/api/styles/name", {
    method: "POST",
    body: JSON.stringify({ items }),
  })
  return name
}

export async function removeStyleImage(id: string, file: string) {
  const style = await api<Style>(`/api/styles/${id}/images/${file}`, { method: "DELETE" })
  remember(style)
  return style
}

export async function readStyleNow(id: string) {
  const style = await api<Style>(`/api/styles/${id}/understand`, { method: "POST" })
  remember(style)
  return style
}

// --- One style ---

export const POLL = 1500
// A read is scheduled a moment after the board changes; keep looking for it
// this long after a change even before the server says it started.
export const EXPECT_READ = 6000

/**
 * The full style, kept fresh: `set` takes an answer from the server, and
 * while saved posters are coming in or the guide is (about to be) read, the
 * style is polled until it lands.
 */
export function useStyle(id: string) {
  const [state, setState] = React.useState<{ style: Style | null; error: string | null }>({
    style: null,
    error: null,
  })
  const [expectUntil, setExpectUntil] = React.useState(0)

  const apply = React.useCallback((style: Style, { expectRead = false } = {}) => {
    setState({ style, error: null })
    remember(style)
    // The read starts once the last saved poster is on the board.
    if (expectRead || style.incoming) setExpectUntil(Date.now() + EXPECT_READ)
  }, [])

  const load = React.useCallback(async () => {
    try {
      const style = await api<Style>(`/api/styles/${id}`, { cache: "no-store" })
      setState({ style, error: null })
      remember(style)
      if (style.incoming) setExpectUntil(Date.now() + EXPECT_READ)
    } catch (error) {
      setState((s) => ({ style: s.style, error: (error as Error).message }))
    }
  }, [id])

  React.useEffect(() => {
    // Fetched on mount; React's own state is only set once the answer is in.
    load()
  }, [load])

  const busy = state.style?.guideStatus === "running" || !!state.style?.incoming
  React.useEffect(() => {
    if (!busy && expectUntil <= Date.now()) return
    const timer = setInterval(() => {
      load()
      if (!busy && Date.now() > expectUntil) setExpectUntil(0)
    }, POLL)
    return () => clearInterval(timer)
  }, [busy, expectUntil, load])

  return { ...state, apply, reload: load }
}
