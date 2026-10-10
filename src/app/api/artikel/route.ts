import { connection } from "next/server"

import { artikelState, parseRange } from "@/lib/artikel/metrics"
import { respond } from "@/lib/artikel/respond"

// Every listing of our shops (or one shop's: `account`) with its numbers from
// `from` to `to` (YYYY-MM-DD, the last 30 days by default), worked out from
// the synced data. Changes with every sync, so never prerendered.
export async function GET(request: Request) {
  await connection()
  const query = new URL(request.url).searchParams
  return respond(() => artikelState(query.get("account") || null, parseRange(query.get("from"), query.get("to"))))
}
