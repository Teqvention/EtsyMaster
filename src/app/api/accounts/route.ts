import { verifyKey } from "@/lib/accounts/connect"
import { addAccount, accountView, accountViews, listAccounts } from "@/lib/accounts/store"
import type { AccountRole } from "@/lib/accounts/types"
import { callbackPath, publicOrigin } from "@/lib/etsy/oauth"
import { respond } from "@/lib/mockups/respond"

// Every account as Settings shows it (no keys, no tokens), plus the callback
// address each Etsy app must list for the sign-in to come back here.
export async function GET(request: Request) {
  return respond(async () => ({ accounts: await accountViews(), callbackUrl: publicOrigin(request) + callbackPath }))
}

// A new account: JSON { id?, label, role, keystring, secret }. The key is
// checked with Etsy first (one request), which also tells its app id.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const label = typeof body?.label === "string" ? body.label.trim() : ""
  const keystring = typeof body?.keystring === "string" ? body.keystring.trim() : ""
  const secret = typeof body?.secret === "string" ? body.secret.trim() : ""
  const role: AccountRole = body?.role === "analysis" ? "analysis" : "upload"
  if (!label || !keystring || !secret) {
    return Response.json({ error: "Name, keystring and shared secret are needed" }, { status: 400 })
  }
  return respond(async () => {
    const taken = new Set((await listAccounts()).map((a) => a.id))
    const id = freeId(
      (typeof body?.id === "string" && /^[a-z0-9-]{2,24}$/.test(body.id) ? body.id : null) ??
        (label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "account"),
      taken
    )
    const appId = await verifyKey(id, keystring, secret)
    return accountView(await addAccount({ id, label, role, appId }, { keystring, secret }))
  })
}

/** `base`, or `base-2`, `base-3`… when it's taken. */
function freeId(base: string, taken: Set<string>) {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const id = `${base.slice(0, 21)}-${n}`
    if (!taken.has(id)) return id
  }
}
