import { connection } from "next/server"

import { usageState } from "@/lib/accounts/usage"
import { respond } from "@/lib/etsy/respond"

// Live process state, so never prerendered. `?refresh` asks Etsy right away
// (one request per account), for the sidebar's refresh button.
export async function GET(request: Request) {
  await connection()
  const refresh = new URL(request.url).searchParams.has("refresh")
  return respond(() => usageState(refresh))
}
