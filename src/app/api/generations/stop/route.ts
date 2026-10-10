import { stopWaiting } from "@/lib/generation/run"
import { respond } from "@/lib/mockups/respond"

// Stop every set that hasn't sent its images off yet; batch jobs already
// submitted carry on. Answers `{ stopped }`.
export async function POST() {
  return respond(stopWaiting)
}
