// The Generate dialog's presets (settings saved under a name, run in one
// click), in the document "generation/presets". Changed one step at a time,
// by the browser and the server alike (see `synced-store.ts`). The settings
// themselves are the dialog's business; here a preset is anything with an id
// and a name.

export type StoredPreset = { id: string; name: string } & Record<string, unknown>

export type PresetOp<P extends StoredPreset = StoredPreset> = { type: "add"; preset: P } | { type: "remove"; id: string }

export function applyPresetOps<P extends StoredPreset>(presets: P[], ops: PresetOp<P>[]): P[] {
  let next = presets
  for (const op of ops) {
    next = op.type === "add" ? [...next.filter((p) => p.id !== op.preset.id), op.preset] : next.filter((p) => p.id !== op.id)
  }
  return next
}

/** An older browser's presets folded in: the ones not there yet are added. */
export function mergePresets(base: StoredPreset[], copy: StoredPreset[]) {
  const ids = new Set(base.map((p) => p.id))
  return [...base, ...copy.filter((p) => !ids.has(p.id))]
}

export const isPreset = (p: unknown): p is StoredPreset =>
  !!p && typeof (p as StoredPreset).id === "string" && typeof (p as StoredPreset).name === "string"

export function isPresetOp(value: unknown): value is PresetOp {
  const op = value as PresetOp
  return (op?.type === "add" && isPreset(op.preset)) || (op?.type === "remove" && typeof op.id === "string")
}
