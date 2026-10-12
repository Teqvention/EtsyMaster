import { connection } from "next/server"

import { ourCoverage } from "@/lib/citys/ours"
import { ranking } from "@/lib/citys/ranking"
import type { OursCell } from "@/lib/citys/types"
import { respond } from "@/lib/mockups/respond"

// The ranking of places by demand, for the shops in the saved scope, with
// what our city shops have of each place.
export async function GET() {
  await connection()
  return respond(async () => {
    const [ranked, coverage] = await Promise.all([ranking(), ourCoverage().catch(() => new Map())])
    const ours: Record<string, OursCell> = {}
    for (const [placeId, c] of coverage) ours[placeId] = { confirmed: c.confirmed, replace: c.replace, open: c.open }
    return { ...ranked, ours }
  })
}
