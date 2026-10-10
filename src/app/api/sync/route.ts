import { connection } from "next/server"

import { respond } from "@/lib/etsy/respond"
import { syncAccount, syncAll } from "@/lib/sync/run"
import { syncStatus } from "@/lib/sync/store"

// The sync of our shops' numbers: when each account last synced, and what's
// running. Live process state, so never prerendered.
export async function GET() {
  await connection()
  return respond(syncStatus)
}

// Starts a sync now (JSON `{ account? }`, every account when absent) and
// answers at once with the state, the account marked running.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { account?: unknown }
  const account = typeof body.account === "string" ? body.account : null
  if (account) {
    const status = (await syncStatus()).find((s) => s.account === account)
    if (!status) return Response.json({ error: "No shop is linked to that account" }, { status: 404 })
    if (status.blocked) return Response.json({ error: status.blocked }, { status: 409 })
  }
  return respond(async () => {
    if (account) void syncAccount(account)
    else void syncAll()
    // syncAll looks at the accounts first; a moment for it to mark them running.
    await new Promise((r) => setTimeout(r, 50))
    return syncStatus()
  })
}
