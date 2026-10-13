import { readDoc, updateDoc } from "@/lib/db/documents"

import { isSkyId } from "./skies"
import {
  DEFAULT_REQUEST,
  FOLLOWS,
  LEVELS,
  normalizeRequest,
  REF_MODES,
  SET_MAX,
  SET_MIN,
  type CityRequest,
  type CityTemplate,
  type CreativityRow,
  type Follow,
} from "./studio-types"

// Saved requests for the City Stealer, applied in one click: the document
// citys/templates. The first time it's read it holds a few to start with.

const FILE = "citys/templates"

const STARTERS: Omit<CityTemplate, "createdAt">[] = [
  { id: "real-123", name: "Faithful to new light", request: DEFAULT_REQUEST },
  { id: "auto-2", name: "Autonomous · 2 per photo", request: { ...DEFAULT_REQUEST, auto: { on: true, count: 2 } } },
  { id: "blush-12", name: "1 + 2 in blush pink", request: { ...DEFAULT_REQUEST, rows: [{ levels: { 1: 1, 2: 1 }, sky: "blush" }] } },
  { id: "set-6", name: "Set of 6 + 2 variants", request: { ...DEFAULT_REQUEST, rows: [{ levels: { 1: 1, 2: 1 }, sky: "auto" }], set: { on: true, count: 6 } } },
  { id: "ideas-3", name: "2 variants + 3 new ideas", request: { ...DEFAULT_REQUEST, rows: [{ levels: { 1: 1, 3: 1 }, sky: "auto" }], ideas: 3 } },
]

export async function listTemplates(): Promise<CityTemplate[]> {
  const held = await readDoc<CityTemplate[] | null>(FILE, null)
  const now = new Date().toISOString()
  return (held ?? STARTERS.map((t) => ({ ...t, createdAt: now }))).map((t) => ({ ...t, request: cleanRequest(t.request) }))
}

/** A request as it comes over the wire (or as saved before skies), made safe: counts clamped, unknown parts dropped. */
export function cleanRequest(value: unknown): CityRequest {
  const v = normalizeRequest(value)
  const count = (n: unknown, max = 6, min = 0) => Math.max(min, Math.min(max, Math.round(Number(n) || 0)))
  const rows = v.rows.map((row) => {
    const levels: CreativityRow["levels"] = {}
    for (const level of LEVELS) {
      const n = count(row.levels[level])
      if (n) levels[level] = n
    }
    return { levels, sky: row.sky }
  })
  return {
    rows: rows.length ? rows : [{ levels: {}, sky: "auto" }],
    auto: { on: v.auto.on === true, count: count(v.auto.count, 3, 1) },
    ideas: count(v.ideas),
    set: { on: v.set.on === true, count: count(v.set.count, SET_MAX, SET_MIN) },
    realPhoto: v.realPhoto,
    styles: v.styles
      .map((s) => ({
        styleId: typeof s?.styleId === "string" ? s.styleId : "",
        modes: (Array.isArray(s?.modes) ? s.modes : []).filter((m: unknown) => REF_MODES.some((r) => r.value === m)),
        count: count(s?.count, 6),
        ...(count(s?.set, SET_MAX) >= SET_MIN && { set: count(s?.set, SET_MAX) }),
        ...(FOLLOWS.includes(s?.follow as Follow) && { follow: s.follow }),
        ...(isSkyId(s?.sky) && s.sky !== "auto" && { sky: s.sky }),
      }))
      .filter((s) => s.styleId && (s.count || s.set)),
    ...(typeof v.notes === "string" && v.notes.trim() && { notes: v.notes.trim().slice(0, 600) }),
    delivery: v.delivery,
    ...(typeof v.production === "string" && /^[a-z0-9-]{1,40}$/.test(v.production) && { production: v.production }),
    ...(typeof v.action === "string" && /^[a-z0-9-]{1,40}$/.test(v.action) && { action: v.action }),
    ...(Number.isInteger(v.print) && v.print! >= 0 && v.print! < 12 && { print: v.print }),
  }
}

export async function saveTemplates(list: unknown) {
  const clean: CityTemplate[] = (Array.isArray(list) ? list : [])
    .filter((t) => t && typeof t.id === "string" && typeof t.name === "string" && t.name.trim())
    .slice(0, 40)
    .map((t) => ({ id: t.id, name: t.name.trim().slice(0, 60), request: cleanRequest(t.request), createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date().toISOString() }))
  await updateDoc<CityTemplate[] | null>(FILE, null, () => clean)
  return clean
}
