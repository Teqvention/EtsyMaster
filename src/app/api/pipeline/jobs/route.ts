import { PlanError } from "@/lib/pipeline/errors"
import { respond } from "@/lib/pipeline/respond"
import { pipelineState } from "@/lib/pipeline/state"
import { createJob } from "@/lib/pipeline/store"
import { kickPipeline } from "@/lib/pipeline/worker"

/** An UploadPlan from the Upload dialog: starts a job, answers the whole pipeline. */
export async function POST(request: Request) {
  return respond(async () => {
    const plan = await request.json().catch(() => {
      throw new PlanError("The plan isn't JSON")
    })
    await createJob(plan)
    kickPipeline()
    return pipelineState()
  })
}
