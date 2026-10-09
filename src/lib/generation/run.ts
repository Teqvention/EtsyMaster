import { readFile } from "node:fs/promises"

import sharp from "sharp"

import { paint } from "@/lib/mockups/gemini"
import { createSceneFromReference, fetchReference } from "@/lib/mockups/reference"
import { filePath as sceneFile, NotFoundError } from "@/lib/mockups/storage"
import { getStyle, styleImages } from "@/lib/styles/storage"
import type { StyleGuide } from "@/lib/styles/types"

import { analysePoster, extractPosters } from "./poster"
import { paintPrompt, planBriefs } from "./prompts"
import {
  filePath,
  getSet,
  newId,
  removeFile,
  saveFile,
  updateOutput,
  updateSet,
} from "./storage"
import {
  spread,
  type Asset,
  type Batch,
  type Creativity,
  type ExtractedPoster,
  type GenerateOptions,
  type GenerationSet,
  type Output,
  type OutputMode,
} from "./types"

// Works through queued sets in the background. A set's finished parts are
// kept, so a retry only redoes what failed, and new batches only add images.

/** Sets worked on at once; how many images go to Vertex at a time is up to its gate in gemini.ts. */
const PARALLEL = 3

type Queue = { waiting: string[]; running: Set<string> }
// On globalThis, so every route (and a dev reload) shares the one queue.
const global = globalThis as typeof globalThis & { __generationRunner?: Queue }
const queue = (global.__generationRunner ??= { waiting: [], running: new Set() })

export function enqueue(id: string) {
  if (!queue.waiting.includes(id)) queue.waiting.push(id)
  pump()
}

export function dequeue(id: string) {
  queue.waiting = queue.waiting.filter((w) => w !== id)
}

function pump() {
  while (queue.running.size < PARALLEL) {
    // A set asked for again while it runs waits for that run to end.
    const i = queue.waiting.findIndex((id) => !queue.running.has(id))
    if (i < 0) return
    const [id] = queue.waiting.splice(i, 1)
    queue.running.add(id)
    run(id).finally(() => {
      queue.running.delete(id)
      pump()
    })
  }
}

// --- Requests ---

const reset = <T extends Asset>(a: T): T =>
  a.status === "error" ? { ...a, status: "pending", error: undefined } : a

/** Queues the set again for everything that failed. */
export async function retry(id: string) {
  const set = await updateSet(id, (s) => ({
    ...s,
    status: "queued",
    original: reset(s.original),
    extraction: s.extraction && reset(s.extraction),
    mockup: s.mockup && reset(s.mockup),
    outputs: s.outputs.map(reset),
  }))
  enqueue(id)
  return set
}

/** More images for a poster set: a new batch, made once its turn comes. */
export async function addBatch(id: string, options: GenerateOptions) {
  const set = await updateSet(id, (s) => {
    if (s.kind !== "poster") throw new Error("Only poster sets make new images")
    const batch: Batch = { id: newId(), options, createdAt: new Date().toISOString(), expanded: false }
    return { ...s, status: "queued", batches: [...s.batches, batch] }
  })
  enqueue(id)
  return set
}

// --- Running ---

async function run(id: string) {
  try {
    const set = await updateSet(id, (s) => ({ ...s, status: "running" }))
    if (set.kind === "poster") await poster(id)
    else await mockup(set)
    await updateSet(id, (s) => ({ ...s, status: failed(s) ? "error" : "done" }))
  } catch (error) {
    if (error instanceof NotFoundError && error.message === "Unknown generation") return // deleted while it ran
    console.error(`Generation ${id}:`, error)
    await updateSet(id, (s) => ({
      ...s,
      status: "error",
      outputs: s.outputs.map((o) => (o.status === "done" ? o : { ...o, status: "error", error: message(error) })),
    })).catch(() => {})
  }
}

function failed(set: GenerationSet) {
  return (
    [set.original, set.extraction, set.mockup, ...set.outputs].some((a) => a?.status === "error")
  )
}

async function original(set: GenerationSet) {
  if (set.original.status === "done") return readFile(filePath(set.id, set.original.file!))
  await updateSet(set.id, (s) => ({ ...s, original: { ...s.original, status: "running" } }))
  try {
    const stored = await store(set.id, "source", await fetchReference(set.source.image))
    await updateSet(set.id, (s) => ({ ...s, original: stored.asset }))
    return stored.data
  } catch (error) {
    await fail(set.id, "original", error)
    return null
  }
}

async function poster(id: string) {
  let set = await getSet(id)
  const photo = await original(set)
  if (!photo) return blockOutputs(id, "Needs the original photo")

  // 1. Every poster in the photo.
  set = await getSet(id)
  if (set.extraction?.status !== "done" || set.posters.length === 0) {
    await updateSet(id, (s) => ({ ...s, extraction: { status: "running", file: null } }))
    try {
      const { layout, prints, note } = await extractPosters(photo, set.source.title)
      const posters: ExtractedPoster[] = []
      for (const [index, print] of prints.entries()) {
        const file = `poster-${index + 1}-${Date.now().toString(36)}.jpg`
        await saveFile(id, file, print.image)
        posters.push({
          index,
          status: "done" as const,
          file,
          width: print.width,
          height: print.height,
          label: print.label || undefined,
        })
      }
      for (const old of set.posters) await removeFile(id, old.file)
      await updateSet(id, (s) => ({ ...s, layout, posters, extraction: { status: "done", file: null, note } }))
    } catch (error) {
      await fail(id, "extraction", error)
      return blockOutputs(id, "Needs the extracted poster")
    }
  }

  // 2. What each one is (best effort: prompts work without it, just less well).
  set = await getSet(id)
  await Promise.all(
    set.posters
      .filter((p) => !p.analysis)
      .map(async (p) => {
        try {
          const analysis = await analysePoster(await readFile(filePath(id, p.file!)), set.source.title)
          await updateSet(id, (s) => ({
            ...s,
            posters: s.posters.map((q) => (q.index === p.index ? { ...q, analysis } : q)),
          }))
        } catch (error) {
          console.error(`Generation ${id}, reading poster ${p.index + 1}:`, error)
        }
      })
  )

  // 3. The images new batches ask for.
  await updateSet(id, (s) => ({
    ...s,
    outputs: [...s.outputs, ...s.batches.filter((b) => !b.expanded).flatMap((b) => expand(s, b))],
    batches: s.batches.map((b) => ({ ...b, expanded: true })),
  }))

  // 4. A brief for each, then the painting.
  await plan(id)
  set = await getSet(id)
  const styles = new Map<string, Promise<StyleRef | null>>()
  await Promise.all(
    set.outputs
      .filter((o) => o.status === "pending")
      .map((o) => {
        const styleId = o.mode === "variant" ? o.styleId : null
        if (styleId && !styles.has(styleId)) styles.set(styleId, loadStyle(styleId))
        return draw(id, o, styleId ? styles.get(styleId)! : Promise.resolve(null))
      })
  )
}

/** The outputs `batch` asks for, waiting for a brief. */
function expand(set: GenerationSet, batch: Batch): Output[] {
  const { options } = batch
  const now = new Date().toISOString()
  const base = { status: "pending" as const, file: null, batch: batch.id, review: null, createdAt: now }

  // More from one of our outputs: each new image starts from it (and its brief).
  if (options.from) {
    const from = set.outputs.find((o) => o.id === options.from)
    if (!from) return []
    const empty = options.variants.count + options.ideas.count === 0
    const variants = empty ? [from.creativity] : spread(options.variants.count, options.variants.creativity)
    const shared = { ...base, poster: from.poster, feedback: options.feedback, from: from.id }
    return [
      ...variants.map(
        (creativity): Output => ({
          ...shared,
          id: newId(),
          mode: from.mode,
          creativity,
          styleId: options.variants.styleId ?? from.styleId ?? null,
        })
      ),
      ...spread(options.ideas.count, options.ideas.creativity).map(
        (creativity): Output => ({ ...shared, id: newId(), mode: "idea", creativity })
      ),
    ]
  }

  // New ideas after approved outputs: one batch on the reference they share most.
  if (options.inspiration) {
    const picked = set.outputs.filter((o) => options.inspiration!.includes(o.id) && o.file)
    if (!picked.length) return []
    const poster = options.posters?.[0] ?? mostCommon(picked.map((o) => o.poster))
    return spread(options.ideas.count, options.ideas.creativity).map(
      (creativity): Output => ({
        ...base,
        id: newId(),
        poster,
        mode: "idea",
        creativity,
        feedback: options.feedback,
        inspiration: picked.map((o) => o.id),
      })
    )
  }

  const posters = set.posters.filter((p) => !options.posters || options.posters.includes(p.index))
  return posters.flatMap((p) => [
    ...spread(options.variants.count, options.variants.creativity).map(
      (creativity): Output => ({
        ...base,
        id: newId(),
        poster: p.index,
        mode: "variant",
        creativity,
        styleId: options.variants.styleId,
        feedback: options.feedback,
      })
    ),
    ...spread(options.ideas.count, options.ideas.creativity).map(
      (creativity): Output => ({
        ...base,
        id: newId(),
        poster: p.index,
        mode: "idea",
        creativity,
        feedback: options.feedback,
      })
    ),
  ])
}

const mostCommon = (values: number[]) =>
  values.reduce((best, v) => (values.filter((w) => w === v).length > values.filter((w) => w === best).length ? v : best))

/** The approved outputs `output` takes after, with images. */
const inspirationOf = (set: GenerationSet, output: Output) =>
  (output.inspiration ?? []).flatMap((id) => set.outputs.filter((o) => o.id === id && o.file))

/** Painting gets fewer inspiration images than planning: past a few they only blur the style. */
const PAINT_INSPIRATION = 4

type StyleRef = { guide: StyleGuide | null; images: Buffer[] }

async function loadStyle(styleId: string): Promise<StyleRef | null> {
  try {
    const style = await getStyle(styleId)
    return { guide: style.guide, images: await styleImages(styleId, 4) }
  } catch (error) {
    console.error(`Style ${styleId}:`, error)
    return null
  }
}

/** Writes briefs for every waiting output, one art-director call per poster, mode and style. */
async function plan(id: string) {
  const set = await getSet(id)
  const todo = set.outputs.filter((o) => o.status === "pending" && !o.brief)
  const groups = new Map<string, Output[]>()
  for (const o of todo) {
    const key = `${o.poster}|${o.mode}|${o.mode === "variant" ? (o.styleId ?? "") : ""}|${o.feedback ?? ""}|${o.from ?? ""}|${o.inspiration?.join(",") ?? ""}`
    groups.set(key, [...(groups.get(key) ?? []), o])
  }

  await Promise.all(
    [...groups.values()].map(async (outputs) => {
      const { poster: index, mode, styleId, feedback, from: fromId } = outputs[0]
      const p = set.posters.find((q) => q.index === index)
      if (!p?.file) return
      const style = mode === "variant" && styleId ? await loadStyle(styleId) : null
      const from = fromId ? set.outputs.find((o) => o.id === fromId) : undefined
      const inspiration = inspirationOf(set, outputs[0])
      const avoid = set.outputs
        .filter((o) => o.poster === index && o.mode === mode && o.brief && !todo.includes(o))
        .map((o) => `${o.title ?? ""}: ${o.brief}`)
      try {
        const briefs = await planBriefs(await readFile(filePath(id, p.file)), {
          mode,
          levels: outputs.map((o) => o.creativity),
          analysis: p.analysis,
          title: set.source.title,
          style: style?.guide,
          feedback,
          avoid,
          base: from && {
            title: from.title ?? "Earlier poster",
            brief: from.brief ?? "(no brief kept — read it from the image)",
          },
          inspiration: inspiration.length
            ? inspiration.map((o) => ({ title: o.title ?? "Approved poster", brief: o.brief ?? "(read it from the image)" }))
            : undefined,
        }, from?.file
          ? [await readFile(filePath(id, from.file))]
          : await Promise.all(inspiration.map((o) => readFile(filePath(id, o.file!)))))
        await updateSet(id, (s) => ({
          ...s,
          outputs: s.outputs.map((o) => {
            const i = outputs.findIndex((q) => q.id === o.id)
            return i < 0 ? o : { ...o, title: briefs[i].title, brief: briefs[i].brief }
          }),
        }))
      } catch (error) {
        // Painting still works from the plain level description.
        console.error(`Generation ${id}, planning:`, error)
      }
    })
  )
}

const PLAIN: Record<OutputMode, Record<Creativity, string>> = {
  variant: {
    minimal: "Almost identical to the reference: same subject, style, palette and layout, with only tiny differences in details.",
    subtle: "Very close to the reference: same subject, style and palette, with small changes to the arrangement.",
    low: "Same subject, style and palette, recomposed with a clearly different arrangement.",
    medium: "Same style and palette; the subject in a new composition and layout.",
    high: "Same style and palette; a bold, inventive composition and layout.",
  },
  idea: {
    minimal: "Keep the style, hook and scene; change one small detail.",
    subtle: "Keep the style and hook; change one thing about the scene slightly.",
    low: "Keep the style and hook; change one thing about the scene (character, place or prop).",
    medium: "Keep the style and hook; a new character in a new place.",
    high: "Keep the style and hook; a bold new scenario.",
  },
}

async function draw(id: string, output: Output, style: Promise<StyleRef | null>) {
  await updateOutput(id, output.id, { status: "running", error: undefined })
  try {
    const set = await getSet(id)
    const current = set.outputs.find((o) => o.id === output.id)!
    const p = set.posters.find((q) => q.index === current.poster)
    if (!p?.file) throw new Error("Needs the extracted poster")
    const reference = await readFile(filePath(id, p.file))
    const ref = await style
    const moodboard = ref?.images ?? []
    const from = current.from ? set.outputs.find((o) => o.id === current.from) : null
    const previous = from?.file ? [await readFile(filePath(id, from.file))] : []
    const inspiration = await Promise.all(
      inspirationOf(set, current).slice(0, PAINT_INSPIRATION).map((o) => readFile(filePath(id, o.file!)))
    )

    const prompt = paintPrompt({
      mode: current.mode,
      brief: current.brief ?? PLAIN[current.mode][current.creativity],
      style: ref?.guide,
      moodboard: moodboard.length,
      feedback: current.feedback,
      previous: previous.length > 0,
      inspiration: inspiration.length,
    })
    const aspect = p.width && p.height ? p.width / p.height : undefined
    const image = await paint(prompt, [reference, ...moodboard, ...inspiration, ...previous], aspect)
    const stored = await store(id, `out-${output.id}`, image)
    await updateOutput(id, output.id, { ...stored.asset })
  } catch (error) {
    if (error instanceof NotFoundError && error.message === "Unknown generation") throw error
    console.error(`Generation ${id}, output ${output.id}:`, error)
    await updateOutput(id, output.id, { status: "error", error: message(error) }).catch(() => {})
  }
}

async function mockup(set: GenerationSet) {
  const photo = await original(set)
  if (!photo) {
    await updateSet(set.id, (s) => ({
      ...s,
      mockup: { status: "error", file: null, error: "Needs the original photo" },
    }))
    return
  }
  if (set.mockup?.status === "done") return
  await updateSet(set.id, (s) => ({ ...s, mockup: { status: "running", file: null } }))
  try {
    const scene = await createSceneFromReference(mockupName(set.source.title), photo, {
      category: set.folder,
      source: set.source.shop ?? undefined,
    })
    const stored = await store(set.id, "mockup", await readFile(sceneFile(scene.id, "background.jpg")))
    await updateSet(set.id, (s) => ({
      ...s,
      sceneId: scene.id,
      mockup: {
        ...stored.asset,
        note: scene.located ? undefined : "Couldn't find the sheet — set the four corners in the editor",
      },
    }))
  } catch (error) {
    await fail(set.id, "mockup", error)
  }
}

/** Saves an image (upright, at most 2400 px, JPEG) under a fresh name, so it can be cached for good. */
async function store(id: string, name: string, image: Buffer) {
  const { data, info } = await sharp(image)
    .rotate()
    .resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer({ resolveWithObject: true })
  const file = `${name}-${Date.now().toString(36)}.jpg`
  await saveFile(id, file, data)
  const asset: Asset = { status: "done", file, width: info.width, height: info.height }
  return { asset, data }
}

async function fail(id: string, key: "original" | "extraction" | "mockup", error: unknown) {
  if (error instanceof NotFoundError && error.message === "Unknown generation") throw error
  console.error(`Generation ${id}, ${key}:`, error)
  await updateSet(id, (s) => ({ ...s, [key]: { status: "error", file: null, error: message(error) } }))
}

/** Nothing can be drawn: every waiting output fails with `why`. */
function blockOutputs(id: string, why: string) {
  return updateSet(id, (s) => ({
    ...s,
    outputs: s.outputs.map((o) => (o.status === "done" ? o : { ...o, status: "error", error: why })),
  }))
}

const message = (error: unknown) => (error instanceof Error ? error.message : "Failed")

/** Etsy titles are keyword lists; the first phrase names the thing. */
function mockupName(title: string) {
  const first = title.split(/\s*[,|•·–—]\s*|\s+-\s+/)[0]?.trim()
  return (first || title).slice(0, 48)
}
