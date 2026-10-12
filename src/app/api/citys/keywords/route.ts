import { heldResearch, research, strategy } from "@/lib/citys/keywords"
import { respond } from "@/lib/mockups/respond"

// The city keyword system: the research over the city shops' tags and
// titles (made the first time it's asked for) and the strategy built on it.
export async function GET() {
  return respond(async () => {
    const [found, plan] = await Promise.all([heldResearch(), strategy()])
    return { research: found ?? (await research()), strategy: plan }
  })
}
