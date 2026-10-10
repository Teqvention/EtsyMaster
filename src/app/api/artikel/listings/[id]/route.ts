import { connection } from "next/server"

import { artikelDetail, parseRange } from "@/lib/artikel/metrics"
import { respond } from "@/lib/artikel/respond"

// One listing over `from`–`to`: day by day, its orders and its fees.
export async function GET(request: Request, { params }: RouteContext<"/api/artikel/listings/[id]">) {
  await connection()
  const { id } = await params
  const query = new URL(request.url).searchParams
  return respond(() => artikelDetail(Number(id), parseRange(query.get("from"), query.get("to"))))
}
