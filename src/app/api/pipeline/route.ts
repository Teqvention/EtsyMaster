import { connection } from "next/server"

import { respond } from "@/lib/pipeline/respond"
import { pipelineState } from "@/lib/pipeline/state"
import { setPaused } from "@/lib/pipeline/store"
import { kickPipeline, startPipeline } from "@/lib/pipeline/worker"

// The upload pipeline as the Uploads page shows it. Live process state, so
// never prerendered; reading it also makes sure the worker runs.
export async function GET() {
  await connection()
  startPipeline()
  return respond(pipelineState)
}

/** { paused: boolean }: holds (or lets go of) every job at once. */
export async function PATCH(request: Request) {
  return respond(async () => {
    const body = await request.json().catch(() => ({}))
    await setPaused(body.paused)
    kickPipeline()
    return pipelineState()
  })
}
