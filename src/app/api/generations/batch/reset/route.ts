import { resetFails } from "@/lib/generation/run"
import { respond } from "@/lib/mockups/respond"

// Reset fails (JSON `{ dryRun?: boolean, ids?: string[] }`): every failed
// image goes, and every set left with nothing in it; finished batch jobs are
// put away. Images still painting carry on. Answers `{ images, sets }`, what
// went (or, with dryRun, would).
export async function POST(request: Request) {
  const { dryRun, ids } = (await request.json().catch(() => ({}))) as { dryRun?: unknown; ids?: unknown }
  if (ids !== undefined && !(Array.isArray(ids) && ids.every((id) => typeof id === "string"))) {
    return Response.json({ error: "ids must be a list of set ids" }, { status: 400 })
  }
  return respond(() => resetFails({ dryRun: dryRun === true, ids: ids as string[] | undefined }))
}
