import { connection } from "next/server"

import { respond } from "@/lib/etsy/respond"
import { getUsage } from "@/lib/etsy/usage"

// Live process state, so never prerendered. `?refresh` asks Etsy right away,
// for the sidebar's refresh button.
export async function GET(request: Request) {
  await connection()
  const force = new URL(request.url).searchParams.has("refresh")
  return respond(() => getUsage(force))
}
