import { fillStubs } from "@/lib/citys/places"
import { respond } from "@/lib/mockups/respond"

// Fills in the places known only by name (made up as another place's parent): kind, size, setting, tags.
export async function POST() {
  return respond(async () => ({ filled: await fillStubs() }))
}
