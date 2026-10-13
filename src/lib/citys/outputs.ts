import { enqueue } from "@/lib/generation/run"
import { getSet, listSets, newId, updateSet } from "@/lib/generation/storage"
import type { Batch, GenerationSet, Output } from "@/lib/generation/types"
import { NotFoundError } from "@/lib/mockups/storage"
import { listStyles } from "@/lib/styles/storage"

import { isCitySet } from "./generate"
import { listInspirations } from "./inspirations"
import { ranking } from "./ranking"
import { listProductions } from "./produce"
import { listCustomSkies } from "./sky-store"
import { LOOK_SKY, skyById, type SkyId } from "./skies"
import { EMPTY_REQUEST, LEVEL_LABEL, type CityOutputInfo, type CityRequest, type Level } from "./studio-types"
import type { Tier } from "./types"

// Citys → Outputs: every city poster made, from the city sets (lab rounds
// aside), with what it is (real photo by level, a look, a new view, a style
// and how it used the photo), the place and its tier, and the reference it
// came from; reviewed here like Generation's outputs (approved ones go to
// the city uploads), made again with notes.

export type CityOutput = {
  setId: string
  outputId: string
  status: Output["status"]
  error?: string
  file: string | null
  url: string | null
  thumb: string | null
  width?: number
  height?: number
  review: Output["review"]
  /** Which group it shows in: "real", "real:<sky>", "art", "idea", "set", "style:<id>", "production:<id>". */
  group: string
  /** The group in words: "Real photo", "Real · Sunset glow", "Cartoon Bold". */
  groupLabel: string
  /** What this one is, in a few words: "Level 3 · New light", "From photo". */
  detail: string
  kind: CityOutputInfo["kind"]
  styleId?: string
  production?: string
  sky?: SkyId
  medium?: "photo" | "art"
  /** One of a set: its place in it and its motif. */
  set?: { index: number; size: number; motif?: string }
  title?: string
  brief?: string
  placeId: string
  place: string
  country: string
  tier: Tier | null
  /** The listing it came from (0 for one of our own posters recreated), its shop and the poster taken out of it. */
  reference: { listingId: number; shop: string | null; url: string; image: string | null } | null
  /** What one click asked for together (Outputs' "By action"), and when. */
  action: string
  actionAt: string
  createdAt: string
}

const url = (setId: string, file: string, width?: number) => `/api/generations/${setId}/files/${file}${width ? `?w=${width}` : ""}`

export async function cityOutputs(): Promise<CityOutput[]> {
  const [sets, styles, looks, ranked, productions] = await Promise.all([
    listSets(),
    listStyles().catch(() => []),
    listInspirations().catch(() => []),
    ranking().catch(() => null),
    listProductions().catch(() => []),
  ])
  const productionName = new Map(productions.map((p) => [p.id, p.name]))
  // The shop's own skies, so their names show.
  await listCustomSkies().catch(() => [])
  const styleName = new Map(styles.map((s) => [s.id, s.name]))
  const lookName = new Map(looks.map((l) => [l.id, l.name]))
  const tierOf = new Map((ranked?.places ?? []).map((p) => [p.id, p.tier]))
  const out: CityOutput[] = []
  for (const set of sets) {
    if (!isCitySet(set) || set.city.lab) continue
    const refPoster = set.posters.find((p) => p.file)
    const batches = new Map(set.batches.map((b) => [b.id, b]))
    const ours = !!set.city.fromOutput
    for (const o of set.outputs) {
      if (!o.city || o.city.kind === "lab") continue
      const c = o.city
      const batch = batches.get(o.batch)
      const at = batch?.createdAt ?? o.createdAt
      const { group, groupLabel, detail } = describe(c, { styleName, lookName, productionName })
      out.push({
        setId: set.id,
        outputId: o.id,
        status: o.status,
        ...(o.error && { error: o.error }),
        file: o.file,
        url: o.file ? url(set.id, o.file) : null,
        thumb: o.file ? url(set.id, o.file, 480) : null,
        width: o.width,
        height: o.height,
        review: o.review,
        group,
        groupLabel,
        detail,
        kind: c.kind,
        ...(c.styleId && { styleId: c.styleId }),
        ...(c.production && { production: c.production }),
        ...(c.sky && { sky: c.sky }),
        ...(c.medium && { medium: c.medium }),
        ...(c.set && { set: c.set }),
        title: o.title,
        brief: o.brief,
        placeId: set.city.placeId,
        place: set.city.place,
        country: set.city.country,
        tier: tierOf.get(set.city.placeId) ?? null,
        reference:
          set.source.listingId || ours
            ? { listingId: set.source.listingId, shop: set.source.shop, url: set.source.url, image: refPoster?.file ? url(set.id, refPoster.file, 960) : null }
            : null,
        // Batches from before actions: the ones asked for in the same minute go together.
        action: batch?.city?.action ?? `at-${at.slice(0, 16)}`,
        actionAt: at,
        createdAt: o.createdAt,
      })
    }
  }
  // Newest first; a set's pictures (made together) in their order, place by place.
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.place.localeCompare(b.place) || (a.set?.index ?? 0) - (b.set?.index ?? 0))
}

type Names = { styleName: Map<string, string>; lookName: Map<string, string>; productionName: Map<string, string> }

/** Its group (and the group in words) and what it is in a few words. */
function describe(c: CityOutputInfo, { styleName, lookName, productionName }: Names) {
  const sky = skyById(c.sky)
  if (c.kind === "style") {
    const name = styleName.get(c.styleId ?? "") ?? "Style"
    const detail = c.set
      ? `Set ${c.set.index + 1}/${c.set.size}${c.set.motif ? ` · ${c.set.motif}` : ""}`
      : c.refMode === "photo"
        ? "From photo"
        : c.refMode === "composition"
          ? "From composition"
          : "City only"
    return c.production
      ? { group: `production:${c.production}`, groupLabel: `${name} · ${productionName.get(c.production) ?? "Production"}`, detail }
      : { group: `style:${c.styleId}`, groupLabel: name, detail }
  }
  const art = c.medium === "art"
  if (c.kind === "idea") return { group: art ? "idea:art" : "idea", groupLabel: art ? "New ideas · reference style" : "New ideas", detail: sky ? `New idea · ${sky.name}` : "New idea" }
  if (c.kind === "set") {
    return {
      group: art ? "set:art" : "set",
      groupLabel: art ? "Sets · reference style" : "Sets",
      detail: `Set ${(c.set?.index ?? 0) + 1}/${c.set?.size ?? 3}${c.set?.motif ? ` · ${c.set.motif}` : ""}`,
    }
  }
  const look = (c.look ?? []).map((id) => lookName.get(id) ?? id)
  const level = `Level ${c.level ?? 2} · ${LEVEL_LABEL[(c.level ?? 2) as Level].label}`
  const detail = [level, c.auto && "auto", sky && c.auto ? sky.name : null].filter(Boolean).join(" · ")
  if (art) return { group: sky && !c.auto ? `art:${c.sky}` : "art", groupLabel: sky && !c.auto ? `Reference style · ${sky.name}` : "Reference style", detail }
  if (c.auto) return { group: "real:auto", groupLabel: "Real · autonomous", detail }
  if (sky) return { group: `real:${c.sky}`, groupLabel: `Real · ${sky.name}`, detail }
  if (look.length) return { group: `real:${(c.look ?? []).join(",")}`, groupLabel: `Real · ${look.join(" + ")}`, detail }
  return { group: "real", groupLabel: "Real photo", detail }
}

/** Approves, rejects or un-reviews outputs (`review` null). */
export async function reviewOutputs(items: { setId: string; outputId: string }[], review: Output["review"]) {
  const bySet = new Map<string, Set<string>>()
  for (const { setId, outputId } of items) bySet.set(setId, (bySet.get(setId) ?? new Set()).add(outputId))
  const at = new Date().toISOString()
  for (const [setId, ids] of bySet) {
    await updateSet(setId, (s) => ({
      ...s,
      outputs: s.outputs.map((o) => (ids.has(o.id) && o.status === "done" ? { ...o, review, reviewedAt: at } : o)),
    })).catch((error) => {
      if (!(error instanceof NotFoundError)) throw error
    })
  }
}

/** One more like an output (same kind, level, look, style and use of the photo), with notes on what to change. */
export async function redoOutput(setId: string, outputId: string, notes: string, count = 1) {
  const set = await getSet(setId)
  const o = set.outputs.find((x) => x.id === outputId)
  if (!o?.city) throw new NotFoundError("Unknown output")
  const c = o.city
  const request: CityRequest = {
    ...EMPTY_REQUEST,
    delivery: "now",
    realPhoto: !!c.realPhoto,
    notes: [o.feedback, notes].filter(Boolean).join(" · ") || undefined,
    ...(c.production && { production: c.production }),
  }
  const sky = c.sky ?? (c.look ?? []).map((id) => LOOK_SKY[id]).find(Boolean) ?? "auto"
  if (c.kind === "real") request.rows = [{ levels: { [c.level ?? 2]: count }, sky }]
  else if (c.kind === "idea" || c.kind === "set") {
    request.rows = [{ levels: {}, sky }]
    request.ideas = count
  } else if (c.kind === "style" && c.styleId) {
    request.styles = [{ styleId: c.styleId, modes: [c.refMode ?? "city"], count, ...(c.follow && { follow: c.follow }), ...(c.sky && { sky: c.sky }) }]
  }
  return addCityBatch(set, request)
}

async function addCityBatch(set: GenerationSet, request: CityRequest) {
  const batch: Batch = {
    id: newId(),
    options: { variants: { count: 0, creativity: ["medium"], styleId: null }, ideas: { count: 0, creativity: ["medium"] } },
    createdAt: new Date().toISOString(),
    expanded: false,
    city: { ...request, action: newId() },
  }
  const next = await updateSet(set.id, (s) => ({ ...s, status: "queued", stopping: undefined, doneAt: undefined, batches: [...s.batches, batch], heals: 0 }))
  enqueue(set.id)
  return next
}
