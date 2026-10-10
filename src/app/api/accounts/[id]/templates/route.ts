import { accountView } from "@/lib/accounts/store"
import { checkAccountTemplates } from "@/lib/accounts/templates"
import { respond } from "@/lib/mockups/respond"

// Checks the account's Gelato templates with Gelato again (one request each)
// and answers with the account.
export async function POST(_request: Request, { params }: RouteContext<"/api/accounts/[id]/templates">) {
  const { id } = await params
  return respond(async () => accountView(await checkAccountTemplates(id)))
}
