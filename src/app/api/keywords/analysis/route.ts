import { analyseLibrary } from "@/lib/keywords/analyse"
import { respond } from "@/lib/mockups/respond"

// A fresh AI analysis of the library; answers with the overview including it.
export async function POST() {
  return respond(analyseLibrary)
}
