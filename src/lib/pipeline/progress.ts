import { isFinished, readPipeline, type PipelineData } from "./store"
import type { AccountProgress } from "./types"

// Each upload account's share of the running jobs, for the sidebar: jobs at
// work or paused, and those finished in the last hour (so the bar shows
// "Done" a while before it goes). Cancelled items don't count.

const HOUR = 60 * 60 * 1000

export function progressOf({ jobs, items }: PipelineData, now = Date.now()): AccountProgress[] {
  const counted = new Map(
    jobs
      .filter((j) => j.status === "running" || j.status === "paused" || now - Date.parse(j.finishedAt ?? j.updatedAt) < HOUR)
      .map((j) => [j.id, j])
  )
  const byAccount = new Map<string, AccountProgress & { real: boolean }>()
  for (const item of items) {
    const job = counted.get(item.jobId)
    if (!job || item.status === "cancelled") continue
    let p = byAccount.get(item.account)
    if (!p) {
      p = { account: item.account, target: 0, done: 0, failed: 0, running: 0, active: false, real: false }
      byAccount.set(item.account, p)
    }
    p.target++
    if (item.done.live) p.done++
    else if (item.status === "failed") p.failed++
    if (item.status === "running") p.running++
    if (!isFinished(item)) p.active = true
    if (!job.dryRun) p.real = true
  }
  return [...byAccount.values()].map(({ real, ...p }) => (real ? p : { ...p, dryRun: true }))
}

export async function accountProgress(): Promise<AccountProgress[]> {
  return progressOf(await readPipeline())
}
