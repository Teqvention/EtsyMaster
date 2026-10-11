import { respond } from "@/lib/etsy/respond"
import { isPreset, isPresetOp } from "@/lib/generation/preset-ops"
import { changePresets, getPresets, importPresets } from "@/lib/generation/preset-store"

// The Generate dialog's presets, kept in the database.
export async function GET() {
  return respond(getPresets)
}

// Apply changes (JSON `{ ops: PresetOp[] }`); answers with every preset.
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as { ops?: unknown } | null
  if (!Array.isArray(body?.ops) || !body.ops.every(isPresetOp)) {
    return Response.json({ error: "Changes to the presets are required" }, { status: 400 })
  }
  return respond(() => changePresets(body.ops as Parameters<typeof changePresets>[0]))
}

// Fold an older browser's presets in (JSON array); answers with every preset.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null)
  if (!Array.isArray(body) || !body.every(isPreset)) {
    return Response.json({ error: "Presets are required" }, { status: 400 })
  }
  return respond(() => importPresets(body))
}
