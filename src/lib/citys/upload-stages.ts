import sharp from "sharp"

import type { Orientation } from "@/lib/catalog/sizes"
import { readDoc, updateDoc } from "@/lib/db/documents"
import { getSet, readSetFile } from "@/lib/generation/storage"
import type { GenerationSet, Output } from "@/lib/generation/types"
import { writeFileUnder } from "@/lib/pipeline/files"
import type { JobItem, PrintFile } from "@/lib/pipeline/types"
import { getStyle } from "@/lib/styles/storage"
import type { Draft } from "@/lib/uploads/types"

import type { PlaceFacts } from "./composition/model"
import { compositionPrintFiles, renderComposition } from "./composition/raster"
import { getComposition } from "./composition/store"
import { writeCityCopy } from "./copy"
import { factsFor } from "./facts"
import { countryName } from "./geo"
import { listInspirations } from "./inspirations"
import { placeKeywords, strategy } from "./keywords"
import { register } from "./places"
import { ourCoverage, type Coverage } from "./ours"
import { skyById } from "./skies"
import { LEVEL_LABEL, type Level, type ReferenceRead } from "./studio-types"

// What the upload pipeline does differently for a city poster (Citys →
// Upload): the poster is the city photo set in the upload group's
// composition (or the photo alone), its print files are the composition
// drawn again at each size's own shape, and its copy comes from the city
// copywriter, kept as an ordinary upload draft (copy already written, so
// the generic copywriter leaves it alone).

const DRAFTS = "uploads/drafts"
/** Width the composed poster is drawn at: enough for the mockups and the listing photos. */
const POSTER_WIDTH = 2400

async function outputOf(item: Pick<JobItem, "groupId" | "outputId">): Promise<{ set: GenerationSet; output: Output; photo: Buffer }> {
  const set = await getSet(item.groupId)
  const output = set.outputs.find((o) => o.id === item.outputId)
  if (!output?.file) throw new Error("The city photo is gone from its set")
  return { set, output, photo: await readSetFile(set.id, output.file) }
}

async function factsOf(placeId: string): Promise<PlaceFacts> {
  const reg = await register()
  const place = reg.places[placeId]
  const name = place?.name ?? placeId
  const found = (await factsFor([{ id: placeId, name, country: place?.country ?? "" }])).get(placeId)
  return (
    found ?? { city: name, country: countryName(place?.country), region: place?.region ?? "", code: "", lat: place?.lat ?? null, lng: place?.lng ?? null, tagline: "", description: "", founded: "", landmark: "" }
  )
}

/** Portrait or landscape, by the composition's own shape; null when it's gone. */
export async function cityOrientation(compositionId: string): Promise<Orientation | null> {
  const composition = await getComposition(compositionId).catch(() => null)
  return composition ? (composition.ratio > 1 ? "hor" : "ver") : null
}

/** The poster: the photo in its composition, or the photo itself; written to `file`, answered as its path. */
export async function composeCityPoster(item: JobItem, file: string) {
  if (!item.city) throw new Error("Not a city poster")
  const { photo } = await outputOf(item)
  if (!item.city.compositionId) {
    await writeFileUnder(file, await sharp(photo).rotate().jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer())
    return file
  }
  const composition = await getComposition(item.city.compositionId).catch(() => {
    throw new Error("The upload group's composition is gone")
  })
  const image = await renderComposition({ data: composition, facts: await factsOf(item.city.placeId), photo, width: POSTER_WIDTH })
  await writeFileUnder(file, await image.jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer())
  return file
}

/** A city poster as it would go up: the photo in the composition (or alone), `width` pixels wide, JPEG. */
export async function previewCityPoster(setId: string, outputId: string, compositionId: string | null, width = 720) {
  const set = await getSet(setId)
  const output = set.outputs.find((o) => o.id === outputId)
  if (!output?.file || !set.city) throw new Error("Unknown city poster")
  const photo = await readSetFile(set.id, output.file)
  if (!compositionId) return sharp(photo).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
  const composition = await getComposition(compositionId)
  const image = await renderComposition({ data: composition, facts: await factsOf(set.city.placeId), photo, width })
  return image.jpeg({ quality: 85 }).toBuffer()
}

/** The composition drawn at every size's own shape, with Gelato's bleed. */
export async function cityPrintFiles(item: JobItem, orientation: Orientation, dir: string): Promise<PrintFile[]> {
  if (!item.city?.compositionId) throw new Error("Not a composed city poster")
  const composition = await getComposition(item.city.compositionId)
  const { photo } = await outputOf(item)
  return compositionPrintFiles({ data: composition, facts: await factsOf(item.city.placeId), photo }, orientation, dir)
}

/** How the poster looks, in words for the copywriter, and its style's own keywords. */
async function lookOf(output: Output, styles: Record<string, string[]>, read?: ReferenceRead) {
  const c = output.city
  if (c?.kind === "style" && c.styleId) {
    const style = await getStyle(c.styleId).catch(() => null)
    return {
      look: style ? `${style.name}: ${style.guide?.summary ?? style.city?.guide?.depiction ?? ""}`.trim() : "a city poster style",
      keywords: styles[c.styleId] ?? [],
    }
  }
  // Made in the reference's own look (a sketch after a sketch): described as that art, never as a photo.
  if (c?.medium === "art") return { look: `an illustration${read?.style ? `: ${read.style}` : ""}`, keywords: [] }
  const looks = c?.look?.length ? (await listInspirations().catch(() => [])).filter((l) => c.look!.includes(l.id)).map((l) => l.name) : []
  const sky = skyById(c?.sky)
  const level = c?.level ? LEVEL_LABEL[c.level as Level]?.label : null
  return {
    look: [
      c?.kind === "idea" || c?.kind === "set" ? "a real photograph, a fresh view" : "a real photograph",
      level && c?.kind === "real" && `(${level.toLowerCase()})`,
      sky && `with a ${sky.name.toLowerCase()} sky`,
      looks.length && `with ${looks.join(" and ")}`,
    ]
      .filter(Boolean)
      .join(" "),
    keywords: [],
  }
}

/** What writing a city poster's copy needs of its job item (a preview passes one without a job). */
type DraftItem = Pick<JobItem, "id" | "groupId" | "outputId" | "chainId" | "city">

/** The city copy for the item's poster, kept as an upload draft; answers the draft's id (an existing one when there is). */
export async function cityDraft(item: DraftItem): Promise<string> {
  if (!item.city) throw new Error("Not a city poster")
  const drafts = await readDoc<Draft[]>(DRAFTS, [])
  const have = drafts.find((d) => d.generationId === item.groupId && d.outputId === item.outputId)
  if (have?.title && have.tags?.length && have.description) return have.id

  const { set, output } = await outputOf(item)
  const reg = await register()
  const place = reg.places[item.city.placeId]
  if (!place) throw new Error("The poster's place isn't in the register")
  const [plan, words, facts, coverage] = await Promise.all([
    strategy(),
    placeKeywords(place.id, 30).catch(() => null),
    factsOf(place.id),
    ourCoverage().catch(() => new Map<string, Coverage>()),
  ])
  const { look, keywords } = await lookOf(output, plan.styles, set.city?.read)
  // Our live listings of the place, and the city drafts made for it already.
  const ours = (coverage.get(place.id)?.listings ?? []).filter((l) => l.status !== "replace" && l.status !== "offline")
  const city = drafts.filter((d) => d.folder === "citys" && d.design.title === place.name && d.title)
  const siblings = [...ours.map((l) => ({ title: l.title, tags: [] as string[] })), ...city.map((d) => ({ title: d.title!, tags: d.tags ?? [] }))]
  const openings = drafts
    .filter((d) => d.folder === "citys" && d.description)
    .slice(0, 8)
    .map((d) => d.description!.split(/\s+/).slice(0, 4).join(" "))

  const copy = await writeCityCopy({
    place,
    shows: [output.title, output.brief].filter(Boolean).join(": ") || `${place.name}${facts.landmark ? `, ${facts.landmark}` : ""}`,
    facts,
    look,
    styleKeywords: keywords,
    siblings,
    words,
    plan,
    openings,
    turn: siblings.length,
  })

  const now = new Date().toISOString()
  const poster = item.city.poster ? `/api/pipeline/items/${item.id}/files/poster.jpg` : `/api/generations/${set.id}/files/${output.file}`
  const draft: Draft = {
    id: have?.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    generationId: set.id,
    outputId: output.id,
    poster,
    posterWidth: output.width,
    posterHeight: output.height,
    folder: "citys",
    chainId: item.chainId,
    source: {
      listingId: set.source?.listingId ?? 0,
      title: set.source?.title ?? place.name,
      tags: set.source?.tags ?? [],
      url: set.source?.url ?? "",
      shop: set.source?.shop ?? null,
    },
    design: { mode: "variant", title: place.name, summary: output.brief },
    title: copy.title,
    tags: copy.tags,
    description: copy.description,
    strategy: copy.strategy,
    strategyWhy: copy.reasoning,
    adoption: 0,
    reasoning: copy.reasoning,
    copy: "done",
    status: "ready",
    createdAt: have?.createdAt ?? now,
    updatedAt: now,
  }
  await updateDoc<Draft[]>(DRAFTS, [], (list) => {
    const rest = (Array.isArray(list) ? list : []).filter((d) => d.id !== draft.id && !(d.generationId === draft.generationId && d.outputId === draft.outputId))
    return [draft, ...rest]
  })
  return draft.id
}

/** The copy a city poster would go up with: written now (and kept for the upload) unless it was already. */
export async function previewCityCopy(setId: string, outputId: string) {
  const set = await getSet(setId)
  if (!set.city) throw new Error("Not a city poster")
  const id = await cityDraft({ id: "", groupId: setId, outputId, chainId: null, city: { placeId: set.city.placeId, compositionId: null } })
  const draft = (await readDoc<Draft[]>(DRAFTS, [])).find((d) => d.id === id)
  return { draftId: id, title: draft?.title ?? "", tags: draft?.tags ?? [], description: draft?.description ?? "", reasoning: draft?.reasoning ?? "" }
}
