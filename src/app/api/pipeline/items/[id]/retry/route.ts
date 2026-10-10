import { respond } from "@/lib/pipeline/respond"
import { pipelineState } from "@/lib/pipeline/state"
import { retryItem } from "@/lib/pipeline/store"
import { kickPipeline } from "@/lib/pipeline/worker"

type Context = RouteContext<"/api/pipeline/items/[id]/retry">

/** Runs a failed item's stage again with a fresh set of tries (a waiting one's at once). */
export async function POST(_request: Request, { params }: Context) {
  const { id } = await params
  return respond(async () => {
    await retryItem(id)
    kickPipeline()
    return pipelineState()
  })
}
