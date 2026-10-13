"use client"

import * as React from "react"

import { refreshStyles } from "@/hooks/use-styles"
import type { LabRound } from "@/lib/citys/studio-types"
import type { Style } from "@/lib/styles/types"

// One city style in the lab: the style and its test rounds, read again
// every couple of seconds while something is on its way (the board being
// read, a round being painted). Lab actions answer with the style, which
// is shown at once.

export type Round = LabRound & { status: "preparing" | "painting" | "done" }
type Data = { style: Style; rounds: Round[] }

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result as T
}

const POLL = 2500

export function useCityStyle(id: string) {
  const [data, setData] = React.useState<Data | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  // Something was just started that the next reads should show (a guide read, a round): read on for a while.
  const [expecting, setExpecting] = React.useState(false)
  const expectTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const expect = React.useCallback(() => {
    setExpecting(true)
    if (expectTimer.current) clearTimeout(expectTimer.current)
    expectTimer.current = setTimeout(() => setExpecting(false), 8000)
  }, [])

  const load = React.useCallback(async () => {
    try {
      setData(await json<Data>(`/api/citys/styles/${id}`))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])

  React.useEffect(() => {
    let cancelled = false
    json<Data>(`/api/citys/styles/${id}`).then(
      (next) => {
        if (cancelled) return
        setData(next)
        setError(null)
      },
      (e: Error) => !cancelled && setError(e.message)
    )
    return () => {
      cancelled = true
    }
  }, [id])

  const busy =
    !!data &&
    (data.style.guideStatus === "running" ||
      !!data.style.incoming ||
      data.rounds.some((r) => r.status !== "done") ||
      data.style.city?.autotest?.status === "running" ||
      data.style.city?.interviewing?.status === "testing" ||
      data.style.city?.interviewing?.status === "asking" ||
      expecting)
  React.useEffect(() => {
    if (!busy) return
    const timer = setTimeout(load, POLL)
    return () => clearTimeout(timer)
  }, [busy, data, load])

  const applyStyle = React.useCallback((style: Style) => {
    setData((d) => (d ? { ...d, style } : d))
    void refreshStyles()
  }, [])

  /** Runs a lab action; what comes back (a style) is shown, and the page looks again for what it started. */
  const act = React.useCallback(
    async (body: Record<string, unknown>) => {
      const result = await json<Style | LabRound | { ok: true }>(`/api/citys/styles/${id}`, { method: "POST", body: JSON.stringify(body) })
      if (result && "images" in result && "kind" in (result as Style)) applyStyle(result as Style)
      expect()
      await load()
      return result
    },
    [id, load, applyStyle, expect]
  )

  const patch = React.useCallback(
    async (body: Record<string, unknown>) => {
      applyStyle(await json<Style>(`/api/citys/styles/${id}`, { method: "PATCH", body: JSON.stringify(body) }))
    },
    [id, applyStyle]
  )

  return { data, error, reload: load, act, patch, applyStyle, expectRead: expect }
}

export async function createCityStyle(name: string, tags: string[] = []) {
  const style = await json<Style>("/api/citys/styles", { method: "POST", body: JSON.stringify({ name, tags }) })
  void refreshStyles()
  return style
}
