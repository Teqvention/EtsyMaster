"use client"

import * as React from "react"

// A setting the browser remembers (localStorage), read the way React reads
// outside state: one snapshot until it changes, the default while
// prerendering, every reader told when one writes. Unreadable or missing
// storage gives the default.

const listeners = new Set<() => void>()

function subscribe(notify: () => void) {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function useStored<T extends object>(key: string, fallback: T) {
  const raw = React.useSyncExternalStore(subscribe, () => read(key), () => null)
  const value = React.useMemo(() => {
    if (!raw) return fallback
    try {
      return { ...fallback, ...JSON.parse(raw) } as T
    } catch {
      return fallback
    }
  }, [raw, fallback])
  const set = React.useCallback(
    (next: T) => {
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Not kept: the default comes back next time.
      }
      listeners.forEach((notify) => notify())
    },
    [key]
  )
  return [value, set] as const
}
