"use client"

import * as React from "react"

import type { ClassifyJob } from "@/lib/citys/artikel"

// The classification of our city shops' listings: its run, followed while
// it's going, and a call once it's done so the table can read the new
// statuses.

const POLL = 1500

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result as T
}

export function useClassifyJob(onDone: (job: ClassifyJob) => void) {
  const [job, setJob] = React.useState<ClassifyJob | null>(null)
  const done = React.useRef(onDone)
  React.useEffect(() => {
    done.current = onDone
  })

  React.useEffect(() => {
    if (job && job.status !== "running") return
    let cancelled = false
    const timer = setTimeout(
      () =>
        void json<ClassifyJob>("/api/citys/artikel/classify").then(
          (next) => {
            if (cancelled) return
            if (job?.status === "running" && next.status !== "running") done.current(next)
            setJob(next)
          },
          () => !cancelled && setJob((j) => j ?? { status: "idle", done: 0, total: 0 })
        ),
      job ? POLL : 0
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [job])

  const start = React.useCallback(async (look: boolean) => {
    setJob(await json<ClassifyJob>("/api/citys/artikel/classify", { method: "POST", body: JSON.stringify({ look }) }))
  }, [])

  return { job, start }
}

export async function importOrigins(file: File) {
  const response = await fetch("/api/citys/artikel/origins", { method: "POST", body: await file.text(), headers: { "x-file-name": file.name } })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result as { listings: number }
}
