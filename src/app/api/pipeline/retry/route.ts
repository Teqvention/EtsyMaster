import { respond } from "@/lib/pipeline/respond"
import { pipelineState } from "@/lib/pipeline/state"
import { retryItems } from "@/lib/pipeline/store"
import { kickPipeline } from "@/lib/pipeline/worker"

/** { items: string[] }: runs every failed one of them again, each with a fresh set of tries. */
export async function POST(request: Request) {
  return respond(async () => {
    const body = await request.json().catch(() => ({}))
    await retryItems(body.items)
    kickPipeline()
    return pipelineState()
  })
}
