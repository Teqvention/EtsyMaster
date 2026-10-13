import { askJson } from "@/lib/mockups/gemini"
import { getFile } from "@/lib/storage/files"
import { createSet, getSet, newId, readSetFile, saveFile, updateSet } from "@/lib/generation/storage"
import {
  spread,
  type Batch,
  type Creativity,
  type Delivery,
  type ExtractedPoster,
  type GenerateOptions,
  type GenerationSet,
  type Output,
  type PosterAnalysis,
} from "@/lib/generation/types"

import { fileKey, getStyle, updateStyle } from "./storage"
import { ensureStudy, numbered } from "./study"
import type { Style, StyleStudy, StudyImage } from "./types"

export { MAX_AUTO } from "./types"

// Autonomous scale: as many new posters in a style as asked for, each its own
// picture, all of them the series' look and feeling. The board is studied
// first, every image (styles/study.ts). Gemini then plans the posters a few
// at a time: each gets an anchor, the board image whose look it takes, and
// one or two more of the anchor's family, and a brief that says only what the
// picture shows; the creativity level says how far the picture moves from
// the board (a sibling of the anchor up to the artist's boldest new idea),
// never the look or the feeling. Nano Banana paints each from its anchor.
// The posters go into one generation set per style (its posters are the
// board's images), so they're reviewed like any other, through the same lane
// and batch jobs; every few go out as soon as they're planned.

/** Posters planned per Gemini answer: a careful answer, and painting starts early. */
const CHUNK = 8
const FOLDER = "Styles"
const EMPTY: GenerateOptions = {
  variants: { count: 0, creativity: ["medium"], styleId: null },
  ideas: { count: 0, creativity: ["medium"] },
}

export const isStyleSet = (set: GenerationSet) => !!set.style

/** Queues `count` new posters in the style over `levels`, in the style's set (made the first time). */
export async function startAuto(
  styleId: string,
  { levels, count, delivery }: { levels: Creativity[]; count: number; delivery: Delivery }
): Promise<GenerationSet> {
  const style = await getStyle(styleId)
  if (!style.images.length) throw new Error("Add images to the board first")
  let set = style.autoSet ? await getSet(style.autoSet).catch(() => null) : null
  if (!set) {
    set = await createSet("poster", FOLDER, sourceOf(style), EMPTY)
    const id = set.id
    await updateStyle(styleId, (s) => ({ ...s, autoSet: id }))
    set = await updateSet(id, (s) => ({ ...s, batches: [] }))
  }
  set = await syncBoard(set, style)
  const batch: Batch = {
    id: newId(),
    options: { ...EMPTY, delivery },
    createdAt: new Date().toISOString(),
    expanded: false,
    auto: { levels, count },
  }
  return updateSet(set.id, (s) => ({
    ...s,
    source: sourceOf(style),
    batches: [...s.batches, batch],
    status: "queued",
    doneAt: undefined,
    stopping: undefined,
  }))
}

const sourceOf = (style: Style) => ({
  listingId: 0,
  title: `${style.name} · Autonomous scale`,
  image: "",
  url: `/styles/${style.id}`,
  shop: null,
})

/** The board's images as the set's posters: new ones are copied in, the first one is its photo. */
async function syncBoard(set: GenerationSet, style: Style) {
  const known = new Set(set.style?.files ?? [])
  const fresh = style.images.filter((i) => !known.has(i.file))
  const start = set.style?.files.length ?? 0
  const added: ExtractedPoster[] = []
  for (const [k, image] of fresh.entries()) {
    const file = `poster-${start + k + 1}-${Date.now().toString(36)}.jpg`
    await saveFile(set.id, file, await getFile(fileKey(style.id, image.file)))
    added.push({ index: start + k, status: "done", file, width: image.width, height: image.height })
  }
  let original = set.original
  if (original.status !== "done" && style.images[0]) {
    const file = `source-${Date.now().toString(36)}.jpg`
    await saveFile(set.id, file, await getFile(fileKey(style.id, style.images[0].file)))
    original = { status: "done", file, width: style.images[0].width, height: style.images[0].height }
  }
  return updateSet(set.id, (s) => ({
    ...s,
    original,
    extraction: { status: "done", file: null },
    layout: "set",
    posters: [...s.posters, ...added],
    style: { id: style.id, name: style.name, files: [...(s.style?.files ?? []), ...fresh.map((i) => i.file)] },
  }))
}

/** Before a run: the board studied, and each poster named and described from the study (no reading of its own). */
export async function prepareAuto(id: string) {
  const set = await getSet(id)
  if (!set.style) return
  const study = await ensureStudy(set.style.id)
  const cards = new Map(study.files.map((file, i) => [file, study.images[i]]))
  await updateSet(id, (s) => ({
    ...s,
    posters: s.posters.map((p) => {
      const card = cards.get(s.style?.files[p.index] ?? "")
      return card ? { ...p, label: card.title, analysis: analysisOf(card, study) } : p
    }),
  }))
}

function analysisOf(card: StudyImage, study: StyleStudy): PosterAnalysis {
  return {
    summary: `${card.title}: ${card.subject}`,
    subject: card.subject,
    setting: card.scene,
    action: "",
    style: card.rendering,
    palette: card.palette,
    composition: card.composition,
    typography: card.text,
    mood: card.emotion,
    audience: "",
    hook: study.essence,
    swaps: {
      subjects: study.world.subjects.slice(0, 6),
      settings: study.world.settings.slice(0, 6),
      props: study.world.props.slice(0, 6),
    },
  }
}

/** The posters an Autonomous scale batch asks for, waiting to be planned. */
export function expandAuto(batch: Batch): Output[] {
  const now = new Date().toISOString()
  return spread(batch.auto?.count ?? 0, batch.auto?.levels ?? []).map(
    (creativity): Output => ({
      id: newId(),
      status: "pending",
      file: null,
      batch: batch.id,
      review: null,
      createdAt: now,
      poster: 0,
      mode: "idea",
      creativity,
      auto: true,
    })
  )
}

// --- Planning ---

type Plan = { level: string; anchor: number; refs: number[]; title: string; brief: string }

/** Plans the set's waiting Autonomous scale posters, a few at a time; `dispatch` sends each few out once planned. */
export async function planAuto(id: string, dispatch: (outputs: string[]) => Promise<unknown>) {
  let set = await getSet(id)
  if (!set.style) return
  const todo = set.outputs.filter((o) => o.auto && o.status === "pending" && !o.brief)
  if (!todo.length) return
  const study = await ensureStudy(set.style.id)
  const board = await Promise.all(
    study.files.map(async (file, i) => {
      const at = set.style!.files.indexOf(file)
      const poster = set.posters.find((p) => p.index === at && p.file)
      const data = poster ? await readSetFile(id, poster.file!) : await getFile(fileKey(set.style!.id, file))
      return numbered(data, i + 1, study.files.length > 30 ? 384 : 512)
    })
  )
  for (let at = 0; at < todo.length; at += CHUNK) {
    set = await getSet(id)
    if (set.stopping) return
    const chunk = todo.slice(at, at + CHUNK)
    // Second tries share their first's brief.
    const made = set.outputs.filter((o) => o.auto && o.brief && !o.from)
    let plans: Plan[]
    try {
      plans = await planChunk(set, study, chunk.map((o) => o.creativity), made, board)
    } catch (error) {
      console.error(`Generation ${id}, planning autonomous posters:`, error)
      plans = chunk.map((o, i) => fallbackPlan(study, o.creativity, made.length + at + i))
    }
    const posterOf = (n: number) => {
      const index = set.style!.files.indexOf(study.files[n - 1] ?? "")
      return index < 0 ? 0 : index
    }
    await updateSet(id, (s) => ({
      ...s,
      outputs: s.outputs.map((o) => {
        const i = chunk.findIndex((c) => c.id === o.id)
        if (i < 0) return o
        const p = plans[i]
        return { ...o, title: p.title, brief: p.brief, poster: posterOf(p.anchor), refs: p.refs.map(posterOf) }
      }),
    }))
    await dispatch(chunk.map((o) => o.id))
  }
}

const LEVELS: Record<Creativity, string> = {
  minimal:
    "minimal — a sibling of its anchor: the same kind of subject in the same pose, scene, composition, colours and feeling, with two or three small, visible changes (a prop, the food or drink, a pattern, a background detail, the animal's markings or kind). Expressions, pose, energy, light and palette stay exactly the anchor's.",
  subtle:
    "subtle — the anchor's scene idea with one real change: a different character, OR a different prop or activity, OR a similar but different setting; composed the way the anchor is, in its colours.",
  low: "low — a remix within the series: the anchor's scene combined with an element of another board image (its character, setting or activity), in a fresh arrangement.",
  medium:
    "medium — a new scene from the series' world that isn't on the board: a character, setting and activity the anchor doesn't show (never the anchor's own setting or composition with another animal), composed the way the series composes.",
  high: "high — the artist's most inventive next poster: a surprising idea, situation or viewpoint (top-down, close-up, wide, through a doorway, a reflection…) built from the series' world, unlike any board image. A new idea and composition — never a new look or a new feeling.",
}

const PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    posters: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          level: { type: "STRING" },
          anchor: { type: "INTEGER" },
          refs: { type: "ARRAY", items: { type: "INTEGER" } },
          title: { type: "STRING" },
          brief: { type: "STRING" },
        },
        required: ["level", "anchor", "refs", "title", "brief"],
        propertyOrdering: ["level", "anchor", "refs", "title", "brief"],
      },
    },
  },
  required: ["posters"],
}

async function planChunk(set: GenerationSet, study: StyleStudy, levels: Creativity[], made: Output[], board: Buffer[]) {
  const numberOf = (poster: number) => study.files.indexOf(set.style!.files[poster] ?? "") + 1
  const used = new Map<number, number>()
  for (const o of made) used.set(numberOf(o.poster), (used.get(numberOf(o.poster)) ?? 0) + 1)
  const answer = await askJson<{ posters?: Partial<Plan>[] }>(
    planPrompt(set.style!.name, study, levels, made.map((o) => `${o.title ?? "Poster"}: ${o.brief}`), used),
    board,
    { schema: PLAN_SCHEMA, temperature: 1 }
  )
  const got = answer.posters ?? []
  const count = study.files.length
  const valid = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= count
  return levels.map((level, i): Plan => {
    const p = got[i]
    if (!p?.brief || !valid(p.anchor)) return fallbackPlan(study, level, made.length + i)
    const anchor = p.anchor as number
    const family = familyOf(study, anchor)
    // Two more of the anchor's hand when the family has them: the hand reads clearer from three.
    const refs = (p.refs ?? []).filter((n, k, all) => valid(n) && n !== anchor && all.indexOf(n) === k).slice(0, 2)
    const kin = (family?.images ?? []).filter((n) => n !== anchor && !refs.includes(n))
    const strongest = kin.toSorted((a, b) => (study.images[b - 1]?.strength ?? 0) - (study.images[a - 1]?.strength ?? 0))
    return {
      level,
      anchor,
      refs: [...refs, ...strongest].slice(0, 2),
      title: (p.title ?? "").trim().slice(0, 80) || "New poster",
      brief: p.brief.trim(),
    }
  })
}

const familyOf = (study: StyleStudy, n: number) => study.families.find((f) => f.images.includes(n))

/** A plan without Gemini: the strongest images in turn, with the level's own words. */
function fallbackPlan(study: StyleStudy, level: Creativity, k: number): Plan {
  const strong = study.images.toSorted((a, b) => b.strength - a.strength)
  const card = strong[k % strong.length]
  return {
    level,
    anchor: card.n,
    refs: familyOf(study, card.n)?.images.filter((n) => n !== card.n).slice(0, 1) ?? [],
    title: card.title,
    brief: `A new poster after image 1 (${card.title}: ${card.subject}), creativity ${LEVELS[level]}`,
  }
}

function planPrompt(name: string, study: StyleStudy, levels: Creativity[], made: string[], used: Map<number, number>) {
  const family = (n: number) => {
    const at = study.families.findIndex((f) => f.images.includes(n))
    return at < 0 ? "" : `family ${String.fromCharCode(65 + at)}, `
  }
  const most = Math.max(1, Math.ceil((levels.length * 1.5) / study.files.length))
  const busy = [...used.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])
  return [
    `You are the art director of a successful Etsy wall-art shop. The images are the board of our style "${name}" — ${study.files.length} best sellers, each numbered in a dark badge top left. We continue the series with NEW, ORIGINAL posters that a buyer can't tell apart from the board: the same look and the same feeling, new pictures.`,
    `The series (our study of every image):
${study.essence}
Emotion: ${study.emotion}
World — subjects: ${study.world.subjects.join("; ")}. Settings: ${study.world.settings.join("; ")}. Props: ${study.world.props.join("; ")}. Activities: ${study.world.activities.join("; ")}.
Compositions: ${study.compositions.join("; ")}.
Families (one hand each):
${study.families.map((f, i) => `${String.fromCharCode(65 + i)}. ${f.name} (images ${f.images.join(", ")}): ${f.look}`).join("\n")}
Keep: ${study.keep.join("; ")}.
Avoid: ${study.avoid.join("; ")}.`,
    `The board, image by image:\n${study.images.map((c) => `${c.n}. ${c.title} — ${c.subject}; ${c.scene}. Composition: ${c.composition}. Emotion: ${c.emotion}.${c.text ? ` Text: ${c.text}.` : ""} [${family(c.n)}strength ${c.strength}]`).join("\n")}`,
    `Task: plan ${levels.length} new posters, one per line below, each at its creativity level. An image model paints each from its anchor — the board image whose look it must match — and one or two more board images of the anchor's family. The creativity level says how far the PICTURE moves from the board; the look and the feeling never move.`,
    `Creativity levels:\n${[...new Set(levels)].map((l) => `- ${LEVELS[l]}`).join("\n")}`,
    `For every poster:
- Feeling: exactly the series' — the characters' expressions, body language and energy belong in it. Never quieter, sadder, darker, moodier, more dramatic or more serious than the board.
- Simplicity: about as many elements as the anchor; anything new is as simple as the anchor's own things (a library is a few shelves of colour blocks, not a hundred books).
- Look: never describe palette, light, texture or rendering — the painter takes all of that from the anchor. Name colours only for new objects, from the anchor's palette.
- Unique: each poster is a different picture — vary characters, settings, activities and compositions across the list. Medium and high posters differ from every other poster here and in "Already made" in their setting or activity, not just their animal (a lotus pool with another animal is a repeat); minimal, subtle and low ones never repeat another's combination.
- Plain words: describe things plainly (a pink tub, a lotus pool, a striped robe) — never words that ask for more detail or finish than the anchor has (intricate, detailed, ornate, elaborate, glossy, realistic, geometric patterns), unless the anchor has exactly that.
- Original: a new painting, never a copy of a board image; even a minimal sibling has its own visible changes.
- Lettering: only where the anchor has lettering — then new, short words in the same lettering; otherwise none.
- Anchor: the board image whose family and look fit the new picture best. Spread the anchors over the board: no anchor more than ${most} times in this list, strong images (strength 4–5) first. "refs": one or two other images of the anchor's family, never the anchor.
- It sells: instantly charming, funny or beautiful on its own, like the best images on the board.`,
    busy.length > 0 && `Anchors used often already (prefer others): ${busy.map(([n, k]) => `${n} (${k}×)`).join(", ")}.`,
    `Posters to plan, in order:\n${levels.map((l, i) => `${i + 1}. creativity ${l}`).join("\n")}`,
    // The latest in full, older ones by title: a long run still sees everything it made.
    made.length > 0 &&
      `Already made — every new poster must differ clearly from these:\n${[
        ...made.slice(0, -40).map((m) => `- ${m.split(": ")[0]}`),
        ...made.slice(-40).map((m) => `- ${m}`),
      ].join("\n")}`,
    `For each poster, in order: "level" (as given), "anchor" (board number), "refs" (board numbers), "title" (2–5 words), "brief" (3–5 sentences the painter follows: the subject and what it does, its expression and body language, the setting and props, the composition — viewpoint, framing, where the subject sits and how much of the canvas it fills — and the lettering, or "no lettering"). Write what the picture shows; the look comes from the anchor. Never name artists, shops, brands or copyrighted characters.`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

// --- Painting ---

const RULES = `Rules:
- Original work: paint every element new. Never reproduce a board image's exact composition, characters, linework or wording, and never include logos, brands, trademarks, signatures, watermarks, artist names or copyrighted characters.
- Any text must be new wording, spelled correctly and cleanly lettered; leave text out unless the description asks for it.
- Output only the flat artwork, front-on, filling the canvas edge to edge: no frame, mat, wall, room, mockup, hands, drop shadow or border that isn't part of the art.`

const LEVEL_LINES: Record<Creativity, string> = {
  minimal:
    "Make it a sibling of image 1: keep image 1's kind of subject, scene, composition and feeling, and change only what the description changes. It must not be a copy: those changes must be visible.",
  subtle: "Keep image 1's scene idea and the way it's composed; the description says what's different.",
  low: "The images give the look only: paint the scene described, not a scene from them.",
  medium: "The images give the look only: paint the new scene described, not a scene from them.",
  high: "The images give the look only: paint the new scene described, not a scene from them.",
}

/** What Nano Banana is told for one Autonomous scale poster; images: its anchor, then its refs. */
export function autoPrompt({
  level,
  brief,
  study,
  refs,
  feedback,
}: {
  level: Creativity
  brief: string
  study?: StyleStudy
  /** How many more board images follow the anchor. */
  refs: number
  feedback?: string
}) {
  const images = refs > 0 ? `Images 1–${refs + 1} are` : "Image 1 is"
  return [
    `${images} ${refs > 0 ? "posters" : "a poster"} by one artist, from a best-selling series. Paint one NEW poster for this series, by the same hand: it must hang next to image 1 as part of the same set.`,
    LEVEL_LINES[level],
    `The new poster: ${brief}`,
    [
      `Paint it exactly like image 1${refs > 0 ? ` (image${refs > 1 ? "s" : ""} 2${refs > 1 ? `–${refs + 1}` : ""} confirm the hand)` : ""} — look at it, don't interpret it:`,
      "- The same paint handling: brush strokes as big, loose and rough — or as flat and clean — as image 1's, at the same scale relative to the canvas; the same edges and outlines; the same surface. Where image 1 leaves things vague, leave them vague.",
      "- No refining, the usual mistake: no finer lines, no extra detail in fur, faces, patterns or backgrounds, no smoother blending, no thicker or crisper impasto, nothing glossier, sharper or more realistic than image 1. A new animal or object is painted as roughly and simply as image 1 paints its own.",
      "- Animals and figures exactly as image 1 paints them: fur as a few broad strokes or patches of colour, stripes and spots as rough dabs, faces simplified to a few marks — never a finely furred, realistic or cleanly illustrated animal.",
      "- The same palette as image 1 — its hues, their saturation and contrast, nothing brighter, more neon, darker or more muted — and the same kind of light.",
      "- The same flatness or depth of space as image 1.",
    ].join("\n"),
    study?.emotion && `Feeling: ${study.emotion} The new poster must feel exactly like the series.`,
    study?.keep.length && `Keep: ${study.keep.join("; ")}.`,
    study?.avoid.length && `Avoid: ${study.avoid.join("; ")}.`,
    feedback && `Notes for this painting (most important): ${feedback}`,
    RULES,
  ]
    .filter(Boolean)
    .join("\n\n")
}

/**
 * A second try at a poster that missed its series (styles/auto-check.ts):
 * the first try's picture stays, its painting is redone in the anchor's
 * hand. Painting it again from scratch, notes and all, came back just as
 * refined; Nano Banana keeps the hand far better when it repaints a picture
 * that's there than when it invents one.
 */
export function repaintPrompt({ refs, notes, study }: { refs: number; notes?: string; study?: StyleStudy }) {
  return [
    `Image 1 is our draft of a new poster for a best-selling series. Image 2${refs > 0 ? ` and image${refs > 1 ? "s" : ""} 3${refs > 1 ? `–${refs + 2}` : ""}` : ""} ${refs > 0 ? "are" : "is a"} poster${refs > 0 ? "s" : ""} from that series, by its artist.`,
    `The draft's picture is right — keep its subject, pose, expression, composition and where every colour sits. Its painting is wrong: it's tighter, finer and more detailed than the series.${notes ? ` ${notes}` : ""}`,
    [
      "Repaint image 1 completely, by the hand that painted image 2:",
      "- Image 2's brush strokes — as big, loose and rough, or as flat and clean, relative to the canvas — on every surface: fur, faces, objects, background.",
      "- As little detail as image 2: fur as broad strokes or patches, stripes and spots as rough dabs, faces in a few marks, backgrounds as simple colour areas.",
      "- Image 2's palette, saturation and light; the same flatness or depth of space.",
    ].join("\n"),
    study?.emotion && `Feeling: ${study.emotion}`,
    RULES,
  ]
    .filter(Boolean)
    .join("\n\n")
}

/** The prompt, images and shape Nano Banana paints an Autonomous scale poster from. */
export async function autoRequest(set: GenerationSet, output: Output) {
  const anchor = set.posters.find((p) => p.index === output.poster && p.file) ?? set.posters.find((p) => p.file)
  if (!anchor) throw new Error("Needs the board's images")
  // A second try after the wrong hand repaints the first in the anchor's; after the wrong feeling or a poor poster it starts over.
  const draft = output.from ? set.outputs.find((o) => o.id === output.from && o.auto && o.file) : undefined
  if (draft?.check && draft.check.style <= 5 && draft.check.feeling > 5 && draft.check.appeal > 4) {
    const ref = (output.refs ?? []).map((i) => set.posters.find((p) => p.index === i && p.file)).find((p) => !!p)
    const style = set.style ? await getStyle(set.style.id).catch(() => null) : null
    const images = await Promise.all([draft.file!, anchor.file!, ...(ref ? [ref.file!] : [])].map((f) => readSetFile(set.id, f)))
    const prompt = repaintPrompt({ refs: ref ? 1 : 0, notes: output.feedback, study: style?.study })
    return { prompt, images, aspect: draft.width && draft.height ? draft.width / draft.height : undefined }
  }
  const refs = (output.refs ?? [])
    .map((i) => set.posters.find((p) => p.index === i && p.file && p.index !== anchor.index))
    .filter((p): p is ExtractedPoster => !!p)
    .slice(0, 2)
  const style = set.style ? await getStyle(set.style.id).catch(() => null) : null
  const study = style?.study
  const images = await Promise.all([anchor, ...refs].map((p) => readSetFile(set.id, p.file!)))
  const prompt = autoPrompt({
    level: output.creativity,
    brief: output.brief ?? `A new poster for the series, creativity ${LEVELS[output.creativity]}`,
    study,
    refs: refs.length,
    feedback: output.feedback,
  })
  const aspect = anchor.width && anchor.height ? anchor.width / anchor.height : undefined
  return { prompt, images, aspect }
}
