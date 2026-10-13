import sharp from "sharp"

import { createSet, getSet, listSets, newId, readSetFile, saveFile, updateSet } from "@/lib/generation/storage"
import type { Batch, Creativity, ExtractedPoster, GenerateOptions, GenerationSet, Output } from "@/lib/generation/types"
import { extractPosters } from "@/lib/generation/poster"
import { fetchReference } from "@/lib/mockups/reference"
import { NotFoundError } from "@/lib/mockups/storage"
import { fileKey as styleFileKey, getStyle, pick } from "@/lib/styles/storage"
import type { StyleGuide } from "@/lib/styles/types"
import { getFile } from "@/lib/storage/files"

import { isCalmPlace, placeBrief, placeByName, placeLine, placePictures, type PlacePicture } from "./briefs"
import { listCustomSkies, skyPhoto } from "./sky-store"
import { photoUrl } from "./photos"
import { paintCityPrompt, planCityBriefs, readReference, type BriefGroup } from "./prompts"
import { ranking } from "./ranking"
import { pictureOf, readRefFile, refCrop } from "./refs"
import { citySettings } from "./settings"
import {
  LEVELS,
  normalizeRequest,
  type CityGuide,
  type CityOutputInfo,
  type CityRequest,
  type CitySetInfo,
  type Level,
  type PaintStrategy,
  type ReferenceRead,
  type RefMode,
} from "./studio-types"

// City posters are made as generation sets (generation/run.ts paints them
// online or in batch jobs, retries, stops, and the upload pipeline takes
// them from there), one set per reference photo: the competitor listing it
// came from, its poster taken out of the photo. A set's batches ask for city
// outputs (`Batch.city`), and what's different about painting them lives
// here: run.ts hands a city set to `cityWork` and asks `cityRequest` what
// to tell Nano Banana for one of its images.

export const CITY_FOLDER = "Citys"

/** A set this city studio made (other shapes of `city`, from other versions of the app, are left alone). */
export const isCitySet = (set: Pick<GenerationSet, "city">): set is GenerationSet & { city: CitySetInfo } =>
  !!set.city && typeof (set.city as Partial<CitySetInfo>).placeId === "string"

/** A batch's poster options when it asks for city outputs: nothing of the poster kind. */
const NO_OPTIONS: GenerateOptions = {
  variants: { count: 0, creativity: ["medium"], styleId: null },
  ideas: { count: 0, creativity: ["medium"] },
}

const LEVEL_CREATIVITY: Record<Level, Creativity> = { 1: "minimal", 2: "subtle", 3: "low", 4: "medium", 5: "high" }

export type CityReference = {
  listingId: number
  shopId: number
  shop: string
  title: string
  /** Listing photo, short form or whole address. */
  image: string
  tags: string[]
  labels: string[]
  /** Which of the photo's prints, when it holds several. */
  print?: number
}

export type CityJob = {
  placeId: string
  place: string
  country: string
  /** The reference photo; city-only posters go without. */
  ref?: CityReference
  request: CityRequest
}

/** The city set of a reference listing (or of a place without one), if there is one. */
async function findSet(job: CityJob) {
  const sets = await listSets()
  return sets.find(
    (s) =>
      isCitySet(s) &&
      !s.city.lab &&
      !s.city.fromOutput &&
      s.city.placeId === job.placeId &&
      (job.ref ? s.source.listingId === job.ref.listingId : s.source.listingId === 0)
  )
}

/**
 * Asks for city posters: per job a batch on its reference's set (made when
 * it's new), put in line to paint. Answers the sets touched.
 */
export async function startCityJobs(jobs: CityJob[], enqueue: (id: string) => void) {
  const touched: string[] = []
  // One action for all of them: Outputs shows what one click asked for together.
  const action = newId()
  for (const job of jobs) {
    let set = await findSet(job)
    if (!set) set = await newCitySet(job)
    const city = { ...job.request, action: job.request.action ?? action, ...(job.ref?.print !== undefined && { print: job.ref.print }) }
    const batch: Batch = { id: newId(), options: NO_OPTIONS, createdAt: new Date().toISOString(), expanded: false, city }
    // `heals` as for every new batch (run.ts addBatch): images lost while painting (a dropped connection) are painted again.
    await updateSet(set.id, (s) => ({ ...s, status: "queued", stopping: undefined, doneAt: undefined, batches: [...s.batches, batch], heals: 0 }))
    enqueue(set.id)
    touched.push(set.id)
  }
  return touched
}

async function newCitySet(job: CityJob): Promise<GenerationSet> {
  const ref = job.ref
  const city: CitySetInfo = {
    placeId: job.placeId,
    place: job.place,
    country: job.country,
    ...(ref && { shopId: ref.shopId, labels: ref.labels }),
  }
  const set = await createSet("poster", CITY_FOLDER, {
    listingId: ref?.listingId ?? 0,
    title: ref?.title ?? job.place,
    image: ref ? photoUrl(ref.image, "fullxfull") : "",
    url: ref ? `https://www.etsy.com/listing/${ref.listingId}` : "",
    shop: ref?.shop ?? null,
    tags: ref?.tags ?? [],
  }, NO_OPTIONS)
  // The reference's poster as the set's own, when the Stealer took it out already.
  let posters: ExtractedPoster[] = []
  let original = set.original
  if (ref) {
    const crop = await refCrop(ref.listingId).catch(() => null)
    if (crop?.status === "done" && crop.prints.length) {
      posters = await Promise.all(
        crop.prints.map(async (print, index) => {
          const file = `poster-${index + 1}-${Date.now().toString(36)}.jpg`
          await saveFile(set.id, file, await readRefFile(ref.listingId, print.file))
          return { index, status: "done" as const, file, width: print.width, height: print.height, label: print.label || undefined }
        })
      )
      original = { status: "done", file: posters[ref.print ?? 0]?.file ?? posters[0].file }
    }
  } else {
    original = { status: "done", file: null }
  }
  return updateSet(set.id, (s) => ({
    ...s,
    city,
    original,
    posters,
    extraction: posters.length || !ref ? { status: "done", file: null } : s.extraction,
    batches: [],
  }))
}

/**
 * More from one of our posters, with every setting of a normal request:
 * from its reference (a batch on its own set), or with the poster itself
 * as the reference (a set of its own, made once per poster). Answers the set.
 */
export async function recreate(setId: string, outputId: string, base: "reference" | "ours", request: CityRequest, enqueue: (id: string) => void) {
  const set = await getSet(setId)
  if (!isCitySet(set)) throw new NotFoundError("Unknown set")
  const output = set.outputs.find((o) => o.id === outputId)
  if (!output?.file) throw new NotFoundError("Unknown poster")
  if (base === "reference" && !set.posters.some((p) => p.file)) throw new Error("This poster has no reference photo: recreate it from itself")
  const target = base === "ours" ? await ownSet(set, output) : set
  const batch: Batch = { id: newId(), options: NO_OPTIONS, createdAt: new Date().toISOString(), expanded: false, city: { ...request, action: newId() } }
  await updateSet(target.id, (s) => ({ ...s, status: "queued", stopping: undefined, doneAt: undefined, batches: [...s.batches, batch], heals: 0 }))
  enqueue(target.id)
  return target.id
}

/** The set whose reference is one of our posters, made the first time it's asked for. */
async function ownSet(set: GenerationSet & { city: CitySetInfo }, output: Output) {
  const held = (await listSets()).find((s) => isCitySet(s) && s.city.fromOutput?.setId === set.id && s.city.fromOutput.outputId === output.id)
  if (held) return held
  const made = await createSet("poster", CITY_FOLDER, { listingId: 0, title: `${set.city.place} · ${output.title ?? "our poster"}`, image: "", url: "", shop: "Ours", tags: [] }, NO_OPTIONS)
  const { data, info } = await sharp(await readSetFile(set.id, output.file!)).jpeg({ quality: 94 }).toBuffer({ resolveWithObject: true })
  const file = `poster-1-${Date.now().toString(36)}.jpg`
  await saveFile(made.id, file, data)
  const city: CitySetInfo = { placeId: set.city.placeId, place: set.city.place, country: set.city.country, fromOutput: { setId: set.id, outputId: output.id } }
  return updateSet(made.id, (s) => ({
    ...s,
    city,
    original: { status: "done", file },
    posters: [{ index: 0, status: "done", file, width: info.width, height: info.height }],
    extraction: { status: "done", file: null },
    batches: [],
  }))
}

// --- Running a city set (from run.ts) ---

export type CityHelpers = {
  /** Paints `outputs`: in a batch job, or with `now` online first (the lane), the rest in a batch job. */
  submit: (id: string, outputs: Output[], now?: boolean) => Promise<void>
  halt: (id: string) => Promise<unknown>
}

/** What run.ts's `work` does for a city set: its reference ready, outputs for new batches, briefs, then the painting. */
export async function cityWork(id: string, { submit, halt }: CityHelpers) {
  let set = await getSet(id)
  const ready = await reference(set)
  if (!ready) {
    await updateSet(id, (s) => ({
      ...s,
      outputs: s.outputs.map((o) => (o.status === "pending" && !o.job && o.city?.refMode !== "city" && o.city?.kind !== "lab" ? { ...o, status: "error", error: "Needs the reference photo" } : o)),
    }))
  }

  // Variants keep the reference's medium (a sketch makes sketches): what it is is read first.
  const read = ready ? await readOnce(id) : null
  set = await getSet(id)
  if (set.stopping) return void (await halt(id))
  await updateSet(id, (s) => ({
    ...s,
    outputs: [...s.outputs, ...s.batches.filter((b) => !b.expanded && b.city).flatMap((b) => expand(s, b, read))],
    batches: s.batches.map((b) => ({ ...b, expanded: true })),
  }))

  await plan(id)
  set = await getSet(id)
  if (set.stopping) return void (await halt(id))
  const delivery = new Map(set.batches.map((b) => [b.id, b.city?.delivery ?? "now"]))
  const waiting = set.outputs.filter((o) => o.status === "pending" && !o.job)
  const batched = waiting.filter((o) => delivery.get(o.batch) === "batch")
  const now = waiting.filter((o) => !batched.includes(o))
  await Promise.all([now.length ? submit(id, now, true) : null, batched.length ? submit(id, batched) : null])
}

/** The reference poster, taken out of the listing photo if the Stealer hadn't yet; false when it can't be. */
async function reference(set: GenerationSet) {
  if (!set.source.listingId) return true
  if (set.posters.some((p) => p.status === "done" && p.file)) return true
  try {
    await updateSet(set.id, (s) => ({ ...s, extraction: { status: "running", file: null } }))
    const photo = await fetchReference(set.source.image)
    const { layout, prints } = await extractPosters(photo, set.source.title)
    const posters: ExtractedPoster[] = []
    for (const [index, print] of prints.entries()) {
      // The photo only, without the competitor's lettering around it.
      const picture = await pictureOf(print.image).catch(() => ({ image: print.image, width: print.width, height: print.height }))
      const file = `poster-${index + 1}-${Date.now().toString(36)}.jpg`
      await saveFile(set.id, file, picture.image)
      posters.push({ index, status: "done", file, width: picture.width, height: picture.height, label: print.label || undefined })
    }
    await updateSet(set.id, (s) => ({ ...s, layout, posters, original: { status: "done", file: posters[0]?.file ?? null }, extraction: { status: "done", file: null } }))
    return posters.length > 0
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    console.error(`City set ${set.id}, reference:`, error)
    await updateSet(set.id, (s) => ({ ...s, extraction: { status: "error", file: null, error: (error as Error).message } }))
    return false
  }
}

/**
 * What the reference is and shows, read once per set (and per further
 * print of a set's photo); null without one or when it can't be read.
 */
async function readOnce(id: string, index?: number): Promise<ReferenceRead | null> {
  const set = await getSet(id)
  if (!isCitySet(set)) return null
  const first = set.posters.find((p) => p.file)
  const poster = index === undefined ? first : set.posters.find((p) => p.index === index && p.file)
  const own = !!poster && !!first && poster.index !== first.index
  const held = own ? set.city.reads?.[poster!.index] : set.city.read
  if (held) return held
  if ((!set.source.listingId && !set.city.fromOutput) || !poster?.file) return null
  try {
    const read = await readReference(await readSetFile(id, poster.file), set.city.place)
    await updateSet(id, (s) =>
      isCitySet(s) ? { ...s, city: own ? { ...s.city, reads: { ...s.city.reads, [poster.index]: read } } : { ...s.city, read } } : s
    )
    return read
  } catch (error) {
    console.warn(`City set ${id}, reading the reference:`, (error as Error).message)
    return null
  }
}

/** The outputs a city batch asks for, waiting for a brief. */
function expand(set: GenerationSet, batch: Batch, read: ReferenceRead | null): Output[] {
  const r = normalizeRequest(batch.city)
  const now = new Date().toISOString()
  // A set's photo: the print picked, when the set holds it.
  const poster = set.posters.some((p) => p.index === r.print && p.file) ? r.print! : 0
  const base = { status: "pending" as const, file: null, batch: batch.id, review: null, createdAt: now, poster, feedback: r.notes }
  const out: Output[] = []
  const make = (city: CityOutputInfo, mode: Output["mode"], creativity: Creativity, styleId?: string): Output => ({
    ...base,
    id: newId(),
    mode,
    creativity,
    ...(styleId && { styleId }),
    city: { ...city, ...(r.production && { production: r.production }) },
  })
  const hasRef = set.posters.some((p) => p.file)
  // The reference's own medium, unless everything is to be a real photo.
  const medium: "photo" | "art" = r.realPhoto ? "photo" : (read?.medium ?? "photo")
  const own = { medium, ...(r.realPhoto && { realPhoto: true }) }
  const firstSky = r.rows[0]?.sky ?? "auto"

  if (hasRef) {
    if (r.auto.on) {
      for (let i = 0; i < r.auto.count; i++) out.push(make({ kind: "real", auto: true, ...own }, "variant", "subtle"))
    } else {
      for (const row of r.rows) {
        for (const level of LEVELS) {
          for (let i = 0; i < (row.levels[level] ?? 0); i++) out.push(make({ kind: "real", level, sky: row.sky, ...own }, "variant", LEVEL_CREATIVITY[level]))
        }
      }
    }
    for (let i = 0; i < r.ideas; i++) out.push(make({ kind: "idea", sky: firstSky, ...own }, "idea", "medium"))
    if (r.set.on) {
      for (let i = 0; i < r.set.count; i++) out.push(make({ kind: "set", set: { index: i, size: r.set.count }, sky: firstSky, ...own }, "idea", "medium"))
    }
  }
  for (const style of r.styles) {
    const modes: RefMode[] = style.modes.length ? style.modes : ["city"]
    const extra = { ...(style.follow && { follow: style.follow }), ...(style.sky && style.sky !== "auto" && { sky: style.sky }) }
    for (const refMode of modes) {
      if (refMode !== "city" && !hasRef) continue
      for (let i = 0; i < style.count; i++) {
        out.push(make({ kind: "style", styleId: style.styleId, refMode, ...extra }, "variant", refMode === "photo" ? "low" : "medium", style.styleId))
      }
    }
    for (let i = 0; i < (style.set ?? 0); i++) {
      out.push(make({ kind: "style", styleId: style.styleId, refMode: "city", set: { index: i, size: style.set! }, ...extra }, "idea", "medium", style.styleId))
    }
  }
  return out
}

// --- Briefs ---

type StyleRef = {
  name: string
  medium: "photo" | "art"
  paint: PaintStrategy
  guide: StyleGuide | null
  city: CityGuide | null
  images: Buffer[]
  /** Up to eight board posters by file name: what a redraw picks from. */
  board: { file: string; image: Buffer }[]
}

const styleCache = new Map<string, { at: number; ref: Promise<StyleRef | null> }>()

/** A style's guide and up to eight of its images, held a minute so a batch reads them once. */
export function loadCityStyle(styleId: string): Promise<StyleRef | null> {
  const held = styleCache.get(styleId)
  if (held && Date.now() - held.at < 60_000) return held.ref
  const ref = (async () => {
    try {
      const style = await getStyle(styleId)
      const board = await Promise.all(pick(style.images, 8).map(async (i) => ({ file: i.file, image: await getFile(styleFileKey(styleId, i.file)).then(small) })))
      return {
        name: style.name,
        medium: style.city?.medium ?? "art",
        paint: style.city?.paint ?? "redraw",
        guide: style.guide,
        city: style.city?.guide ?? null,
        images: pick(board, 6).map((b) => b.image),
        board,
      }
    } catch (error) {
      console.error(`City style ${styleId}:`, error)
      return null
    }
  })()
  styleCache.set(styleId, { at: Date.now(), ref })
  return ref
}

/** Up to `count` best-selling posters of the place in other shops: their pictures where the Stealer took them out, else their photos. */
async function bestSellers(placeId: string, count: number): Promise<Buffer[]> {
  const place = (await ranking().catch(() => null))?.places.find((p) => p.id === placeId)
  const out: Buffer[] = []
  for (const top of place?.top ?? []) {
    if (out.length >= count) break
    try {
      const crop = await refCrop(top.listingId).catch(() => null)
      const print = crop?.status === "done" ? crop.prints[0] : undefined
      out.push(await small(print ? await readRefFile(top.listingId, print.file) : await fetchReference(photoUrl(top.image, "570xN"))))
    } catch {
      // One that can't be read is left out.
    }
  }
  return out
}

/** The kind of brief an output takes. */
const briefKind = (c: CityOutputInfo): BriefGroup["kind"] =>
  c.kind === "lab" || c.kind === "style" ? "style" : c.kind === "real" ? (c.auto ? "auto" : "real") : c.kind

/** Writes briefs for every waiting output, one art-director call per kind, medium, style, mode and set. */
async function plan(id: string) {
  const set = await getSet(id)
  const todo = set.outputs.filter((o) => o.status === "pending" && !o.brief && o.city)
  const groups = new Map<string, Output[]>()
  for (const o of todo) {
    const c = o.city!
    // A lab photo is planned on its own photo; the rest by what they share.
    // Lab cities from words are planned one city at a time, each with its own place knowledge.
    const city = c.kind === "lab" && c.block === "prompt" ? (c.target ?? "") : ""
    // Each print of a set's photo is a reference of its own.
    const key = [briefKind(c), c.medium ?? "", c.block ?? "", o.poster, city, c.candidate ?? "", c.styleId ?? "", c.refMode ?? "", c.set ? "set" : "", c.follow ?? "", c.production ?? "", o.feedback ?? ""].join("|")
    groups.set(key, [...(groups.get(key) ?? []), o])
  }
  if (!groups.size) return
  // The shop's own skies, so the briefs know them by name.
  await listCustomSkies().catch(() => [])
  const place = set.city?.place ?? set.source.title
  const brief = set.city && !set.city.lab ? await placeBrief(set.city.placeId, set.city.place, set.city.country) : null

  // New ideas, sets and styled posters are planned one group after another, each told what the
  // others chose, so no motif comes twice; variants (one per reference view) all at once.
  const planned: string[] = []
  // The top shops' photos re-taken so far in this run: the next group takes others.
  const retaken: number[] = []
  const planGroup = async (outputs: Output[]) => {
    const c = outputs[0].city!
    const lab = c.kind === "lab"
    const kind = briefKind(c)
    const poster = set.posters.find((p) => p.index === outputs[0].poster && p.file) ?? (lab ? undefined : set.posters.find((p) => p.file))
    const uses = lab ? c.block === "photo" : c.kind !== "style" || c.refMode !== "city"
    const reference = uses && poster ? await readSetFile(id, poster.file!).catch(() => null) : null
    // A set's photo: each print read on its own.
    const read = lab || !poster ? (set.city?.read ?? null) : await readOnce(id, poster.index)
    const styleId = c.styleId ?? set.city?.lab?.styleId
    const style = styleId ? await loadCityStyle(styleId) : null
    const candidate = lab && c.candidate && styleId ? await candidateGuide(styleId, c.candidate) : null
    // A redrawn art style shows the planner its board, numbered, to pick the poster each new one is redrawn from.
    const redraws = !!style && style.medium === "art" && (candidate?.paint ?? style.paint) === "redraw" && !reference
    const moodboard = redraws ? style.board.slice(0, 6).map((b) => b.image) : (style?.images.slice(0, 3) ?? [])
    // A lab city from words is a place of the ranking too: its brief and photos come with it.
    const target = lab && c.block === "prompt" && c.target ? await placeByName(c.target).catch(() => null) : null
    const placeOf = lab ? target : set.city ? { id: set.city.placeId, name: set.city.place, country: set.city.country, kind: "" } : null
    const known = lab ? (target ? await placeBrief(target.id, target.name, target.country, target.kind) : null) : brief
    const medium = style ? style.medium : (c.medium ?? "photo")
    // New compositions see real photos of the place, to pick the one showing each motif for the painter.
    const fresh = newComposition(kind) && (!lab || c.block === "prompt") && !(c.kind === "style" && c.refMode === "photo")
    // New real photos re-take what the place's top shops sell, a different photo each, so the
    // composition and the houses are real (13 Oct: invented ones looked generic); a photo
    // style only when it's asked to follow the best sellers.
    const retake = fresh && !lab && medium === "photo" && (!style || c.follow === "mid" || c.follow === "high")
    const sellers = c.follow && c.follow !== "free" && set.city && !retake ? await bestSellers(set.city.placeId, 3) : []
    // Never the reference itself (its view is made already), nor a photo re-taken before for
    // this reference in the same look; when those leave too few, they may come again.
    const pictures = (exclude: number[]): Promise<PlacePicture[]> =>
      placeOf
        ? placePictures(placeOf.id, { count: retake ? Math.min(16, Math.max(10, outputs.length * 3 + 6)) : 5, photosOnly: true, spread: retake, exclude }).catch(() => [])
        : Promise.resolve([])
    const used = retake
      ? [...set.outputs.filter((o) => !todo.includes(o) && o.city?.geo?.retake && sameFamily(briefKind(o.city), kind) && o.city.styleId === c.styleId).map((o) => o.city!.geo!.listingId), ...retaken]
      : []
    let geo = fresh ? await pictures([set.source.listingId, ...used]) : []
    if (retake && used.length && geo.length < outputs.length) geo = await pictures([set.source.listingId])
    const calm = !!placeOf && (await isCalmPlace(placeOf.id))
    const group: BriefGroup = {
      kind,
      place: lab ? (new Set(outputs.map((o) => o.city?.target)).size > 1 ? "each place named below" : (c.target ?? place)) : place,
      medium,
      fromArt: c.realPhoto && read?.medium === "art",
      items: outputs.map((o) => ({
        level: o.city?.level,
        sky: o.city?.sky,
        refMode: lab ? (o.city?.block === "photo" ? "photo" : "city") : o.city?.refMode,
        ...(o.city?.target && { target: o.city.target }),
        ...(o.city?.set && { index: o.city.set.index }),
      })),
      ...(c.set && { setSize: c.set.size }),
      hasReference: !!reference,
      ...(read && reference && !lab && { read }),
      // The place's landmarks are for new compositions; a variant stays on what the reference shows.
      ...(known && newComposition(kind) && { brief: known }),
      style: style ? { name: style.name, medium: style.medium, guide: candidate?.guide ?? style.guide, city: candidate?.city ?? style.city } : undefined,
      moodboard: moodboard.length,
      ...(redraws && { boards: moodboard.length }),
      sellers: sellers.length,
      geo: geo.length,
      ...(retake && geo.length > 0 && { retake: true }),
      ...(calm && { calm: true }),
      ...(c.follow && { follow: c.follow }),
      notes: outputs[0].feedback,
      // Only what was made before in the same look: another style's posters of the place must not keep this one from its icon.
      avoid: lab
        ? []
        : [
            // Re-takes only mind earlier re-takes: views invented before mustn't keep them from the classic ones.
            ...set.outputs
              .filter((o) => o.brief && !todo.includes(o) && o.city && sameFamily(briefKind(o.city), kind) && o.city.styleId === c.styleId && (o.city.medium ?? "") === (c.medium ?? "") && (!retake || o.city.geo?.retake))
              .map((o) => `${o.title ?? ""}: ${o.brief}`),
            ...(newComposition(kind) ? planned : []),
          ],
    }
    // The place's photos carry their numbers drawn in, so a brief names the photo it describes.
    const images = [...(reference ? [reference] : []), ...moodboard, ...sellers, ...(await Promise.all(geo.map((g, i) => numbered(g.image, i + 1))))]
    try {
      const briefs = await planCityBriefs(group, images)
      if (newComposition(kind)) planned.push(...briefs.map((b) => `${b.title}: ${b.brief}`))
      if (retake) retaken.push(...briefs.flatMap((b) => (b.photo && geo[b.photo - 1] ? [geo[b.photo - 1].listingId] : [])))
      await updateSet(id, (s) => ({
        ...s,
        outputs: s.outputs.map((o) => {
          const i = outputs.findIndex((q) => q.id === o.id)
          if (i < 0 || !o.city) return o
          const b = briefs[i]
          const shows = b.photo ? geo[b.photo - 1] : undefined
          const city: CityOutputInfo = {
            ...o.city,
            ...(b.level && { level: b.level }),
            ...(b.sky && { sky: b.sky }),
            ...(o.city.set && b.motif && { set: { ...o.city.set, motif: b.motif } }),
            ...(shows && { geo: { listingId: shows.listingId, file: shows.file, ...(retake && { retake: true }) } }),
            ...(redraws && style && { board: style.board[(b.board ?? (i % Math.min(style.board.length, 6)) + 1) - 1]?.file }),
          }
          return { ...o, title: b.title, brief: b.brief, city, ...(b.level && { creativity: LEVEL_CREATIVITY[b.level] }) }
        }),
      }))
    } catch (error) {
      // Painting still works from the level's own description.
      console.error(`City set ${id}, planning:`, error)
    }
  }
  const all = [...groups.values()]
  const fresh = all.filter((outputs) => newComposition(briefKind(outputs[0].city!)) && outputs[0].city!.kind !== "lab")
  await Promise.all([
    ...all.filter((outputs) => !fresh.includes(outputs)).map(planGroup),
    fresh.reduce((chain, outputs) => chain.then(() => planGroup(outputs)), Promise.resolve()),
  ])
}

/** Kinds that compose the place anew (and need its landmarks and each other's choices). */
const newComposition = (kind: BriefGroup["kind"]) => kind === "idea" || kind === "set" || kind === "style"

/** Briefs of kinds that must not repeat each other: variants among variants, new compositions among new compositions. */
const sameFamily = (a: BriefGroup["kind"], b: BriefGroup["kind"]) => a === b || (newComposition(a) && newComposition(b))

// --- What Nano Banana is told (from run.ts's request) ---

/** The prompt, images and shape for one city output; `mode` and `geo` override how an art style is asked (for tests). */
export async function cityRequest(set: GenerationSet, output: Output, test: { mode?: "lean" | "full"; geo?: boolean } = {}) {
  const c = output.city ?? { kind: "real" as const }
  const { ratio } = await citySettings()
  const place = c.target ?? set.city?.place ?? set.source.title
  const poster = set.posters.find((p) => p.index === output.poster && p.file) ?? set.posters.find((p) => p.file)
  const ownLook = c.kind === "real" || c.kind === "idea" || c.kind === "set"
  const wantsRef = ownLook || (c.kind === "style" && c.refMode === "photo") || (c.kind === "lab" && c.block === "photo")
  const reference = wantsRef && poster ? await readSetFile(set.id, poster.file!) : null
  if (wantsRef && !reference) throw new Error("Needs the reference photo")

  const styleId = c.styleId ?? set.city?.lab?.styleId
  const style = styleId ? await loadCityStyle(styleId) : null
  const candidate = c.candidate && styleId ? await candidateGuide(styleId, c.candidate) : null
  // Redrawing: the board poster the art director picked first, two more of the series after it.
  const redraw = !!style && style.medium === "art" && (candidate?.paint ?? style.paint) === "redraw" && !!c.board && !reference
  const picked = redraw ? style.board.find((b) => b.file === c.board) : undefined
  // Lab block "references": the moodboard images it was given; else the board's own.
  const moodboard = picked
    ? [picked.image, ...style!.board.filter((b) => b.file !== c.board).slice(0, 2).map((b) => b.image)]
    : c.kind === "lab" && c.block === "references" && styleId && c.refs?.length
      ? await Promise.all(c.refs.map((file) => getFile(styleFileKey(styleId, file)).then(small)))
      : c.kind === "style" || c.kind === "lab"
        ? (style?.images ?? [])
        : []
  // The read of the print it's made from (a set's photo holds several).
  const read = (poster && poster.index !== set.posters.find((p) => p.file)?.index ? set.city?.reads?.[poster.index] : undefined) ?? set.city?.read
  // The place's landmarks keep new compositions true; variants have the reference for that.
  const newView = c.kind === "idea" || c.kind === "set" || (c.kind === "style" && c.refMode !== "photo") || (c.kind === "lab" && c.block === "prompt")
  const target = c.kind === "lab" && c.target ? await placeByName(c.target).catch(() => null) : null
  const brief = !newView
    ? null
    : target
      ? await placeBrief(target.id, target.name, target.country, target.kind)
      : set.city && !set.city.lab
        ? await placeBrief(set.city.placeId, set.city.place, set.city.country)
        : null
  // The real photo the art director picked for this motif, for its geography only: real photos
  // only, a drawing takes detail from a photo (13 Oct), unless a test asks for it.
  const artStyle = !!style && style.medium === "art"
  const wantsGeo = test.geo ?? !artStyle
  const geo = c.geo && wantsGeo ? await readRefFile(c.geo.listingId, c.geo.file).then(small).catch(() => null) : null
  // A sky of the shop's own comes with its photo to look at.
  await listCustomSkies().catch(() => [])
  const skyImage = await skyPhoto(c.sky)

  const lookOnly = (c.kind === "idea" || c.kind === "set") && (c.medium ?? "photo") === "photo" && !style
  const prompt = paintCityPrompt({
    kind: c.kind,
    place,
    brief: output.brief ?? fallback(c, place),
    level: c.level,
    sky: c.sky,
    refMode: c.kind === "lab" ? (c.block === "photo" ? "photo" : "city") : c.refMode,
    medium: style ? style.medium : (c.medium ?? "photo"),
    fromArt: !!c.realPhoto && read?.medium === "art",
    reference: !!reference,
    moodboard: moodboard.length,
    style: style ? { guide: candidate?.guide ?? style.guide, city: candidate?.city ?? style.city, medium: style.medium } : undefined,
    ...(read && ownLook && { read }),
    // The place's landmarks spelled out pull a drawing toward detail: only for photos and the full prompt.
    placeLine: artStyle && (test.mode ?? "lean") === "lean" ? undefined : placeLine(brief),
    geo: !!geo,
    retake: !!geo && !!c.geo?.retake,
    mode: test.mode,
    redraw: !!picked,
    lookOnly,
    skyImage: !!skyImage,
    notes: output.feedback,
    series: c.kind === "lab" && c.block === "references",
  })
  // A new real photo puts the motif's photo first and the reference after it, for its look only.
  const images = lookOnly
    ? [...(geo ? [geo] : []), ...(reference ? [reference] : []), ...(skyImage ? [skyImage] : [])]
    : [...(reference ? [reference] : []), ...moodboard, ...(geo ? [geo] : []), ...(skyImage ? [skyImage] : [])]
  return { prompt, images, aspect: ratio }
}

function fallback(c: CityOutputInfo, place: string) {
  if (c.kind === "idea") return `A new picture of ${place} from another of its signature views, in the reference's look.`
  if (c.kind === "set") return `A poster of ${place} showing one of its signature motifs, in the reference's look.`
  if (c.kind === "real") return `${place}, as in the reference.`
  return `A travel poster of ${place} showing its signature landmarks.`
}

async function candidateGuide(styleId: string, candidateId: string) {
  const style = await getStyle(styleId).catch(() => null)
  const found = style?.city?.candidates.find((k) => k.id === candidateId)
  return found ? { guide: found.guide, city: found.city, paint: found.paint } : null
}

const small = (data: Buffer) => sharp(data).resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()

/**
 * A photo with its number drawn large in its top-left corner, for the art
 * director to name it by. 13 Oct: counted by position, and then captioned
 * "Photo N" between the images, it named the photo after the one it meant
 * every time (a caption reads as the image before it).
 */
async function numbered(image: Buffer, n: number) {
  const { width = 1024, height = 1024 } = await sharp(image).metadata()
  const size = Math.round(Math.max(44, Math.min(width, height) * 0.1))
  const w = Math.round(size * (n > 9 ? 1.9 : 1.4))
  const h = Math.round(size * 1.35)
  const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${Math.round(size * 0.22)}" fill="#111" fill-opacity="0.85"/><text x="${w / 2}" y="${Math.round(h * 0.72)}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="700" fill="#fff" text-anchor="middle">${n}</text></svg>`
  const at = Math.round(size * 0.3)
  return sharp(image).composite([{ input: Buffer.from(badge), top: at, left: at }]).jpeg({ quality: 85 }).toBuffer()
}

