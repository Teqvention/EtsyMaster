import { connection } from "next/server"

import { respond } from "@/lib/mockups/respond"
import { cityUploadState, saveUploadSettings, type CityUploadSettings } from "@/lib/citys/upload"

// Citys → Upload: the groups and options (PATCH to change them), the shops
// and what they still need, the compositions and styles to pick from, and
// the city uploads under way.
export async function GET() {
  await connection()
  return respond(cityUploadState)
}

export async function PATCH(request: Request) {
  const patch = (await request.json().catch(() => null)) as Partial<CityUploadSettings> | null
  if (!patch || typeof patch !== "object") return Response.json({ error: "Nothing to change" }, { status: 400 })
  return respond(() => saveUploadSettings(patch))
}
