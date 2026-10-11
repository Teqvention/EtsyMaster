import { readDoc, updateDoc } from "@/lib/db/documents"

import { applyPresetOps, mergePresets, type PresetOp, type StoredPreset } from "./preset-ops"

const FILE = "generation/presets"

export const getPresets = () => readDoc<StoredPreset[]>(FILE, [])

export const changePresets = (ops: PresetOp[]) =>
  updateDoc<StoredPreset[]>(FILE, [], (presets) => applyPresetOps(presets, ops))

export const importPresets = (copy: StoredPreset[]) =>
  updateDoc<StoredPreset[]>(FILE, [], (presets) => mergePresets(presets, copy))
