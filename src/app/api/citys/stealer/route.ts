import { stealerState } from "@/lib/citys/stealer"
import { respond } from "@/lib/mockups/respond"

// Every place in priority order for the City Stealer, with its reference
// count and how much of it we have; and the shops it takes references from.
export async function GET() {
  return respond(stealerState)
}
