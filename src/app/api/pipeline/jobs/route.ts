import { PlanError } from "@/lib/pipeline/errors"
import { respond } from "@/lib/pipeline/respond"
import { pipelineState } from "@/lib/pipeline/state"
import { createJob } from "@/lib/pipeline/store"
import { kickPipeline } from "@/lib/pipeline/worker"

/** An UploadPlan from the Upload dialog: starts a job, answers the whole pipeline and how many posters it left out. */
export async function POST(request: Request) {
  return respond(async () => {
    const plan = await request.json().catch(() => {
      throw new PlanError("The plan isn't JSON")
    })
    const { skipped } = await createJob(plan)
    kickPipeline()
    return { ...(await pipelineState()), skipped }
  })
}
