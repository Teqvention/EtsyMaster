import { research } from "@/lib/citys/keywords"
import { respond } from "@/lib/mockups/respond"

// Looks at the city shops' tags and titles again (after new shops or reads).
export async function POST() {
  return respond(research)
}
