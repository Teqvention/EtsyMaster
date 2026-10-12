import { citySettings, patchSettings, type SettingsPatch } from "@/lib/citys/settings"
import { respond } from "@/lib/mockups/respond"

// How the city pages are set up: the ranking's scope, our city shops, the
// shape city photos are made in.
export async function GET() {
  return respond(citySettings)
}

export async function PATCH(request: Request) {
  const patch = (await request.json().catch(() => null)) as SettingsPatch | null
  if (!patch || typeof patch !== "object") return Response.json({ error: "Nothing to change" }, { status: 400 })
  return respond(() => patchSettings(patch))
}
