"use client"

import opentype, { type Font } from "opentype.js"
import * as React from "react"

import type { FontFamily, FontLists } from "@/lib/citys/composition/fonts"
import type { TextElement } from "@/lib/citys/composition/model"
import { fontKey, type Fonts } from "@/lib/citys/composition/render"

// Fonts in the browser, for the composition editor: the files are the very
// ones print files are set with (our server keeps Google's TrueType files),
// parsed here so the editor sets text exactly as the print does. The
// catalogue of families and the shop's liked fonts and lists load once.

const parsed = new Map<string, Promise<Font | null>>()
const ready = new Map<string, Font>()
const listeners = new Set<() => void>()

function load(spec: TextElement["font"]) {
  const key = fontKey(spec)
  let font = parsed.get(key)
  if (!font) {
    font = fetch(`/api/citys/fonts/file?family=${encodeURIComponent(spec.family)}&weight=${spec.weight}&italic=${spec.italic ? 1 : 0}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
      .then((buffer) => {
        const f = opentype.parse(buffer)
        ready.set(key, f)
        listeners.forEach((l) => l())
        return f
      })
      .catch(() => null)
    parsed.set(key, font)
  }
  return font
}

/** The fonts of `specs` that have loaded, by key; asks for the rest. */
export function useLoadedFonts(specs: TextElement["font"][]): Fonts {
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    const notify = () => setTick((t) => t + 1)
    listeners.add(notify)
    return () => {
      listeners.delete(notify)
    }
  }, [])
  const keys = specs.map(fontKey).join(";")
  React.useEffect(() => {
    for (const spec of specs) void load(spec)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys])
  const fonts: Fonts = new Map()
  for (const spec of specs) {
    const f = ready.get(fontKey(spec))
    if (f) fonts.set(fontKey(spec), f)
  }
  return fonts
}

/** Loads a font to show its name in itself (the picker's preview). */
export function preloadFont(spec: TextElement["font"]) {
  return load(spec)
}

// --- Catalogue and lists ---

type State = { families: FontFamily[] | null; lists: FontLists }
let state: State = { families: null, lists: { liked: [], lists: [] } }
const stateListeners = new Set<() => void>()
let started = false

function set(next: Partial<State>) {
  state = { ...state, ...next }
  stateListeners.forEach((l) => l())
}

export function useFontCatalog() {
  return React.useSyncExternalStore(
    (l) => {
      stateListeners.add(l)
      if (!started) {
        started = true
        void fetch("/api/citys/fonts", { cache: "no-store" })
          .then((r) => r.json())
          .then((d: { families: FontFamily[]; lists: FontLists }) => set({ families: d.families, lists: d.lists }))
          .catch(() => set({ families: [] }))
      }
      return () => stateListeners.delete(l)
    },
    () => state,
    () => state
  )
}

export async function saveFontLists(lists: FontLists) {
  set({ lists })
  await fetch("/api/citys/fonts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lists) })
}
