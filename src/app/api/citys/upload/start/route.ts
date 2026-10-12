import { respond } from "@/lib/mockups/respond"
import { PlanError } from "@/lib/pipeline/errors"
import { startUpload, uploadSettings } from "@/lib/citys/upload"

// Starts the city upload the saved groups plan ({ dryRun: true } writes down what would go out and sends nothing).
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { dryRun?: unknown }
  try {
    return Response.json(await startUpload(await uploadSettings(), { dryRun: body.dryRun === true }))
  } catch (error) {
    if (error instanceof PlanError) return Response.json({ error: error.message }, { status: 400 })
    return respond(() => Promise.reject(error))
  }
}
