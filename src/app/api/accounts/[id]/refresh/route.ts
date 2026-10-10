import { refreshOptions } from "@/lib/accounts/connect"
import { accountView } from "@/lib/accounts/store"
import { respond } from "@/lib/mockups/respond"

// Reads the shop's shipping profiles, return policies, processing times,
// production partners and sections again (about five requests).
export async function POST(_request: Request, { params }: RouteContext<"/api/accounts/[id]/refresh">) {
  const { id } = await params
  return respond(async () => accountView(await refreshOptions(id)))
}
