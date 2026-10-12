import { readDocs, writeDoc } from "@/lib/db/documents"
import { enqueue } from "@/lib/generation/run"
import { newId } from "@/lib/generation/storage"
import { getStyle } from "@/lib/styles/storage"

import { startCityJobs, type CityJob } from "./generate"
import { isSkyId, type SkyId } from "./skies"
import { cleanRequest } from "./templates"
import { EMPTY_REQUEST, FOLLOWS, SET_MAX, SET_MIN, type Follow } from "./studio-types"

// Productions: a style run over a list of places in one go. For every place
// the art director works out what shows it best (London: Big Ben and a red
// bus) and paints a set that hangs together, plus single posters, all in the
// style, from words alone: no reference photo. Freely, or after the place's
// best sellers in other shops (a little, halfway or closely). Kept as
// citys/productions/<id>; its posters land in Citys → Outputs, under the
// style and the production.

const DOC = (id: string) => `citys/productions/${id}`

export type ProductionPlace = { id: string; name: string; country: string }

export type Production = {
  id: string
  name: string
  styleId: string
  places: ProductionPlace[]
  /** Images of the set per place (0 for none, else 3 or more). */
  set: number
  /** Single posters per place, on top. */
  singles: number
  follow: Follow
  sky: SkyId
  delivery: "now" | "batch"
  /** The quick pick it was made from, if any ("Top 100 cities"). */
  preset?: string
  /** The generation sets painting it. */
  sets: string[]
  createdAt: string
}

export type ProductionInput = Omit<Production, "id" | "sets" | "createdAt" | "name"> & { name?: string }

export const MAX_PLACES = 200

export async function listProductions(styleId?: string): Promise<Production[]> {
  const docs = await readDocs<Production>("citys/productions/")
  return [...docs.values()].filter((p) => !styleId || p.styleId === styleId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Checks a production as it comes over the wire. */
export function cleanProduction(value: unknown): ProductionInput {
  const v = (value ?? {}) as Partial<ProductionInput>
  const count = (n: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(n) || 0)))
  const set = count(v.set, SET_MAX)
  const seen = new Set<string>()
  const places = (Array.isArray(v.places) ? v.places : [])
    .filter((p): p is ProductionPlace => !!p && typeof p.id === "string" && typeof p.name === "string" && !seen.has(p.id) && !!seen.add(p.id))
    .slice(0, MAX_PLACES)
    .map((p) => ({ id: p.id, name: p.name.slice(0, 120), country: typeof p.country === "string" ? p.country.slice(0, 8) : "" }))
  return {
    ...(typeof v.name === "string" && v.name.trim() && { name: v.name.trim().slice(0, 80) }),
    styleId: typeof v.styleId === "string" ? v.styleId : "",
    places,
    set: set && set < SET_MIN ? SET_MIN : set,
    singles: count(v.singles, 6),
    follow: FOLLOWS.includes(v.follow as Follow) ? (v.follow as Follow) : "free",
    sky: isSkyId(v.sky) ? v.sky : "auto",
    delivery: v.delivery === "now" ? "now" : "batch",
    ...(typeof v.preset === "string" && v.preset && { preset: v.preset.slice(0, 60) }),
  }
}

/** Starts a production: one batch per place on its place-only set. */
export async function startProduction(input: ProductionInput): Promise<Production> {
  if (!input.places.length) throw new Error("Pick at least one place")
  if (!input.set && !input.singles) throw new Error("Ask for a set or single posters")
  const style = await getStyle(input.styleId)
  const id = newId()
  const name =
    input.name ??
    `${input.preset ?? `${input.places.length} ${input.places.length === 1 ? "place" : "places"}`} · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
  const request = cleanRequest({
    ...EMPTY_REQUEST,
    delivery: input.delivery,
    production: id,
    styles: [{ styleId: style.id, modes: ["city"], count: input.singles, ...(input.set && { set: input.set }), follow: input.follow, ...(input.sky !== "auto" && { sky: input.sky }) }],
  })
  const production: Production = { ...input, id, name, sets: [], createdAt: new Date().toISOString() }
  await writeDoc(DOC(id), production)
  const jobs: CityJob[] = input.places.map((p) => ({ placeId: p.id, place: p.name, country: p.country, request }))
  const sets = await startCityJobs(jobs, enqueue)
  const done = { ...production, sets }
  await writeDoc(DOC(id), done)
  return done
}
