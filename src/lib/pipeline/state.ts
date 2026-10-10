import { pipelineBlockers } from "./blockers"
import { progressOf } from "./progress"
import { isFinished, liveNote, readPipeline } from "./store"
import type { PipelineState } from "./types"

// GET /api/pipeline: jobs not finished and those of the last week, newest
// first, with their items (a running one with what it's doing right now).

const WEEK = 7 * 24 * 60 * 60 * 1000

export async function pipelineState(): Promise<PipelineState> {
  const data = await readPipeline()
  const since = Date.now() - WEEK
  const byId = new Map(data.items.map((i) => [i.id, i]))
  const jobs = data.jobs
    .filter(
      (j) =>
        j.status === "running" ||
        j.status === "paused" ||
        Date.parse(j.finishedAt ?? j.updatedAt) > since ||
        j.items.some((id) => { const item = byId.get(id); return item && !isFinished(item) })
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const items = jobs.flatMap((job) =>
    job.items.flatMap((id) => {
      const item = byId.get(id)
      if (!item) return []
      const note = item.status === "running" ? liveNote(id) : undefined
      return [note ? { ...item, note } : item]
    })
  )
  return { jobs, items, progress: progressOf(data), paused: data.paused, blockers: await pipelineBlockers() }
}
