import { cancelJobs } from "@/lib/generation/run"
import { respond } from "@/lib/mockups/respond"

// Ends batch jobs for good (JSON `{ names?: string[] }`, every running job
// when none are named): what's painted comes in, the rest fails as cancelled
// and can be retried. Answers `{ jobs }`.
export async function POST(request: Request) {
  const { names } = (await request.json().catch(() => ({}))) as { names?: unknown }
  if (names !== undefined && !(Array.isArray(names) && names.every((n) => typeof n === "string"))) {
    return Response.json({ error: "names must be a list of job names" }, { status: 400 })
  }
  return respond(async () => ({ jobs: await cancelJobs(names as string[] | undefined) }))
}
