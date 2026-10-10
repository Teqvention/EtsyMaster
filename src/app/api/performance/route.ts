import type { NextRequest } from "next/server"

import { respond } from "@/lib/mockups/respond"
import { performanceReport } from "@/lib/performance/report"
import { GRAINS, RANGES, type Grain, type RangeKey } from "@/lib/performance/types"

// The Performance page's report: ?account=<id>|all&range=week|month|30d|90d|year|all
// &offset=0|-1|…&by=day|week|month (by defaults to what suits the range).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const range = params.get("range") as RangeKey | null
  const by = params.get("by") as Grain | null
  return respond(() =>
    performanceReport({
      account: params.get("account") || "all",
      range: range && RANGES.includes(range) ? range : "month",
      offset: Number(params.get("offset")) || 0,
      by: by && GRAINS.includes(by) ? by : undefined,
    })
  )
}
