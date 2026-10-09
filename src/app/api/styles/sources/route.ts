import { respond } from "@/lib/mockups/respond"
import { listSources } from "@/lib/styles/storage"

// Posters from the Generation page a moodboard can be filled from, newest set first.
export async function GET() {
  return respond(listSources)
}
