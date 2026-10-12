import { cleanProduction, listProductions, startProduction } from "@/lib/citys/produce"
import { respond } from "@/lib/mockups/respond"

// Productions: a style run over a list of places (GET ?style=<id> lists them, POST starts one).
export async function GET(request: Request) {
  const style = new URL(request.url).searchParams.get("style") ?? undefined
  return respond(() => listProductions(style))
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  return respond(() => startProduction(cleanProduction(body)))
}
