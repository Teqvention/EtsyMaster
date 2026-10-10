import { respond } from "@/lib/pipeline/respond"
import { pipelineState } from "@/lib/pipeline/state"
import { patchJob } from "@/lib/pipeline/store"
import { kickPipeline } from "@/lib/pipeline/worker"

type Context = RouteContext<"/api/pipeline/jobs/[id]">

/** { status: "paused" | "running" | "cancelled" } */
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params
  return respond(async () => {
    const body = await request.json().catch(() => ({}))
    await patchJob(id, body.status)
    kickPipeline()
    return pipelineState()
  })
}
