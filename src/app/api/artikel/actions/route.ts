import { connection } from "next/server"

import { actionViews, checkParams, checkTarget, createAction } from "@/lib/artikel/actions"
import { respond } from "@/lib/artikel/respond"

// Bulk actions, newest first, with their progress. Live, so never prerendered.
export async function GET() {
  await connection()
  return respond(actionViews)
}

// Queues an action: JSON { params, target } (lib/artikel/types). Answers with every action.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { params?: unknown; target?: unknown } | null
  return respond(() => createAction(checkParams(body?.params), checkTarget(body?.target)))
}
