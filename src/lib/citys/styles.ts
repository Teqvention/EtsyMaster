import sharp from "sharp"

import { readDoc, readDocs, writeDoc } from "@/lib/db/documents"
import { enqueue, retry } from "@/lib/generation/run"
import { createSet, getSet, newId, saveFile, updateSet } from "@/lib/generation/storage"
import type { Creativity, ExtractedPoster, Output } from "@/lib/generation/types"
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

export async function patchCityStyle(id: string, change: { tags?: string[]; modes?: RefMode[]; status?: CityStyleData["status"] }) {
  return updateStyle(id, (s) => ({
    ...s,
    city: {
      ...cityData(s),
      ...(change.tags && { tags: cleanTags(change.tags) }),
      ...(change.modes && { modes: change.modes.filter((m) => m === "photo" || m === "city" || m === "composition") }),
      ...(change.status && { status: change.status }),
    },
  }))
}

// --- Reading the board ---

const STRING = { type: "STRING" }
const STRINGS = { type: "ARRAY", items: STRING }
const CITY_FIELDS = ["depiction", "landmarks", "cityComposition", "architecture", "sky", "surroundings", "people", "lettering", "balance", "avoid"] as const
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
- avoid: 3–6 things that would make a city poster in this style fail (generic skylines, wrong landmarks, photo realism, clutter…).`

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

export type RoundRequest = { blocks: LabBlock[]; candidate?: string; delivery: "now" | "batch"; cities?: Partial<Record<LabBlock, string[]>> }

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
  const add = (block: LabBlock, city: string, poster: number, refs?: string[]) => {
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
      city: { kind: "lab", block, target: city, styleId: style.id, ...(refs && { refs }), ...(round.candidate && { candidate: round.candidate }) },
    })
    images.push({ id: newId(), block, city, output: id, status: "pending", ...(refs && { refs }) })
  }
  if (blocks.has("prompt")) for (const city of cities.prompt ?? []) add("prompt", city, -1)
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
- suggestions: exactly 5 improvements, each one sentence of at most 14 words, concrete and different from each other, each with its aspect.`,
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

const MAX_CANDIDATES = 5

/** Turns suggestions (ids) or a free text into variants of the guide, each tried in a quick round of its own. */
export async function tryCandidates(styleId: string, suggestionIds: string[], free?: string, delivery: "now" | "batch" = "now") {
  const style = await getStyle(styleId)
  const data = cityData(style)
  const asks = [
    ...(data.suggestions ?? []).filter((s) => suggestionIds.includes(s.id)).map((s) => s.text),
    ...(free?.trim() ? [free.trim()] : []),
  ]
  if (!asks.length) throw new Error("Pick a suggestion")
  if (data.candidates.length + asks.length > MAX_CANDIDATES) throw new Error(`At most ${MAX_CANDIDATES} variants at once: adopt or drop some first`)
  const made: StyleCandidate[] = []
  for (const ask of asks) {
    const revised = await revise(style, ask)
    made.push({ id: newId(), label: ask, guide: revised.guide, city: revised.city, at: new Date().toISOString() })
  }
  await updateStyle(styleId, (s) => {
    const d = cityData(s)
    return { ...s, city: { ...d, candidates: [...d.candidates, ...made], suggestions: (d.suggestions ?? []).filter((x) => !suggestionIds.includes(x.id)) } }
  })
  // A quick round each: the cities from words, enough to see the change.
  for (const candidate of made) {
    await startRound(styleId, { blocks: ["prompt"], candidate: candidate.id, delivery, cities: { prompt: LAB_CITIES.prompt.slice(0, 4) } })
  }
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
