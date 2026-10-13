import sharp from "sharp"

import { readDoc, readDocs, writeDoc } from "@/lib/db/documents"
import { enqueue, retry } from "@/lib/generation/run"
import { createSet, getSet, newId, saveFile, updateSet } from "@/lib/generation/storage"
import type { Creativity, ExtractedPoster, Output } from "@/lib/generation/types"
import { instanceId, isLive } from "@/lib/db/workers"
import { askJson } from "@/lib/mockups/gemini"
import { NotFoundError } from "@/lib/mockups/storage"
import { addImages, createStyle, fileKey, getStyle, pick, toGuide, updateStyle } from "@/lib/styles/storage"
import type { Style, StyleGuide } from "@/lib/styles/types"
import { getFile } from "@/lib/storage/files"

import { CITY_FOLDER } from "./generate"
import { cityText, styleText } from "./prompts"
import { rankingState } from "./ranking"
import { cropRefs, refCrop, readRefFile } from "./refs"
import {
  EMPTY_REQUEST,
  LAB_CITIES,
  TEST_CITIES,
  TEST_SIZES,
  type AutoRun,
  type AutoTest,
  type PaintStrategy,
  type RoundVerdict,
  type TestSize,
  type CityGuide,
  type CityStyleData,
  type Interview,
  type InterviewQuestion,
  type LabBlock,
  type LabRound,
  type RefMode,
  type StyleCandidate,
  type StyleVersion,
  type Suggestion,
} from "./studio-types"

// City styles (styles of kind "city"): made like any style from a moodboard,
// but read for how they show a place as well as for their art, and tried
// out in a lab before they make posters at scale. A lab round paints test
// posters in three blocks (cities from words, real city photos repainted,
// new cities after the board's own images); the interview asks about what
// to change with five answers each, 3 keeping it as it is, and five
// one-line suggestions can each be tried as a variant of the guide (1–5 at
// the top of the lab) to adopt, or to make a style of its own. Every guide
// the style had is kept as a version to go back to.

const ROUND = (id: string) => `citys/lab/${id}`

export const EMPTY_CITY: CityStyleData = { status: "draft", tags: [], guide: null, version: 0, history: [], candidates: [], modes: ["photo", "city"], rounds: [] }

const cityData = (style: Style): CityStyleData => ({ ...EMPTY_CITY, ...style.city })

export async function createCityStyle(name: string, tags: string[] = []): Promise<Style> {
  const style = await createStyle(name)
  return updateStyle(style.id, (s) => ({ ...s, kind: "city", city: { ...EMPTY_CITY, tags: cleanTags(tags) } }))
}

/** Makes a normal style a city style (or back): the board stays, the guide is read again. */
export async function setStyleKind(id: string, kind: "city" | "normal") {
  return updateStyle(id, (s) =>
    kind === "city" ? { ...s, kind: "city", city: s.city ?? { ...EMPTY_CITY } } : { ...s, kind: undefined }
  )
}

const cleanTags = (tags: string[]) => [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 24)).filter(Boolean))].slice(0, 8)

export async function patchCityStyle(id: string, change: { tags?: string[]; modes?: RefMode[]; status?: CityStyleData["status"]; paint?: PaintStrategy }) {
  return updateStyle(id, (s) => ({
    ...s,
    city: {
      ...cityData(s),
      ...(change.paint && { paint: change.paint }),
      ...(change.tags && { tags: cleanTags(change.tags) }),
      ...(change.modes && { modes: change.modes.filter((m) => m === "photo" || m === "city" || m === "composition") }),
      ...(change.status && { status: change.status }),
    },
  }))
}

// --- Reading the board ---

const STRING = { type: "STRING" }
const STRINGS = { type: "ARRAY", items: STRING }
const CITY_FIELDS = ["depiction", "landmarks", "cityComposition", "architecture", "sky", "surroundings", "people", "lettering", "balance", "avoid", "manner"] as const
const ART_FIELDS = ["medium", "technique", "palette", "lighting", "composition", "detail", "typography", "mood", "motifs", "do", "dont", "summary", "prompt"] as const

const GUIDE_SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["photo", "art"] },
    medium: STRING,
    technique: STRING,
    palette: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { hex: STRING, role: STRING }, required: ["hex", "role"], propertyOrdering: ["hex", "role"] },
    },
    lighting: STRING,
    composition: STRING,
    detail: STRING,
    typography: { type: "STRING", nullable: true },
    mood: STRING,
    motifs: STRINGS,
    do: STRINGS,
    dont: STRINGS,
    depiction: STRING,
    landmarks: STRING,
    cityComposition: STRING,
    architecture: STRING,
    sky: STRING,
    surroundings: STRING,
    people: STRING,
    lettering: STRING,
    balance: STRING,
    avoid: STRINGS,
    manner: STRING,
    summary: STRING,
    prompt: STRING,
  },
  required: ["kind", ...ART_FIELDS, ...CITY_FIELDS],
  propertyOrdering: ["kind", ...ART_FIELDS.filter((f) => f !== "summary" && f !== "prompt"), ...CITY_FIELDS, "summary", "prompt"],
}

const GUIDE_FIELDS = `First, kind: "photo" when the pictures are real photographs (however graded, faded, filtered or film-like: a look made with a camera), "art" when they are drawn, painted, vector or otherwise illustrated. A photo style is described as a photographer's look (grading, tone curve, tints, fade, grain, light, lens, mood) and new pictures in it are real photos, never illustrations; say so in medium, prompt, do and dont.

Part A, the art (subject-free, so it also applies to a poster of anything):
- medium, technique, lighting, composition, detail, mood: 1–3 precise sentences each.
- palette: 5–8 colours sampled from the images as hex, dominant first, each with its role.
- typography: how lettering looks and sits, or null when there is none.
- motifs: 3–8 recurring visual devices, not subjects.
- do: 4–7 checkable rules that keep a poster in this style. dont: 4–7 things that would break it, especially what image models do by default.
- summary: 2–3 sentences, the look at a glance.
- prompt: 80–140 words of art direction for an image model, imperative, subject-free, with the palette's hex codes.
Part B, how this style shows a place (1–3 concrete sentences each):
- depiction: what the picture is of (skyline, street scene, single landmark, aerial view, landscape) and how much of the place it takes in.
- landmarks: how landmarks are drawn, how many lead, how far they're simplified or exaggerated.
- cityComposition: the framing of a city poster: horizon line, foreground, layering, negative space, symmetry.
- architecture: how buildings, windows, roofs and streets are rendered.
- sky: the sky's treatment (flat, gradient, textured, clouds, sun, birds).
- surroundings: water, greenery, mountains, roads: how they're rendered.
- people: whether there are people, cars or boats, how many, how big, how drawn.
- lettering: whether the place's name is on the poster, in what lettering and where; or that there is none.
- balance: where it sits between a beautiful decorative poster and an exact record of the place.
- avoid: 3–6 things that would make a city poster in this style fail (generic skylines, wrong landmarks, photo realism, clutter…).
Part C, the manner:
- manner: 40–80 words in plain, evocative language, the way you would brief a gifted illustrator or photographer in one breath: the feel (e.g. playful, girlish, light, warm, joyful), the medium and how wet or dry it is, the line (e.g. "a quick clumsy black brush line"), the colours in words, how much paper or sky is left bare. No hex codes, no lists, no subjects. Describe this style in its own words; for a pink watercolour sketch style it might read: "A playful, girlish, hand-painted poster: light, warm and joyful. Soft pinks and mints, wet paint bleeding past a quick, clumsy black brush line, and plenty of bare cream paper."`

function readPrompt(name: string, count: number) {
  return `You are the art director of an Etsy shop selling city and travel posters. ${count === 1 ? "This image is" : `These ${count} images are`} the moodboard of a style called "${name}": posters whose look we want for a whole collection of places, from New York to a small town, a beach or a national park. Study ${count === 1 ? "it" : "them together"} and write the guide our illustrators and an image model follow so every new poster hangs seamlessly next to these.

Describe the shared visual language and the way it shows places, not the particular places. Where the images differ, describe what they share and the range.

${GUIDE_FIELDS}

Never name artists, studios, brands or copyrighted characters. Write in English.`
}

type Answer = Record<string, unknown>

const text = (v: unknown, max = 700) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const list = (v: unknown, max = 10) => (Array.isArray(v) ? v : []).map((x) => text(x, 240)).filter(Boolean).slice(0, max)

function toCity(a: Answer): CityGuide {
  return {
    depiction: text(a.depiction),
    landmarks: text(a.landmarks),
    composition: text(a.cityComposition ?? a.composition),
    architecture: text(a.architecture),
    sky: text(a.sky),
    surroundings: text(a.surroundings),
    people: text(a.people),
    lettering: text(a.lettering),
    balance: text(a.balance),
    avoid: list(a.avoid, 8),
    ...(text(a.manner) && { manner: text(a.manner, 700) }),
  }
}

/** Reads a city style's board for its art and its way with places; what run in understand.ts does for city styles. */
export async function readCityGuide(style: Style, images: Buffer[]) {
  const answer = await askJson<Answer>(readPrompt(style.name, images.length), images, { schema: GUIDE_SCHEMA, temperature: 0.4 })
  const guide = toGuide(answer)
  if (!guide) throw new Error("Gemini sent back an empty guide — try again")
  return { guide, city: toCity(answer), medium: answer.kind === "photo" ? ("photo" as const) : ("art" as const) }
}

/** Stores a freshly read guide as the style's next version. */
export function withVersion(style: Style, guide: StyleGuide, city: CityGuide, note: string, round?: string, medium?: CityStyleData["medium"]): Style {
  const data = { ...cityData(style), ...(medium && { medium }) }
  const version: StyleVersion = { id: newId(), number: data.version + 1, guide, city, note, ...(round && { round }), at: new Date().toISOString() }
  return { ...style, guide, city: { ...data, guide: city, version: version.number, history: [...data.history, version].slice(-40) } }
}

// --- Lab rounds ---

export type RoundRequest = {
  blocks: LabBlock[]
  candidate?: string
  delivery: "now" | "batch"
  cities?: Partial<Record<LabBlock, string[]>>
  /** Cities from words that get a set (city → how many pictures, 3 or more) instead of one poster. */
  sets?: Record<string, number>
  /** The "new ideas" run the round belongs to. */
  batch?: string
}

/** The real photos the photo block repaints: the best photo reference of each of its cities, taken out of its poster. */
async function labPhotos(cities: readonly string[]) {
  const state = await rankingState()
  const found: { city: string; listingId: number; shopId: number; image: string; title: string }[] = []
  for (const name of cities) {
    const place = state.ranking.places.find((p) => p.name.toLowerCase() === name.toLowerCase().split(",")[0].trim())
    const entries = place ? (state.index.get(place.id) ?? []) : []
    const photo = entries.find((e) => (e.look === "photo" || (e.look === "unknown" && e.labels.some((l) => /real|black/i.test(l)))) && e.kind === "place")
    if (photo?.listing.images[0]) found.push({ city: name, listingId: photo.listing.id, shopId: photo.shopId, image: photo.listing.images[0], title: photo.listing.title })
  }
  // Taken out of their posters now, if the Stealer hadn't yet.
  await cropRefs(found.map((f) => ({ listingId: f.listingId, shopId: f.shopId, image: f.image, title: f.title })))
  for (let tries = 0; tries < 30; tries++) {
    const crops = await Promise.all(found.map((f) => refCrop(f.listingId)))
    if (crops.every((c) => c?.status === "done" || c?.status === "error")) break
    await new Promise((r) => setTimeout(r, 3000))
  }
  const ready: { city: string; image: Buffer }[] = []
  for (const f of found) {
    const crop = await refCrop(f.listingId)
    const print = crop?.status === "done" ? crop.prints[0] : null
    if (print) ready.push({ city: f.city, image: await readRefFile(f.listingId, print.file) })
  }
  return ready
}

export async function labRounds(styleId: string): Promise<(LabRound & { status: "preparing" | "painting" | "done" })[]> {
  const style = await getStyle(styleId)
  const rounds = await Promise.all(cityData(style).rounds.slice(0, 20).map((id) => readDoc<LabRound | null>(ROUND(id), null)))
  return Promise.all(
    rounds
      .filter((r): r is LabRound => !!r)
      .map(async (round) => {
        if (!round.set) return { ...round, status: "preparing" as const }
        const set = await getSet(round.set).catch(() => null)
        // Its set was deleted (stopped by hand, or every image of it reset): nothing left to show.
        if (!set) return null
        const images = round.images.flatMap((img) => {
          const o = set?.outputs.find((x) => x.id === img.output)
          // Its output is gone (Reset fails cleared it): so is the image.
          if (set && !o) return []
          return [o ? { ...img, status: o.status, file: o.file ?? undefined, error: o.error } : img]
        })
        // Every image cleared: the round has nothing left to show.
        if (round.images.length && !images.length) return null
        const busy = images.some((i) => i.status === "pending" || i.status === "running")
        return { ...round, images, status: busy ? ("painting" as const) : ("done" as const) }
      })
  ).then((list) => list.filter((r) => r !== null))
}

/** Starts a test round: its set is prepared in the background (the photo block's photos taken out first) and painted. */
export async function startRound(styleId: string, request: RoundRequest): Promise<LabRound> {
  const style = await getStyle(styleId)
  if (!style.images.length) throw new Error("Add images to the board first")
  const data = cityData(style)
  const candidate = request.candidate ? data.candidates.find((c) => c.id === request.candidate) : undefined
  if (request.candidate && !candidate) throw new Error("That variant is gone")
  const round: LabRound = {
    id: newId(),
    styleId,
    version: data.version,
    ...(candidate && { candidate: candidate.id }),
    set: "",
    images: [],
    ...(request.batch && { batch: request.batch }),
    at: new Date().toISOString(),
  }
  await writeDoc(ROUND(round.id), round)
  await updateStyle(styleId, (s) => {
    const d = cityData(s)
    return {
      ...s,
      city: {
        ...d,
        rounds: [round.id, ...d.rounds],
        candidates: candidate ? d.candidates.map((c) => (c.id === candidate.id ? { ...c, round: round.id } : c)) : d.candidates,
      },
    }
  })
  void prepare(style, round, request).catch((error) => console.error(`Lab round ${round.id}:`, error))
  return round
}

async function prepare(style: Style, round: LabRound, request: RoundRequest) {
  const cities = { ...LAB_CITIES, ...request.cities }
  const blocks = new Set(request.blocks)
  const set = await createSet("poster", CITY_FOLDER, { listingId: 0, title: `${style.name} · lab`, image: "", url: "", shop: null }, {
    variants: { count: 0, creativity: ["medium"], styleId: null },
    ideas: { count: 0, creativity: ["medium"] },
  })

  const photos = blocks.has("photo") ? await labPhotos(cities.photo ?? []) : []
  const posters: ExtractedPoster[] = []
  for (const [index, p] of photos.entries()) {
    const file = `poster-${index + 1}-${Date.now().toString(36)}.jpg`
    await saveFile(set.id, file, p.image)
    const meta = await sharp(p.image).metadata()
    posters.push({ index, status: "done", file, width: meta.width, height: meta.height, label: p.city })
  }

  const now = new Date().toISOString()
  const outputs: Output[] = []
  const images: LabRound["images"] = []
  const add = (block: LabBlock, city: string, poster: number, refs?: string[], inSet?: { index: number; size: number }) => {
    const id = newId()
    const creativity: Creativity = block === "photo" ? "low" : "medium"
    outputs.push({
      id,
      status: "pending",
      file: null,
      poster,
      batch: "lab",
      mode: "variant",
      creativity,
      styleId: style.id,
      review: null,
      createdAt: now,
      city: { kind: "lab", block, target: city, styleId: style.id, ...(refs && { refs }), ...(round.candidate && { candidate: round.candidate }), ...(inSet && { set: inSet }) },
    })
    images.push({ id: newId(), block, city, output: id, status: "pending", ...(refs && { refs }), ...(inSet && { set: inSet }) })
  }
  if (blocks.has("prompt")) {
    for (const city of cities.prompt ?? []) {
      const size = request.sets?.[city] ?? 0
      if (size >= 3) for (let index = 0; index < size; index++) add("prompt", city, -1, undefined, { index, size })
      else add("prompt", city, -1)
    }
  }
  if (blocks.has("photo")) photos.forEach((p, i) => add("photo", p.city, i))
  if (blocks.has("references")) {
    // Three after one board image, two after two, each a new city.
    const board = pick(style.images, Math.min(style.images.length, 7)).map((i) => i.file)
    const refs = [[board[0]], [board[1 % board.length]], [board[2 % board.length]], [board[3 % board.length], board[4 % board.length]], [board[5 % board.length], board[6 % board.length]]]
    ;(cities.references ?? []).slice(0, 5).forEach((city, i) => add("references", city, -1, [...new Set(refs[i])]))
  }

  await updateSet(set.id, (s) => ({
    ...s,
    city: { placeId: `lab-${style.id}`, place: `${style.name} lab`, country: "", lab: { styleId: style.id, round: round.id } },
    original: { status: "done", file: null },
    extraction: { status: "done", file: null },
    posters,
    batches: [
      {
        id: "lab",
        options: { variants: { count: 0, creativity: ["medium"], styleId: null }, ideas: { count: 0, creativity: ["medium"] } },
        createdAt: now,
        expanded: true,
        city: { ...EMPTY_REQUEST, delivery: request.delivery },
      },
    ],
    outputs,
  }))
  await writeDoc(ROUND(round.id), { ...round, set: set.id, images })
  enqueue(set.id)
}

/** Paints a round's failed test posters again (in batch: online when there's room, else in a batch job). */
export async function retryRound(roundId: string) {
  const round = await readDoc<LabRound | null>(ROUND(roundId), null)
  if (!round?.set) throw new NotFoundError("Unknown round")
  await retry(round.set, "batch")
}

export async function rateLabImage(roundId: string, imageId: string, rating: "up" | "down" | null) {
  const round = await readDoc<LabRound | null>(ROUND(roundId), null)
  if (!round) throw new NotFoundError("Unknown round")
  await writeDoc(ROUND(roundId), {
    ...round,
    images: round.images.map((i) => (i.id === imageId ? { ...i, rating: rating ?? undefined } : i)),
  })
}

// --- Interview and suggestions ---

const INTERVIEW_SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          aspect: STRING,
          question: STRING,
          options: { type: "ARRAY", items: STRING },
          recommended: { type: "INTEGER" },
          why: STRING,
        },
        required: ["aspect", "question", "options", "recommended", "why"],
        propertyOrdering: ["aspect", "question", "options", "recommended", "why"],
      },
    },
    suggestions: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { aspect: STRING, text: STRING }, required: ["aspect", "text"], propertyOrdering: ["aspect", "text"] },
    },
  },
  required: ["questions", "suggestions"],
}

function guideText(style: Style) {
  const data = cityData(style)
  return style.guide ? styleText(style.guide, data.guide) : "(not read yet)"
}

/**
 * The lab's questions about the latest round (or the board alone): six to
 * eight, each with five answers from one end to the other, the middle one
 * keeping it as it is, a recommended one; and five one-line suggestions.
 */
export async function interview(styleId: string, roundId?: string) {
  const style = await getStyle(styleId)
  const rounds = await labRounds(styleId)
  const round = roundId ? rounds.find((r) => r.id === roundId) : rounds.find((r) => r.status === "done" && !r.candidate)
  const tested = round ? round.images.filter((i) => i.status === "done" && i.file).slice(0, 10) : []
  const set = round?.set ? await getSet(round.set).catch(() => null) : null
  const images: Buffer[] = []
  for (const img of tested) {
    if (!set || !img.file) continue
    images.push(await getFile(`generations/${set.id}/${img.file}`).then(small))
  }
  const board = await Promise.all(pick(style.images, 4).map((i) => getFile(fileKey(styleId, i.file)).then(small)))
  const ratings = tested.filter((i) => i.rating).map((i) => `${i.city} (${i.block}): ${i.rating === "up" ? "liked" : "disliked"}`)
  const answer = await askJson<{ questions?: { aspect?: string; question?: string; options?: string[]; recommended?: number; why?: string }[]; suggestions?: { aspect?: string; text?: string }[] }>(
    `You run the test lab for a city poster style called "${style.name}". The first ${board.length} images are its moodboard: the look to hit exactly.${images.length ? ` The next ${images.length} are test posters painted in it: ${tested.map((t, i) => `${board.length + i + 1}: ${t.city} (${t.block === "prompt" ? "from words" : t.block === "photo" ? "from a real photo" : "after board images"})`).join("; ")}.` : ""}

Its current guide:
${guideText(style)}
${ratings.length ? `\nThe shop owner rated: ${ratings.join("; ")}.\n` : ""}
Compare the test posters with the moodboard as a demanding art director would: where do they miss the style (palette, linework, texture, material, composition, sky, people, lettering, level of detail), and where do they miss the places (recognisable landmarks, right skyline, character of the town, beach or park)? Also judge whether they are beautiful posters people want on their wall.

Return:
- questions: 6 to 8, each about one aspect (composition, colour, material, lines, detail, sky, people, lettering, landmarks, mood…). "question" asks what the shop owner wants, in one short sentence. "options" are exactly 5 answers going from one end to the other (e.g. "Much calmer, fewer elements" … "Much busier, more elements"), option 3 is always "Keep as it is". "recommended" is the option you would pick (1–5; it may well be 3) and "why" says in one sentence what you saw.
- suggestions: exactly 5, each one sentence of at most 14 words, concrete and different from each other, each with its aspect. The first three are targeted fixes where the test posters miss the board (bringing them closer to it: line, detail, colour, figures, composition). The last two are interesting changes that would make the style even more beautiful or sellable without losing what it is.`,
    [...board, ...images],
    { schema: INTERVIEW_SCHEMA, temperature: 0.6 }
  )
  const questions: InterviewQuestion[] = (answer.questions ?? [])
    .filter((q) => q.question && Array.isArray(q.options) && q.options.length >= 5)
    .slice(0, 8)
    .map((q) => {
      const options = q.options!.slice(0, 5).map((o) => text(o, 80)) as InterviewQuestion["options"]
      options[2] = "Keep as it is"
      return {
        id: newId(),
        aspect: text(q.aspect, 30) || "style",
        question: text(q.question, 160),
        options,
        recommended: Math.min(5, Math.max(1, Math.round(q.recommended ?? 3))),
        why: text(q.why, 240),
      }
    })
  const suggestions: Suggestion[] = (answer.suggestions ?? [])
    .filter((s) => s.text)
    .slice(0, 5)
    .map((s) => ({ id: newId(), text: text(s.text, 140), aspect: text(s.aspect, 30) }))
  const fresh: Interview = { ...(round && { round: round.id }), questions, at: new Date().toISOString() }
  return updateStyle(styleId, (s) => ({ ...s, city: { ...cityData(s), interview: fresh, suggestions } }))
}

const small = (data: Buffer) => sharp(data).resize(768, 768, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()

// --- Revising the guide ---

/** The guide rewritten as `ask` says, the rest kept: what answers and suggestions both come down to. */
async function revise(style: Style, ask: string, base?: { guide: StyleGuide; city: CityGuide }) {
  const data = cityData(style)
  const current = base ?? (style.guide && data.guide ? { guide: style.guide, city: data.guide } : null)
  if (!current) throw new Error("Read the board first")
  const board = await Promise.all(pick(style.images, 4).map((i) => getFile(fileKey(style.id, i.file)).then(small)))
  const answer = await askJson<Answer>(
    `You keep the guide of a city poster style called "${style.name}" (its moodboard attached). Rewrite the guide so it does what the shop owner asks, and keep everything else exactly as it is: same palette unless colour is asked about, same medium unless material is asked about. The moodboard stays the look's anchor; the change moves the style deliberately, never into something generic.

THE GUIDE NOW
${styleText(current.guide)}
${cityText(current.city)}

WHAT TO CHANGE
${ask}

Return the whole guide, every field, rewritten where the change needs it:
${GUIDE_FIELDS}`,
    board,
    { schema: GUIDE_SCHEMA, temperature: 0.5 }
  )
  const guide = toGuide(answer)
  if (!guide) throw new Error("Gemini sent back an empty guide — try again")
  return { guide, city: toCity(answer) }
}

/** Applies the interview's answers (question id → 1–5) to the main guide as its next version. */
export async function applyAnswers(styleId: string, answers: Record<string, number>, notes?: string) {
  const style = await getStyle(styleId)
  const data = cityData(style)
  const changes = (data.interview?.questions ?? [])
    .filter((q) => answers[q.id] && answers[q.id] !== 3)
    .map((q) => `- ${q.aspect}: ${q.options[answers[q.id] - 1]} (asked: ${q.question})`)
  if (!changes.length && !notes?.trim()) throw new Error("Every answer keeps it as it is")
  const ask = [changes.join("\n"), notes?.trim() && `Also: ${notes.trim()}`].filter(Boolean).join("\n")
  const revised = await revise(style, ask)
  const note = [changes.map((c) => c.replace(/^- /, "").replace(/ \(asked:.*\)$/, "")).join("; "), notes?.trim()].filter(Boolean).join("; ")
  return updateStyle(styleId, (s) => {
    const next = withVersion(s, revised.guide, revised.city, `Interview: ${note}`)
    return { ...next, city: { ...cityData(next), interview: undefined } }
  })
}

const MAX_CANDIDATES = 8

export type CandidateGroup = { suggestions: string[]; free?: string }

/**
 * Turns groups of suggestions into variants of the guide: one variant per
 * group with all of its changes at once (pick three suggestions, get one
 * version with those three), each tried in a quick round of its own.
 */
export async function tryCandidates(styleId: string, groups: CandidateGroup[], delivery: "now" | "batch" = "now", size: TestSize = "middle") {
  const style = await getStyle(styleId)
  const data = cityData(style)
  const asks = groups
    .map((g) => [...(data.suggestions ?? []).filter((s) => g.suggestions.includes(s.id)).map((s) => s.text), ...(g.free?.trim() ? [g.free.trim()] : [])])
    .filter((list) => list.length)
  if (!asks.length) throw new Error("Pick a suggestion")
  if (data.candidates.length + asks.length > MAX_CANDIDATES) throw new Error(`At most ${MAX_CANDIDATES} variants at once: adopt or drop some first`)
  const made: StyleCandidate[] = []
  for (const list of asks) {
    const revised = await revise(style, list.map((a) => `- ${a}`).join("\n"))
    made.push({ id: newId(), label: list.join(" · "), guide: revised.guide, city: revised.city, at: new Date().toISOString() })
  }
  const used = groups.flatMap((g) => g.suggestions)
  await updateStyle(styleId, (s) => {
    const d = cityData(s)
    return { ...s, city: { ...d, candidates: [...d.candidates, ...made], suggestions: (d.suggestions ?? []).filter((x) => !used.includes(x.id)) } }
  })
  for (const candidate of made) await startRound(styleId, { ...sizedRound(size), candidate: candidate.id, delivery })
  return getStyle(styleId)
}

/** A quick round: a few places from words, two or three. */
export const sizedRound = (size: TestSize) => ({ blocks: ["prompt"] as LabBlock[], cities: { prompt: TEST_CITIES.slice(0, TEST_SIZES[size]) } })

/** Waits for a round to be painted (or for `timeout`); answers it as it then stands. */
async function waitForRound(styleId: string, roundId: string, timeout = 30 * 60_000) {
  for (const until = Date.now() + timeout; ; ) {
    const round = (await labRounds(styleId).catch(() => [])).find((r) => r.id === roundId)
    if (!round || round.status === "done" || Date.now() > until) return round ?? null
    await new Promise((r) => setTimeout(r, 8000))
  }
}

// --- The judge ---

const VERDICT_SCHEMA = {
  type: "OBJECT",
  properties: {
    style: { type: "NUMBER" },
    composition: { type: "NUMBER" },
    place: { type: "NUMBER" },
    misses: STRINGS,
    fixes: STRINGS,
  },
  required: ["style", "composition", "place", "misses", "fixes"],
  propertyOrdering: ["misses", "style", "composition", "place", "fixes"],
}

/** The lab's judge: the round's posters next to the board, scored, with what misses and how to fix it in the guide. */
export async function judgeRound(style: Style, round: LabRound): Promise<RoundVerdict | null> {
  const done = round.images.filter((i) => i.status === "done" && i.file).slice(0, 8)
  if (!done.length) return null
  const board = await Promise.all(pick(style.images, 4).map((i) => getFile(fileKey(style.id, i.file)).then(small)))
  const tests = await Promise.all(done.map((i) => getFile(`generations/${round.set}/${i.file}`).then(small)))
  const a = await askJson<{ style?: number; composition?: number; place?: number; misses?: string[]; fixes?: string[] }>(
    `You are the most demanding art director of a city poster shop. The first ${board.length} images are the moodboard of the style "${style.name}": the look to hit exactly. The next ${tests.length} are new test posters painted in it: ${done.map((t, i) => `${board.length + i + 1}: ${t.city}`).join("; ")}.

Compare them with the board as if they had to hang in the same collection, so close that nobody could tell which posters are new. Look at: line weight, wobble and darkness; how much detail and how many elements; how colour is laid in (washes, crayon, flat) and how saturated; the palette; the paper and how much of it is bare; how people, cars, trees and buildings are drawn; skies; lettering and signs; and whether each poster is a beautiful, well-composed poster of a recognisable place.

Return:
- misses: up to 6 concrete differences from the board, most important first (e.g. "lines are thin and even; the board's are thick, wobbly black marker").
- style: 0–10, how exactly they hit the board's style (10: indistinguishable).
- composition: 0–10, how good the compositions are as posters.
- place: 0–10, how recognisable and true the places are.
- fixes: 3–6 precise instructions for rewriting the style guide so the next posters close these gaps (what to say about line, detail, colouring, palette, paper, figures, composition). Concrete and checkable.
Be honest and strict: most first tries score 4–7.`,
    [...board, ...tests],
    { schema: VERDICT_SCHEMA, temperature: 0.2 }
  )
  const score = (v: unknown) => Math.max(0, Math.min(10, Math.round((Number(v) || 0) * 10) / 10))
  const verdict = { style: score(a.style), composition: score(a.composition), place: score(a.place) }
  return {
    ...verdict,
    overall: Math.round(((verdict.style * 2 + verdict.composition + verdict.place) / 4) * 10) / 10,
    misses: list(a.misses, 6),
    fixes: list(a.fixes, 6),
  }
}

// --- Autonomous testing ---

const running = new Set<string>()

/** The style's autonomous test as it stands; one left running by a server that has stopped reads as stopped. */
export async function autoTestOf(style: Style): Promise<AutoTest | undefined> {
  const test = cityData(style).autotest
  if (test?.status === "running" && test.runner !== instanceId && !(await isLive(test.runner))) return { ...test, status: "stopped", step: "Stopped with the server that ran it" }
  return test
}

function patchAutoTest(styleId: string, change: (test: AutoTest) => AutoTest) {
  return updateStyle(styleId, (s) => {
    const d = cityData(s)
    return d.autotest ? { ...s, city: { ...d, autotest: change(d.autotest) } } : s
  })
}

/**
 * Lets the lab hit the style by itself: it paints the main guide on a few
 * places, judges the posters against the board, rewrites the guide two ways
 * from the judge's fixes, paints and judges those, keeps the best and goes
 * on, `passes` times. The best guide becomes the main one when it beats the
 * start (the old one stays in the history). Sync, `size` posters a guide.
 */
export async function startAutoTest(styleId: string, { size = "small", passes = 3, delivery = "now" }: { size?: TestSize; passes?: number; delivery?: "now" | "batch" } = {}) {
  const style = await getStyle(styleId)
  const data = cityData(style)
  if (!style.guide || !data.guide) throw new Error("Read the board first")
  const current = await autoTestOf(style)
  if (current?.status === "running" || running.has(styleId)) throw new Error("An autonomous test is running already")
  const test: AutoTest = {
    // "auto-": its variants and rounds are told apart from new ideas by it.
    id: `auto-${newId()}`,
    status: "running",
    size,
    passes: Math.max(1, Math.min(4, Math.round(passes))),
    step: "Painting the style as it is",
    runs: [],
    runner: instanceId,
    at: new Date().toISOString(),
  }
  // Variants an earlier test left behind (stopped, or its server gone) make room.
  await updateStyle(styleId, (s) => {
    const d = cityData(s)
    return { ...s, city: { ...d, autotest: test, candidates: d.candidates.filter((c) => !c.batch?.startsWith("auto-")) } }
  })
  running.add(styleId)
  void runAutoTest(styleId, test, delivery)
    .catch(async (error) => {
      console.error(`Autonomous test ${styleId}:`, error)
      await updateStyle(styleId, (s) => {
        const d = cityData(s)
        return d.autotest
          ? { ...s, city: { ...d, candidates: d.candidates.filter((c) => c.batch !== test.id), autotest: { ...d.autotest, status: "error", error: (error as Error).message, step: "Stopped by an error", finishedAt: new Date().toISOString() } } }
          : s
      }).catch(() => {})
    })
    .finally(() => running.delete(styleId))
  return getStyle(styleId)
}

export async function stopAutoTest(styleId: string) {
  return updateStyle(styleId, (s) => {
    const d = cityData(s)
    const t = d.autotest
    if (!t || t.status !== "running") return s
    // Its variants go with it; what it painted stays in the rounds.
    return { ...s, city: { ...d, candidates: d.candidates.filter((c) => c.batch !== t.id), autotest: { ...t, status: "stopped", step: "Stopped", finishedAt: new Date().toISOString() } } }
  })
}

async function runAutoTest(styleId: string, test: AutoTest, delivery: "now" | "batch") {
  const stopped = async () => (await getStyle(styleId).then((s) => cityData(s).autotest?.status !== "running").catch(() => true))
  const round = { ...sizedRound(test.size), delivery, batch: test.id }
  type Tried = AutoRun & { guide: StyleGuide; city: CityGuide; paint: PaintStrategy }

  // The style as it is.
  const style0 = await getStyle(styleId)
  const strategy0: PaintStrategy = cityData(style0).paint ?? "redraw"
  const first = await startRound(styleId, round)
  const main: Tried = { id: newId(), label: `The style as it is (${strategy0})`, pass: 0, round: first.id, paint: strategy0, guide: style0.guide!, city: cityData(style0).guide! }
  await patchAutoTest(styleId, (t) => ({ ...t, runs: [strip(main)] }))
  const painted = await waitForRound(styleId, first.id)
  if (await stopped()) return
  main.verdict = (painted && (await judgeRound(await getStyle(styleId), painted))) ?? undefined
  if (!main.verdict) throw new Error("The first round couldn't be painted")
  let best: Tried = main
  await patchAutoTest(styleId, (t) => ({ ...t, runs: [strip(main)], best: main.id }))

  for (let pass = 1; pass <= test.passes; pass++) {
    if (await stopped()) return
    await patchAutoTest(styleId, (t) => ({ ...t, step: `Pass ${pass} of ${t.passes}: writing new versions from the judge's notes` }))
    const style = await getStyle(styleId)
    const v = best.verdict!
    // Pass 1 tries the other way of painting with the same guide; every pass rewrites the guide from the notes.
    const plans: { label: string; paint: PaintStrategy; ask?: string }[] = [
      ...(pass === 1 ? [{ label: `Painted the other way (${best.paint === "redraw" ? "series" : "redraw"})`, paint: (best.paint === "redraw" ? "series" : "redraw") as PaintStrategy }] : []),
      { label: "The judge's fixes", paint: best.paint, ask: `Close these gaps to the moodboard, exactly:\n${v.fixes.map((f) => `- ${f}`).join("\n")}` },
      ...(pass > 1
        ? [
            {
              label: "Closer to the board, described literally",
              paint: best.paint,
              ask: `The test posters still miss the moodboard here:\n${v.misses.map((m) => `- ${m}`).join("\n")}\nRewrite the guide so the posters become indistinguishable from the board: describe the board's line, amount of detail, colouring, palette, paper and figures even more precisely and literally (also in "manner"), and keep the compositions simple, clear and beautiful.`,
            },
          ]
        : []),
    ]
    const variants: Tried[] = []
    for (const [i, plan] of plans.entries()) {
      const revised = plan.ask ? await revise(style, plan.ask, { guide: best.guide, city: best.city }).catch(() => null) : { guide: best.guide, city: best.city }
      if (!revised) continue
      const letter = "ABC"[i]
      const candidate: StyleCandidate = { id: newId(), name: `Auto ${pass}${letter}`, label: plan.label, batch: test.id, paint: plan.paint, guide: revised.guide, city: revised.city, at: new Date().toISOString() }
      await updateStyle(styleId, (s) => {
        const d = cityData(s)
        return { ...s, city: { ...d, candidates: [...d.candidates, candidate] } }
      })
      const r = await startRound(styleId, { ...round, candidate: candidate.id })
      variants.push({ id: newId(), label: `Pass ${pass} · ${letter}: ${plan.label}`, pass, candidate: candidate.id, round: r.id, paint: plan.paint, guide: revised.guide, city: revised.city })
    }
    await patchAutoTest(styleId, (t) => ({ ...t, step: `Pass ${pass} of ${t.passes}: painting ${variants.length} versions`, runs: [...t.runs, ...variants.map(strip)] }))
    for (const variant of variants) {
      const r = await waitForRound(styleId, variant.round!)
      if (await stopped()) return
      variant.verdict = (r && (await judgeRound(await getStyle(styleId), r))) ?? undefined
      if (variant.verdict && variant.verdict.overall > best.verdict!.overall) best = variant
    }
    await patchAutoTest(styleId, (t) => ({
      ...t,
      runs: t.runs.map((run) => {
        const judged = variants.find((x) => x.id === run.id)
        return judged ? strip(judged) : run
      }),
      best: best.id,
    }))
  }

  // The best guide and way of painting become the style's when they beat the start; the test's variants go.
  const start = main.verdict.overall
  const won = best.id !== main.id && best.verdict!.overall >= start + 0.3
  await updateStyle(styleId, (s) => {
    const base = won ? withVersion(s, best.guide, best.city, `Autonomous testing: ${start} → ${best.verdict!.overall} (${best.paint})`, best.round) : s
    const d = cityData(base)
    return {
      ...base,
      city: {
        ...d,
        ...(won && { paint: best.paint }),
        candidates: d.candidates.filter((c) => c.batch !== test.id),
        autotest: d.autotest && {
          ...d.autotest,
          status: "done",
          step: "Done",
          finishedAt: new Date().toISOString(),
          outcome: won
            ? `Style ${main.verdict!.style} → ${best.verdict!.style}, overall ${start} → ${best.verdict!.overall}, painted by ${best.paint}: adopted as version ${d.version}`
            : `No version beat the style as it is (overall ${start}): it stays as it was`,
        },
      },
    }
  })
}

const strip = ({ id, label, pass, candidate, round, verdict, paint }: AutoRun): AutoRun => ({ id, label, pass, ...(candidate && { candidate }), ...(round && { round }), ...(verdict && { verdict }), ...(paint && { paint }) })

// --- An interview after a fresh round ---

/**
 * Asks the interview on a round of the guide as it is now: when the main
 * guide has no finished round of its own yet, a quick one is painted first
 * (sync), then the lab looks at it next to the board and asks.
 */
export async function startInterview(styleId: string, size: TestSize = "middle") {
  const style = await getStyle(styleId)
  const data = cityData(style)
  if (!style.guide) throw new Error("Read the board first")
  const rounds = await labRounds(styleId)
  const fresh = rounds.find((r) => !r.candidate && r.version === data.version && r.status === "done" && r.images.some((i) => i.status === "done"))
  if (fresh) return interview(styleId, fresh.id)
  const round = await startRound(styleId, { ...sizedRound(size), delivery: "now" })
  await updateStyle(styleId, (s) => ({ ...s, city: { ...cityData(s), interviewing: { status: "testing", round: round.id, at: new Date().toISOString() } } }))
  void (async () => {
    const painted = await waitForRound(styleId, round.id)
    await updateStyle(styleId, (s) => ({ ...s, city: { ...cityData(s), interviewing: { status: "asking", round: round.id, at: new Date().toISOString() } } }))
    await interview(styleId, painted?.id)
    await updateStyle(styleId, (s) => ({ ...s, city: { ...cityData(s), interviewing: undefined } }))
  })().catch(async (error) => {
    console.error(`Interview ${styleId}:`, error)
    await updateStyle(styleId, (s) => ({ ...s, city: { ...cityData(s), interviewing: { status: "error", error: (error as Error).message, at: new Date().toISOString() } } })).catch(() => {})
  })
  return getStyle(styleId)
}

// --- New ideas: nearby directions ---

export type DirectionsRequest = {
  /** How many directions, 1 to 6. */
  count: number
  /** The cities each direction is painted on; `set` paints three pictures of the city instead of one. */
  cities: { name: string; set: boolean }[]
  delivery: "now" | "batch"
  /** The style itself painted on the same cities too, to compare. */
  main: boolean
}

const DIRECTIONS_SCHEMA = {
  type: "OBJECT",
  properties: {
    directions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { name: STRING, label: STRING, consistency: STRING, change: STRING },
        required: ["name", "label", "consistency", "change"],
        propertyOrdering: ["name", "label", "change", "consistency"],
      },
    },
  },
  required: ["directions"],
}

/**
 * New ideas for a style: `count` nearby but different styles, each kept as a
 * variant with what holds it together, and each painted on the same cities
 * (one poster each, or a set of three), next to the style itself. One the
 * shop owner likes becomes the main guide or a style of its own.
 */
export async function newDirections(styleId: string, request: DirectionsRequest) {
  const style = await getStyle(styleId)
  const data = cityData(style)
  if (!style.guide || !data.guide) throw new Error("Read the board first")
  const count = Math.max(1, Math.min(6, Math.round(request.count)))
  const cities = request.cities.map((c) => ({ name: c.name.trim().slice(0, 80), set: c.set })).filter((c) => c.name).slice(0, 6)
  if (!cities.length) throw new Error("Name at least one city")
  // Directions of an earlier run make room; variants made by hand stay.
  const kept = data.candidates.filter((c) => !c.batch)
  if (kept.length + count > MAX_CANDIDATES) throw new Error(`At most ${MAX_CANDIDATES} variants at once: adopt or drop some first`)

  const board = await Promise.all(pick(style.images, 4).map((i) => getFile(fileKey(style.id, i.file)).then(small)))
  const answer = await askJson<{ directions?: { name?: string; label?: string; consistency?: string; change?: string }[] }>(
    `You are the art director of a city poster shop. The images are the moodboard of a style called "${style.name}"; its guide is below. Propose ${count} new directions for it: NEARBY siblings of this exact style, not new styles. Someone who loves the original must love every one of them, and each could hang next to it as a related collection.
Every direction keeps: the medium family (ink and watercolour stays ink with watercolour, gouache or coloured pencil; a photo look stays a photo look), the lightness (light paper or sky, bright and airy: never dark, black or night backgrounds, never neon, never monochrome), the mood (as light, warm and joyful as the original) and its charm.
Every direction changes one or two things, moderately: the palette (e.g. pink and mint becomes peach and sky blue, or gains a lemon-yellow accent), the wash (drier crayon fill or wetter bleeding washes), the line (a thicker marker or a finer pen, more or less wobble), how much colour against bare paper, the skies (bare paper, a soft wash, little doodled clouds), the figures (stick figures or little dressed people), the amount of detail. The directions differ from each other; order them from the closest to the original to a little further.

THE GUIDE NOW
${styleText(style.guide)}
${cityText(data.guide)}

For each direction:
- name: 2–4 words.
- label: one sentence, what it changes against the style.
- change: precise instructions for rewriting the guide into this direction (medium, line, colour, palette with hex codes, paper, detail, skies, buildings, figures).
- consistency: two or three sentences on what holds every poster of this direction together so a series stays one collection: the line, the palette, the paper, how buildings, trees, people and skies are always drawn.`,
    board,
    { schema: DIRECTIONS_SCHEMA, temperature: 0.9 }
  )
  const proposed = (answer.directions ?? []).filter((d) => d.name && d.change).slice(0, count)
  if (!proposed.length) throw new Error("No directions came back, try again")

  const batch = newId()
  const made: StyleCandidate[] = []
  // Three guides rewritten at a time.
  for (let at = 0; at < proposed.length; at += 3) {
    const revised = await Promise.all(proposed.slice(at, at + 3).map((d) => revise(style, `${d.label}\n${d.change}`).then((r) => ({ d, r })).catch(() => null)))
    for (const item of revised) {
      if (!item) continue
      made.push({
        id: newId(),
        name: text(item.d.name, 60),
        label: text(item.d.label, 240),
        consistency: text(item.d.consistency, 600),
        batch,
        guide: item.r.guide,
        city: item.r.city,
        at: new Date().toISOString(),
      })
    }
  }
  if (!made.length) throw new Error("The directions couldn't be written, try again")
  await updateStyle(styleId, (s) => {
    const d = cityData(s)
    return { ...s, city: { ...d, candidates: [...d.candidates.filter((c) => !c.batch), ...made] } }
  })

  const names = cities.map((c) => c.name)
  const sets = Object.fromEntries(cities.filter((c) => c.set).map((c) => [c.name, 3]))
  const round = { blocks: ["prompt"] as LabBlock[], delivery: request.delivery, cities: { prompt: names }, sets, batch }
  if (request.main) await startRound(styleId, round)
  for (const candidate of made) await startRound(styleId, { ...round, candidate: candidate.id })
  return getStyle(styleId)
}

/** A variant becomes the main guide; the others are dropped (their rounds stay in the history). */
export async function adoptCandidate(styleId: string, candidateId: string) {
  return updateStyle(styleId, (s) => {
    const d = cityData(s)
    const candidate = d.candidates.find((c) => c.id === candidateId)
    if (!candidate) throw new NotFoundError("That variant is gone")
    const next = withVersion(s, candidate.guide, candidate.city, `Adopted variant: ${candidate.label}`, candidate.round)
    return { ...next, city: { ...cityData(next), candidates: [] } }
  })
}

export async function dropCandidate(styleId: string, candidateId: string) {
  return updateStyle(styleId, (s) => {
    const d = cityData(s)
    return { ...s, city: { ...d, candidates: d.candidates.filter((c) => c.id !== candidateId) } }
  })
}

/** A variant made a style of its own: the board copied, the variant's guide as its first version. */
export async function candidateAsStyle(styleId: string, candidateId: string, name: string) {
  const style = await getStyle(styleId)
  const d = cityData(style)
  const candidate = d.candidates.find((c) => c.id === candidateId)
  if (!candidate) throw new NotFoundError("That variant is gone")
  const fresh = await copyStyle(style, name, { guide: candidate.guide, city: candidate.city, note: `From ${style.name}: ${candidate.label}` })
  await dropCandidate(styleId, candidateId)
  return fresh
}

/** A copy of a style to try on in the lab (a confirmed style stays as it is). */
export async function duplicateStyle(styleId: string, name?: string) {
  const style = await getStyle(styleId)
  const d = cityData(style)
  return copyStyle(style, name ?? `${style.name} copy`, style.guide && d.guide ? { guide: style.guide, city: d.guide, note: `Copied from ${style.name}` } : null)
}

async function copyStyle(style: Style, name: string, start: { guide: StyleGuide; city: CityGuide; note: string } | null) {
  const fresh = await createCityStyle(name, cityData(style).tags)
  const images = await Promise.all(style.images.map(async (i) => ({ data: await getFile(fileKey(style.id, i.file)), from: `style/${style.id}/${i.file}` })))
  await addImages(fresh.id, images, { trim: true })
  return updateStyle(fresh.id, (s) => {
    const base = { ...s, city: { ...cityData(s), modes: cityData(style).modes }, guideEdited: !!start }
    return start ? { ...withVersion(base, start.guide, start.city, start.note), guideImages: base.images.map((i) => i.file) } : base
  })
}

/** Goes back to an earlier version (as the newest one, so nothing is lost). */
export async function restoreVersion(styleId: string, versionId: string) {
  return updateStyle(styleId, (s) => {
    const d = cityData(s)
    const version = d.history.find((v) => v.id === versionId)
    if (!version) throw new NotFoundError("Unknown version")
    return withVersion(s, version.guide, version.city, `Back to version ${version.number}`)
  })
}

/** Every city style, for pickers. */
export async function cityStyleList() {
  const styles = await readDocs<Style>("styles/", "/style")
  return [...styles.values()].filter((s) => s?.kind === "city")
}
