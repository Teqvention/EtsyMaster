import { connection } from "next/server"

import { respond } from "@/lib/pipeline/respond"
import { pipelineState } from "@/lib/pipeline/state"
import { cancelItem, getItem } from "@/lib/pipeline/store"
import { kickPipeline } from "@/lib/pipeline/worker"

type Context = RouteContext<"/api/pipeline/items/[id]">

/** One item with its payloads (what its test run would have sent). */
export async function GET(_request: Request, { params }: Context) {
  await connection()
  const { id } = await params
  return respond(() => getItem(id))
}

/** Takes an item out of its job before anything of it went to Gelato. */
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params
  return respond(async () => {
    await cancelItem(id)
    kickPipeline()
    return pipelineState()
  })
}
