import { redirect } from "next/navigation"

import { connectAccount } from "@/lib/accounts/connect"
import { cancelConnect, exchangeCode, pendingAccount } from "@/lib/etsy/oauth"

// Etsy sends the shop owner back here after granting (or refusing) access.
// The code becomes a grant, the grant is checked to open the account's own
// shop, and Settings opens with the outcome.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const state = params.get("state") ?? ""
  const code = params.get("code")
  const account = pendingAccount(state)
  let target: string
  try {
    if (!code) {
      cancelConnect(state)
      throw new Error(
        params.get("error") === "access_denied"
          ? "Access wasn't granted on Etsy"
          : (params.get("error_description") ?? params.get("error") ?? "Etsy sent no code")
      )
    }
    const { account: id, tokens } = await exchangeCode(state, code)
    const linked = await connectAccount(id, tokens)
    target = `/settings?connected=${encodeURIComponent(linked.id)}`
  } catch (error) {
    target = `/settings?${account ? `account=${encodeURIComponent(account)}&` : ""}error=${encodeURIComponent((error as Error).message)}`
  }
  redirect(target)
}
