import { connection } from "next/server"

import { nameKey } from "@/lib/citys/geo"
import { ranking } from "@/lib/citys/ranking"
import { respond } from "@/lib/mockups/respond"

// Places to look up keywords for: the ranking's places whose name matches
// `q`, best ranked first (the top ones when `q` is empty).
export async function GET(request: Request) {
  await connection()
  const q = nameKey(new URL(request.url).searchParams.get("q") ?? "")
  return respond(async () => {
    const places = (await ranking()).places
    const found = q ? places.filter((p) => nameKey(p.name).includes(q)) : places
    return found.slice(0, 10).map((p) => ({ id: p.id, name: p.name, countryName: p.countryName, region: p.region, tier: p.tier, kind: p.kind }))
  })
}
