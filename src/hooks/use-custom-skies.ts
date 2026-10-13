"use client"

import * as React from "react"

import type { CustomSky } from "@/lib/citys/sky-store"

// The shop's own skies, made from photos: read once, shared by every picker.

const listeners = new Set<() => void>()
let skies: CustomSky[] | null = null
let started = false

function set(next: CustomSky[]) {
  skies = next
  listeners.forEach((notify) => notify())
}

export async function refreshCustomSkies() {
  try {
    const response = await fetch("/api/citys/skies", { cache: "no-store" })
    if (response.ok) set(await response.json())
  } catch {
    // Kept as they were; the next visit reads again.
  }
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  if (!started) {
    started = true
    void refreshCustomSkies()
  }
  return () => {
    listeners.delete(notify)
  }
}

/** Null until loaded. */
export function useCustomSkies() {
  return React.useSyncExternalStore(subscribe, () => skies, () => null)
}

export const skyFileUrl = (sky: Pick<CustomSky, "key">, file: string) => `/api/citys/skies/${sky.key}/files/${file}`

export async function createCustomSky(files: File[], name?: string) {
  const form = new FormData()
  for (const f of files) form.append("files", f)
  if (name?.trim()) form.append("name", name.trim())
  const response = await fetch("/api/citys/skies", { method: "POST", body: form })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  await refreshCustomSkies()
  return result as CustomSky
}

export async function deleteCustomSky(key: string) {
  const response = await fetch(`/api/citys/skies/${key}`, { method: "DELETE" })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? response.statusText)
  await refreshCustomSkies()
}
