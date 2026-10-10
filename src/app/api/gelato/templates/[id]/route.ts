import { checkTemplate } from "@/lib/gelato/template"
import { respond } from "@/lib/mockups/respond"

// Checks a Gelato template for a store: ?store=<storeId>. Answers with which
// of the offered sizes it covers, its image placeholder and what's wrong.
export async function GET(request: Request, { params }: RouteContext<"/api/gelato/templates/[id]">) {
  const { id } = await params
  const store = new URL(request.url).searchParams.get("store")
  if (!store) return Response.json({ error: "Which store?" }, { status: 400 })
  return respond(() => checkTemplate(store, id))
}
