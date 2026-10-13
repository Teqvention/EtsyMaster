import type { StyleGuide } from "@/lib/styles/types"

import { isSkyId, LOOK_SKY, type SkyId } from "./skies"

// What the city studio makes posters with, and how it's asked to.
//
// City styles are styles (styles/<id>/style) of kind "city": a moodboard and
// the guide read off it, plus what the guide says about cities (how a city
// is shown, its landmarks, sky, people…), a lab of test rounds, the
// versions the guide went through and the variants being tried. Being
// styles, normal posters can be made in them too (their art only), and
// normal styles can make city posters (with the city added by the prompt).
//
// Inspirations are lighter: a look for real city photos (a sunset, a pink
// sky, seen from above), from a name and a few photos, that a real photo
// variant can take on without the city changing.

// --- City styles ---

/** What a city style's guide says about cities, on top of its art. */
export type CityGuide = {
  /** How a city is shown: what the picture is of, from where, how much of the city. */
  depiction: string
  /** How landmarks are drawn and how many lead. */
  landmarks: string
  /** Framing for a city poster: horizon, foreground, skyline or street, negative space. */
  composition: string
  architecture: string
  sky: string
  /** Water, streets, greenery: how the city's surroundings are rendered. */
  surroundings: string
  /** People, cars, boats: whether, how many, how drawn. */
  people: string
  /** Lettering on a city poster (the city's name?), or none. */
  lettering: string
  /** Where it sits between a beautiful poster and an exact record of the city. */
  balance: string
  avoid: string[]
  /**
   * The style's manner in a few plain, evocative sentences, as one would
   * brief a gifted illustrator: its feel, medium, line, colour and paper
   * ("playful, light and joyful; soft pinks and mints, wet paint, a quick
   * clumsy black brush line, plenty of bare paper"). Leads every painting.
   */
  manner?: string
}

export type StyleStatus = "draft" | "confirmed"

/** A guide as it stood at one point: the style's history, newest last. */
export type StyleVersion = {
  id: string
  /** 1, 2, 3… */
  number: number
  guide: StyleGuide
  city: CityGuide
  /** What changed to get here, in words ("Warmer palette, thicker outlines"). */
  note: string
  /** The lab round that tested it, if any. */
  round?: string
  at: string
}

/** A variant of the guide being tried next to the main one (at the top of the lab). */
export type StyleCandidate = {
  id: string
  /** A direction's short name ("Wet pink washes"). */
  name?: string
  /** The suggestion or answers it was made from, in a sentence. */
  label: string
  /** A direction: what holds every poster of it together (line, palette, paper, how buildings and people are drawn). */
  consistency?: string
  /** The "new ideas" run it came from, with the other directions of that run. */
  batch?: string
  /** How this variant is painted, when it differs from the style's. */
  paint?: PaintStrategy
  guide: StyleGuide
  city: CityGuide
  /** Its test round. */
  round?: string
  at: string
}

export const PAINT_STRATEGIES = ["redraw", "series"] as const
export type PaintStrategy = (typeof PAINT_STRATEGIES)[number]

/** How a style is asked to use the reference photo when posters are scaled. */
export type RefMode = "photo" | "city" | "composition"

export const REF_MODES: { value: RefMode; label: string; hint: string }[] = [
  { value: "photo", label: "From photo", hint: "Repaints the reference photo in the style: its view, its landmarks" },
  { value: "city", label: "City only", hint: "Paints the city from scratch in the style; the photo is only the city's name" },
  { value: "composition", label: "Composition", hint: "Reads the photo's composition, then paints it new from words only" },
]

export type CityStyleData = {
  status: StyleStatus
  /**
   * What the style's pictures are: real photographs with a look (a grading,
   * a light, a film), or drawn or painted art. A photo style makes real
   * photos whatever the reference is; an art style makes its art.
   */
  medium?: "photo" | "art"
  /**
   * How an art style is painted: "redraw" (the default) has the art director
   * pick the board poster whose composition fits each new one, and Nano
   * Banana redraws that poster as the new place, which keeps the hand far
   * closer than painting from scratch (13 Oct); "series" paints the next
   * poster of the series from a few board posters. Autonomous testing
   * compares them and keeps the better.
   */
  paint?: PaintStrategy
  /** Groups the style is filed under ("cartoon", "funky", "drawn"). */
  tags: string[]
  guide: CityGuide | null
  version: number
  history: StyleVersion[]
  candidates: StyleCandidate[]
  /** How it uses reference photos when scaling, by default. */
  modes: RefMode[]
  /** The latest interview and suggestions the lab made. */
  interview?: Interview
  suggestions?: Suggestion[]
  /** An interview on its way: a fresh test round painted first, then the questions. */
  interviewing?: { status: "testing" | "asking" | "error"; round?: string; error?: string; at: string }
  /** The latest autonomous test. */
  autotest?: AutoTest
  /** Lab rounds, newest first (citys/lab/<round>). */
  rounds: string[]
}

// --- The lab ---

/** One question of the interview: five answers on a scale, 3 is "keep it". */
export type InterviewQuestion = {
  id: string
  /** What it's about: composition, colour, material, lines, people… */
  aspect: string
  question: string
  /** Five answers from one end to the other; the middle one keeps it as it is. */
  options: [string, string, string, string, string]
  /** The answer (1–5) the lab would pick, and why. */
  recommended: number
  why: string
}

export type Interview = { round?: string; questions: InterviewQuestion[]; at: string }

/** A one-sentence improvement the lab suggests. */
export type Suggestion = { id: string; text: string; aspect: string }

export const LAB_BLOCKS = ["prompt", "photo", "references"] as const
/**
 * prompt: cities painted from words in the style · photo: real city photos
 * repainted in it · references: new cities after the moodboard's own images.
 */
export type LabBlock = (typeof LAB_BLOCKS)[number]

export type LabImage = {
  id: string
  block: LabBlock
  /** The city it shows. */
  city: string
  /** Generation set and output it's painted as. */
  output: string
  status: "pending" | "running" | "done" | "error"
  file?: string
  error?: string
  /** Moodboard images it was shown (block references), or the city photo's listing (block photo). */
  refs?: string[]
  /** One of a set of the city: its place in it. */
  set?: { index: number; size: number }
  rating?: "up" | "down"
}

export type LabRound = {
  id: string
  styleId: string
  /** Main guide version, or a candidate, it tested. */
  version: number
  candidate?: string
  /** The generation set painting it. */
  set: string
  images: LabImage[]
  /** The "new ideas" run it belongs to (the main style's round of that run, or a direction's). */
  batch?: string
  at: string
}

/** The cities a lab round paints, by block; the defaults cover a range of kinds of place. */
export const LAB_CITIES = {
  prompt: ["New York City", "London", "Sydney", "Darmstadt, Germany", "Telluride, Colorado", "Navagio Beach, Zakynthos", "Lake Louise, Banff"],
  photo: ["Paris", "Amalfi Coast", "Chicago", "Tokyo", "Santorini"],
  references: ["Rome", "Barcelona", "San Francisco", "Kyoto", "Cape Town"],
} as const

/**
 * Quick tests: a few places from words, two (small) or three (middle) per
 * variant, a city, a coast and a canal town the boards rarely show, so a
 * style is judged on places it has to compose itself.
 */
export const TEST_SIZES = { small: 2, middle: 3 } as const
export type TestSize = keyof typeof TEST_SIZES
export const TEST_CITIES = ["Rome", "Amalfi Coast", "Amsterdam", "Sydney", "Kyoto"] as const

/** What the lab's judge says about one round against the board. */
export type RoundVerdict = {
  /** 0–10: how exactly the posters hit the board's style (10: nobody could tell which is new). */
  style: number
  /** 0–10: how good the compositions are as posters. */
  composition: number
  /** 0–10: how recognisable the places are. */
  place: number
  /** Style counts double. */
  overall: number
  /** Where the posters miss the board, most important first. */
  misses: string[]
  /** What to change in the guide to close the gap. */
  fixes: string[]
}

/** One step of an autonomous test: the guide it tried, its round and the judge's verdict. */
export type AutoRun = {
  id: string
  /** "Main", "Pass 1 · A"… */
  label: string
  pass: number
  candidate?: string
  paint?: PaintStrategy
  round?: string
  verdict?: RoundVerdict
}

/** The lab painting, judging and rewriting the guide by itself until the posters hit the board. */
export type AutoTest = {
  id: string
  status: "running" | "done" | "error" | "stopped"
  size: TestSize
  passes: number
  /** What it's doing, in words. */
  step: string
  runs: AutoRun[]
  /** The run with the best verdict so far. */
  best?: string
  /** The server running it, so a stopped server reads as stopped. */
  runner?: string
  /** What came of it, in words ("Style 5.8 → 8.1, adopted as version 4"). */
  outcome?: string
  error?: string
  at: string
  finishedAt?: string
}

// --- Inspirations ---

/** What an inspiration does to a real city photo, read off its photos (or written from its name). */
export type InspirationGuide = {
  summary: string
  sky: string
  light: string
  colour: string
  /** Time of day, season, weather. */
  moment: string
  /** Vantage point and lens, when the look is about them (aerial, waterline); "" otherwise. */
  vantage: string
  /** One paragraph for the image model. */
  prompt: string
  avoid: string[]
}

export type Inspiration = {
  id: string
  name: string
  images: { file: string; width: number; height: number; addedAt: string }[]
  guide: InspirationGuide | null
  guideStatus: "idle" | "running" | "error"
  guideError?: string
  createdAt: string
  updatedAt: string
}

// --- Asking for posters ---

/**
 * Creativity, 1 to 5: how far a variant moves from the reference. Every
 * level ends in a picture people want on their wall; higher levels bring
 * more of our own (sky, light, then the camera and the composition), never
 * louder or darker.
 */
export const LEVELS = [1, 2, 3, 4, 5] as const
export type Level = (typeof LEVELS)[number]

export const LEVEL_LABEL: Record<Level, { label: string; hint: string }> = {
  1: { label: "Faithful", hint: "The same picture taken again: small natural changes (fewer cars, palms in the wind), the sky a touch prettier" },
  2: { label: "Refined", hint: "Same view, a beautiful sky and clean light, clutter gone" },
  3: { label: "New light", hint: "Same view at another flattering moment: golden hour, blush dusk, a sunny morning" },
  4: { label: "New angle", hint: "The place from a nearby viewpoint, composed as a poster" },
  5: { label: "Signature", hint: "Our most beautiful take on the place: a freer composition, still calm and elegant" },
}

/** A row of the creativity panel: images per level, all with one sky. */
export type CreativityRow = { levels: Partial<Record<Level, number>>; sky: SkyId }

export type StyleRequest = {
  styleId: string
  modes: RefMode[]
  count: number
  /** Images of a set in the style (3 or more), on top of `count`. */
  set?: number
  /** Productions: how far the compositions follow the place's best sellers; "free" or missing leaves them to us. */
  follow?: Follow
  /** A sky for every image in the style; missing leaves it to the style. */
  sky?: SkyId
}

export const FOLLOWS = ["free", "low", "mid", "high"] as const
export type Follow = (typeof FOLLOWS)[number]

/** What one reference photo (or city) is asked for. */
export type CityRequest = {
  /** Variants by creativity, a sky per row. */
  rows: CreativityRow[]
  /** We decide: `count` variants per reference, their creativity and sky picked for each photo. Replaces the rows. */
  auto: { on: boolean; count: number }
  /** New compositions of the place in the reference's look. */
  ideas: number
  /** A set that hangs together: `count` images (3 or more), at least three different motifs of the place. */
  set: { on: boolean; count: number }
  /**
   * On: everything comes out as a real photo, even from an illustration.
   * Off (the default): every image keeps the reference's own medium and
   * style, so a sketch makes sketches and a photo makes photos.
   */
  realPhoto: boolean
  styles: StyleRequest[]
  /** What the shop owner wants different, for every image. */
  notes?: string
  delivery: "now" | "batch"
  /** The production it's part of (set by the app, not asked for). */
  production?: string
  /** The action it was asked in (one click of Generate: every photo's batch of it), set by the app; Outputs groups by it. */
  action?: string
  /** Which print of the reference photo it's made from, when the photo holds a set (set by the app). */
  print?: number
}

export const SET_MIN = 3
export const SET_MAX = 9
export const ROWS_MAX = 3

export const EMPTY_REQUEST: CityRequest = {
  rows: [{ levels: {}, sky: "auto" }],
  auto: { on: false, count: 2 },
  ideas: 0,
  set: { on: false, count: SET_MIN },
  realPhoto: false,
  styles: [],
  delivery: "batch",
}

/** The default: three variants, faithful to new light, the sky left to us. */
export const DEFAULT_REQUEST: CityRequest = { ...EMPTY_REQUEST, rows: [{ levels: { 1: 1, 2: 1, 3: 1 }, sky: "auto" }] }

/** A saved request, to apply in one click. */
export type CityTemplate = { id: string; name: string; request: CityRequest; createdAt: string }

/** Images per row, auto mode aside. */
export const rowSize = (row: CreativityRow) => Object.values(row.levels).reduce((n, c) => n + (c ?? 0), 0)

/** How many images a request makes. */
export function requestSize(r: CityRequest) {
  const variants = r.auto.on ? r.auto.count : r.rows.reduce((n, row) => n + rowSize(row), 0)
  const styled = r.styles.reduce((n, s) => n + s.count * Math.max(1, s.modes.length) + (s.set ?? 0), 0)
  return variants + r.ideas + (r.set.on ? r.set.count : 0) + styled
}

/** Requests saved before skies (look, inspired, real by level) as they read now; current ones as they are. */
export function normalizeRequest(value: unknown): CityRequest {
  const v = (value ?? {}) as Partial<CityRequest> & { real?: unknown; look?: unknown; inspired?: unknown }
  let rows = Array.isArray(v.rows) ? v.rows : null
  if (!rows) {
    const look = Array.isArray(v.look) ? (v.look as string[]) : []
    const sky = look.map((id) => LOOK_SKY[id]).find(Boolean) ?? "auto"
    const levels = v.real && typeof v.real === "object" ? (v.real as CreativityRow["levels"]) : {}
    rows = [{ levels, sky }]
    for (const i of Array.isArray(v.inspired) ? (v.inspired as { id: string; count: number }[]) : []) {
      if (i?.count > 0) rows.push({ levels: { 3: i.count }, sky: LOOK_SKY[i.id] ?? "auto" })
    }
  }
  return {
    ...EMPTY_REQUEST,
    ...v,
    rows: rows.slice(0, ROWS_MAX).map((row) => ({ levels: { ...(row?.levels ?? {}) }, sky: isSkyId(row?.sky) ? row.sky : "auto" })),
    auto: { ...EMPTY_REQUEST.auto, ...(v.auto ?? {}) },
    set: { ...EMPTY_REQUEST.set, ...(v.set ?? {}) },
    realPhoto: v.realPhoto === true,
    ideas: Number(v.ideas) || 0,
    styles: Array.isArray(v.styles) ? v.styles : [],
    delivery: v.delivery === "now" ? "now" : "batch",
  }
}

/** What the reference picture is, read once per set: what it shows and how it's made. */
export type ReferenceRead = {
  /** A photograph, or drawn or painted art. */
  medium: "photo" | "art"
  /** How it's made, precisely enough to make more in it: for art its medium, line, colour, texture, figures, lettering; for a photo its grading, light, lens and mood. */
  style: string
  /** What it shows and from where. */
  view: string
  landmarks: string[]
  composition: string
  sky: string
  /** People, cars, boats. */
  life: string
  palette: string[]
  /** What makes it beautiful and sell, to keep. */
  appeal: string
}

/** What makes a place itself, written once per place and kept (citys/briefs/<placeId>). */
export type PlaceBrief = {
  summary: string
  /** Signature landmarks and views, most recognisable first, each with how it looks. */
  landmarks: string[]
  /** Poster motifs that capture the place ("Big Ben with a red bus on Westminster Bridge"), best first. */
  motifs: string[]
  /** What must be right: water, hills, the skyline's order, how landmarks sit. */
  geography: string
  /** Real viewpoints photographers shoot it from. */
  viewpoints: string[]
  /** The compositions its best-selling posters use: subject, vantage point, framing, foreground, light. */
  compositions?: string[]
  avoid: string[]
  /** 2: written from its best sellers' pictures as well. */
  version?: number
}

/** What a city output is, kept on it (generation Output.city). */
export type CityOutputInfo = {
  /** real: a variant by level · idea: a new composition · set: one of a set · style: in a city style · lab: a style lab image. */
  kind: "real" | "idea" | "set" | "style" | "lab"
  level?: Level
  /** The sky asked for; "auto" or missing leaves it to the art director. */
  sky?: SkyId
  /** Its level and sky were picked by the art director (auto mode). */
  auto?: boolean
  /** What it's made as: a real photo, or art in the reference's (or the style's) look. */
  medium?: "photo" | "art"
  /** Made a real photo whatever the reference is (the Real photo switch). */
  realPhoto?: boolean
  /** One of a set: its place in the set and its motif once planned. */
  set?: { index: number; size: number; motif?: string }
  /**
   * A real photo of the place showing its motif, from a top shop's best
   * seller: given to the painter for the true geography only, or with
   * `retake` as the scene to photograph again (new real photos).
   */
  geo?: { listingId: number; file: string; retake?: boolean }
  /** Art styles painted by redrawing: the board poster (style file) the art director picked to redraw. */
  board?: string
  /** Old outputs: the inspirations it took on. */
  look?: string[]
  styleId?: string
  /** Style outputs: how the reference was used. */
  refMode?: RefMode
  /** Productions: which, and how far it followed the best sellers. */
  production?: string
  follow?: Follow
  /** Lab images: the block and the city painted. */
  block?: LabBlock
  target?: string
  /** Moodboard images (style file names) shown to it, lab block references. */
  refs?: string[]
  /** Lab images testing a candidate guide. */
  candidate?: string
}

/** What a city set is about, kept on it (GenerationSet.city). */
export type CitySetInfo = {
  placeId: string
  place: string
  country: string
  /** The reference's shop and its style tags, when there is a reference. */
  shopId?: number
  labels?: string[]
  /** What the reference shows and how it's made, read once. */
  read?: ReferenceRead
  /** The same for the other prints of a set's photo, by print. */
  reads?: Record<number, ReferenceRead>
  /** A lab round's set: its style and round. */
  lab?: { styleId: string; round: string }
  /** Recreated from one of our own posters: it is this set's reference. */
  fromOutput?: { setId: string; outputId: string }
}
