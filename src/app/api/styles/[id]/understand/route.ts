import { respond } from "@/lib/mockups/respond"
import { startReading } from "@/lib/styles/understand"

type Context = RouteContext<"/api/styles/[id]/understand">

// Reads the moodboard again now (replacing a guide edited by hand). Answers
// at once with the style marked as reading; poll it to see the guide land.
export async function POST(_request: Request, { params }: Context) {
  const { id } = await params
  return respond(() => startReading(id))
}
