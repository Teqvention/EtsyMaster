import { sendAllOpen } from "@/lib/generation/run"
import { respond } from "@/lib/mockups/respond"

// Everything open in one batch job: running jobs end early (what they painted
// comes in, the rest goes out again) and every failed image is retried in
// batch. Answers `{ jobs, retried }`.
export async function POST() {
  return respond(sendAllOpen)
}
