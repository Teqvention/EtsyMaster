import { batchHealth, sendAllOpen } from "@/lib/generation/run"
import { respond } from "@/lib/mockups/respond"

// How batch work stands on this server: polling, the watchdog, what it put right.
export async function GET() {
  return respond(async () => batchHealth())
}

// Everything open in one batch job: running jobs end early (what they painted
// comes in, the rest goes out again) and every failed image is retried in
// batch. Answers `{ jobs, retried }`.
export async function POST() {
  return respond(sendAllOpen)
}
