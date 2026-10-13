"use client"

import * as React from "react"

// Picking items in a grid: a click toggles one, Shift-click adds the run from
// the last one clicked, ⌘A takes all and Escape lets go. Keys that leave the
// grid drop out of the selection on their own.

export type Selection<K extends number | string = number> = ReturnType<typeof useSelection<K>>

export function useSelection<K extends number | string = number>(keys: K[]) {
  const [picked, setPicked] = React.useState<ReadonlySet<K>>(() => new Set())
  const anchor = React.useRef<K | null>(null)

  const selected = React.useMemo(() => {
    const present = new Set(keys)
    return new Set([...picked].filter((k) => present.has(k)))
  }, [keys, picked])

  const toggle = React.useCallback(
    (key: K, { range = false } = {}) => {
      const from = anchor.current === null ? -1 : keys.indexOf(anchor.current)
      const to = keys.indexOf(key)
      if (range && from !== -1 && to !== -1) {
        const run = keys.slice(Math.min(from, to), Math.max(from, to) + 1)
        setPicked((current) => new Set([...current, ...run]))
      } else {
        setPicked((current) => {
          const next = new Set(current)
          if (!next.delete(key)) next.add(key)
          return next
        })
      }
      anchor.current = key
    },
    [keys]
  )

  const replace = React.useCallback((next: Iterable<K>) => setPicked(new Set(next)), [])
  const selectAll = React.useCallback(() => setPicked(new Set(keys)), [keys])
  const clear = React.useCallback(() => {
    setPicked(new Set())
    anchor.current = null
  }, [])

  // ⌘A / Ctrl+A and Escape, unless typing somewhere.
  const count = selected.size
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement
      if (target.closest("input, textarea, select, [contenteditable], [role=menu], [role=dialog]")) return
      if (event.key === "a" && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        selectAll()
      } else if (event.key === "Escape" && count > 0) {
        event.preventDefault()
        clear()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [count, selectAll, clear])

  return { selected, count, has: (key: K) => selected.has(key), toggle, replace, selectAll, clear }
}
