"use client"

import * as React from "react"

const MERGE_MS = 1000
const LIMIT = 200

// Undoable state. Edits sharing a merge key within a second (a drag, a
// slider, typing a name) collapse into one step.
export function useHistory<T>(initial: T) {
  const [state, setState] = React.useState({ past: [] as T[], present: initial, future: [] as T[] })
  const last = React.useRef<{ key: string; at: number } | null>(null)

  const commit = React.useCallback((next: T | ((current: T) => T), merge?: string) => {
    const now = performance.now()
    const merging = !!merge && last.current?.key === merge && now - last.current.at < MERGE_MS
    last.current = merge ? { key: merge, at: now } : null
    setState((s) => {
      const value = typeof next === "function" ? (next as (c: T) => T)(s.present) : next
      if (value === s.present) return s
      return {
        past: merging ? s.past : [...s.past, s.present].slice(-LIMIT),
        present: value,
        future: [],
      }
    })
  }, [])

  const undo = React.useCallback(() => {
    last.current = null
    setState((s) =>
      s.past.length
        ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] }
        : s
    )
  }, [])

  const redo = React.useCallback(() => {
    last.current = null
    setState((s) =>
      s.future.length
        ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) }
        : s
    )
  }, [])

  /** Swap `from` for `to` without an undo step, unless it was edited since. */
  const replace = React.useCallback((from: T, to: T) => {
    setState((s) => (s.present === from ? { ...s, present: to } : s))
  }, [])

  return {
    value: state.present,
    commit,
    replace,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  }
}
