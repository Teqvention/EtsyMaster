import { closeDatabase, startInstance, whenLeader } from "@/lib/db/workers"
import { startBatches } from "@/lib/generation/run"
import { startPipeline } from "@/lib/pipeline/worker"
import { startSync } from "@/lib/sync/run"

// Node-only half of instrumentation.ts. Every loop returns at once and keeps
// itself going on timers; a builder (`next build`) never starts them. Each
// dev server says it's up and stands for leader; only the leader's loops
// do the work (see db/workers.ts).
export function startBackground() {
  if (process.env.NEXT_PHASE === "phase-production-build") return
  startInstance()
  startPipeline()
  startSync()
  whenLeader(startBatches)
  exitOnStop()
}

/** Longest a stopping server waits for the database to let go. */
const STOP_GRACE_MS = 10_000

// Stopped (Ctrl+C, kill, a restart), the server gives up the lead and closes
// its database connections, then leaves; left open, they kept a stopped
// server running for good, leading the background work with its old code.
// Interrupted uploads and batches pick up where they were on the next leader.
function exitOnStop() {
  const stop = (signal: NodeJS.Signals) => {
    console.log(`${signal}: letting go of the database and stopping`)
    setTimeout(() => process.exit(0), STOP_GRACE_MS).unref()
    closeDatabase().finally(() => process.exit(0))
  }
  process.once("SIGTERM", stop)
  process.once("SIGINT", stop)
}
