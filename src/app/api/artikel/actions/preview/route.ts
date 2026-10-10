import { checkParams, checkTarget, previewAction } from "@/lib/artikel/actions"
import { respond } from "@/lib/artikel/respond"

// What an action would change, listing by listing, from the synced data: asks Etsy nothing.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { params?: unknown; target?: unknown } | null
  return respond(() => previewAction(checkParams(body?.params), checkTarget(body?.target)))
}
