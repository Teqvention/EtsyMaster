import { redirect } from "next/navigation"

import { connectUrl, publicOrigin } from "@/lib/etsy/oauth"

// Sends the browser to Etsy to grant this account's app access to its shop.
// Etsy comes back to /api/accounts/oauth/callback; a sign-in that can't start
// goes back to Settings with why.
export async function GET(request: Request, { params }: RouteContext<"/api/accounts/[id]/connect">) {
  const { id } = await params
  let url: string
  try {
    url = await connectUrl(id, publicOrigin(request))
  } catch (error) {
    url = `/settings?account=${encodeURIComponent(id)}&error=${encodeURIComponent((error as Error).message)}`
  }
  redirect(url)
}
