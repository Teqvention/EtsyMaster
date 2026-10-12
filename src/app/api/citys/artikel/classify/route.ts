import { classifyJob, startClassify } from "@/lib/citys/artikel"
import { respond } from "@/lib/mockups/respond"

// Classifying our city shops' listings (confirmed, replace, offline): how
// far the run is, and start one (POST { look?: false } skips Gemini's look
// at the pictures of the old ones that perform).
export async function GET() {
  return respond(classifyJob)
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { look?: unknown }
  return respond(() => startClassify({ look: body.look !== false }))
}
