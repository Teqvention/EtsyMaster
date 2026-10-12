import sharp from "sharp"

import { createSet, getSet, listSets, newId, readSetFile, saveFile, updateSet } from "@/lib/generation/storage"
import type { Batch, Creativity, ExtractedPoster, GenerateOptions, GenerationSet, Output } from "@/lib/generation/types"
import { extractPosters } from "@/lib/generation/poster"
import { fetchReference } from "@/lib/mockups/reference"
import { NotFoundError } from "@/lib/mockups/storage"
import { fileKey as styleFileKey, getStyle, styleImages } from "@/lib/styles/storage"
import type { StyleGuide } from "@/lib/styles/types"
import { getFile } from "@/lib/storage/files"

import { placeBrief, placeLine } from "./briefs"
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
  for (const job of jobs) {
    let set = await findSet(job)
    if (!set) set = await newCitySet(job)
    const batch: Batch = { id: newId(), options: NO_OPTIONS, createdAt: new Date().toISOString(), expanded: false, city: job.request }
    await updateSet(set.id, (s) => ({ ...s, status: "queued", stopping: undefined, doneAt: undefined, batches: [...s.batches, batch] }))
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

// --- Running a city set (from run.ts) ---

export type CityHelpers = {
  draw: (id: string, output: Output) => Promise<void>
  submit: (id: string, outputs: Output[]) => Promise<void>
  halt: (id: string) => Promise<unknown>
}

/** What run.ts's `work` does for a city set: its reference ready, outputs for new batches, briefs, then the painting. */
export async function cityWork(id: string, { draw, submit, halt }: CityHelpers) {
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
  await Promise.all([...waiting.filter((o) => !batched.includes(o)).map((o) => draw(id, o)), batched.length ? submit(id, batched) : null])
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

/** What the reference is and shows, read once per set; null without one or when it can't be read. */
async function readOnce(id: string): Promise<ReferenceRead | null> {
  const set = await getSet(id)
  if (!isCitySet(set)) return null
  if (set.city.read) return set.city.read
  const poster = set.posters.find((p) => p.file)
  if (!set.source.listingId || !poster?.file) return null
  try {
    const read = await readReference(await readSetFile(id, poster.file), set.city.place)
    await updateSet(id, (s) => (isCitySet(s) ? { ...s, city: { ...s.city, read } } : s))
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
  const base = { status: "pending" as const, file: null, batch: batch.id, review: null, createdAt: now, poster: 0, feedback: r.notes }
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

type StyleRef = { name: string; medium: "photo" | "art"; guide: StyleGuide | null; city: CityGuide | null; images: Buffer[] }

const styleCache = new Map<string, { at: number; ref: Promise<StyleRef | null> }>()

/** A style's guide and six of its images, held a minute so a batch reads them once. */
export function loadCityStyle(styleId: string): Promise<StyleRef | null> {
  const held = styleCache.get(styleId)
  if (held && Date.now() - held.at < 60_000) return held.ref
  const ref = (async () => {
    try {
      const style = await getStyle(styleId)
      return {
        name: style.name,
        medium: style.city?.medium ?? "art",
        guide: style.guide,
        city: style.city?.guide ?? null,
        images: await styleImages(styleId, 6),
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
    const key = [briefKind(c), c.medium ?? "", c.block ?? "", c.block === "photo" ? o.poster : "", c.candidate ?? "", c.styleId ?? "", c.refMode ?? "", c.set ? "set" : "", c.follow ?? "", c.production ?? "", o.feedback ?? ""].join("|")
    groups.set(key, [...(groups.get(key) ?? []), o])
  }
  if (!groups.size) return
  const place = set.city?.place ?? set.source.title
  const read = set.city?.read ?? null
  const brief = set.city ? await placeBrief(set.city.placeId, set.city.place, set.city.country) : null

  // New ideas, sets and styled posters are planned one group after another, each told what the
  // others chose, so no motif comes twice; variants (one per reference view) all at once.
  const planned: string[] = []
  const planGroup = async (outputs: Output[]) => {
    const c = outputs[0].city!
    const lab = c.kind === "lab"
    const kind = briefKind(c)
    const poster = set.posters.find((p) => p.index === outputs[0].poster && p.file) ?? (lab ? undefined : set.posters.find((p) => p.file))
    const uses = lab ? c.block === "photo" : c.kind !== "style" || c.refMode !== "city"
    const reference = uses && poster ? await readSetFile(id, poster.file!).catch(() => null) : null
    const styleId = c.styleId ?? set.city?.lab?.styleId
    const style = styleId ? await loadCityStyle(styleId) : null
    const candidate = lab && c.candidate && styleId ? await candidateGuide(styleId, c.candidate) : null
    const moodboard = style?.images.slice(0, 3) ?? []
    const sellers = c.follow && c.follow !== "free" && set.city ? await bestSellers(set.city.placeId, 3) : []
    const group: BriefGroup = {
      kind,
      place: lab ? (outputs.length > 1 ? "each place named below" : (c.target ?? place)) : place,
      medium: style ? style.medium : (c.medium ?? "photo"),
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
      ...(brief && !lab && newComposition(kind) && { brief }),
      style: style ? { name: style.name, medium: style.medium, guide: candidate?.guide ?? style.guide, city: candidate?.city ?? style.city } : undefined,
      moodboard: moodboard.length,
      sellers: sellers.length,
      ...(c.follow && { follow: c.follow }),
      notes: outputs[0].feedback,
      avoid: lab ? [] : [...set.outputs.filter((o) => o.brief && !todo.includes(o) && o.city && sameFamily(briefKind(o.city), kind)).map((o) => `${o.title ?? ""}: ${o.brief}`), ...(newComposition(kind) ? planned : [])],
    }
    const images = [...(reference ? [reference] : []), ...moodboard, ...sellers]
    try {
      const briefs = await planCityBriefs(group, images)
      if (newComposition(kind)) planned.push(...briefs.map((b) => `${b.title}: ${b.brief}`))
      await updateSet(id, (s) => ({
        ...s,
        outputs: s.outputs.map((o) => {
          const i = outputs.findIndex((q) => q.id === o.id)
          if (i < 0 || !o.city) return o
          const b = briefs[i]
          const city: CityOutputInfo = {
            ...o.city,
            ...(b.level && { level: b.level }),
            ...(b.sky && { sky: b.sky }),
            ...(o.city.set && b.motif && { set: { ...o.city.set, motif: b.motif } }),
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

/** The prompt, images and shape for one city output. */
export async function cityRequest(set: GenerationSet, output: Output) {
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
  // Lab block "references": the moodboard images it was given; else the board's own.
  const moodboard =
    c.kind === "lab" && c.block === "references" && styleId && c.refs?.length
      ? await Promise.all(c.refs.map((file) => getFile(styleFileKey(styleId, file)).then(small)))
      : c.kind === "style" || c.kind === "lab"
        ? (style?.images ?? [])
        : []
  const read = set.city?.read
  // The place's landmarks keep new compositions true; variants have the reference for that.
  const newView = c.kind === "idea" || c.kind === "set" || (c.kind === "style" && c.refMode !== "photo")
  const brief = newView && set.city ? await placeBrief(set.city.placeId, set.city.place, set.city.country) : null

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
    placeLine: placeLine(brief),
    notes: output.feedback,
    series: c.kind === "lab" && c.block === "references",
  })
  return { prompt, images: [...(reference ? [reference] : []), ...moodboard], aspect: ratio }
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
  return found ? { guide: found.guide, city: found.city } : null
}

const small = (data: Buffer) => sharp(data).resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()

