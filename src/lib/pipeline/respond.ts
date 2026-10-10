import { NotFoundError } from "@/lib/mockups/storage"

import { PlanError } from "./errors"

// Runs a pipeline operation as a JSON Route Handler response: 404 for
// unknown jobs, items and files, 400 for a plan or request that can't be
// done as asked, 500 with the message otherwise.
export async function respond(run: () => Promise<unknown>) {
  try {
    return Response.json((await run()) ?? { ok: true })
  } catch (error) {
    const status = error instanceof NotFoundError ? 404 : error instanceof PlanError ? 400 : 500
    if (status === 500) console.error("Upload pipeline:", error)
    const message = error instanceof Error ? error.message : "Request failed"
    return Response.json({ error: message }, { status })
  }
}
