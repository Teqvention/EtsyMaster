import { createSign } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

import sharp from "sharp"

import { busy as slowDown, calm, pace, type PaceKind } from "@/lib/google/pace"
import { deniedByGoogle, googlePaused, GooglePausedError, refused, rejectedByGoogle, wrong } from "@/lib/google/pause"

import type { Quad } from "./types"

// Vertex AI with a service-account key: Nano Banana redraws a reference
// mockup with a blank sheet, Gemini Flash points at where the sheet is (or
// the prints are).
// The key file is GOOGLE_APPLICATION_CREDENTIALS (relative to the app).

const IMAGE_MODEL = "gemini-nano-banana-2.1"
const VISION_MODEL = "gemini-3-flash-preview"

type Key = { client_email: string; private_key: string; project_id: string; token_uri: string }

type Token = { value: string; expires: number; key: Key }

let token: Token | null = null
/** The sign-in under way, which every call waiting for a token shares. */
let signing: Promise<Token> | null = null

// Every call to Google signs in here first, so the pause switch stops them all.
export async function auth() {
  if (await googlePaused()) throw new GooglePausedError()
  if (token && token.expires > Date.now() + 60_000) return token
  signing ??= signIn().finally(() => (signing = null))
  return signing
}

async function signIn(): Promise<Token> {
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!file) throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS in .env.local")
  const key: Key = JSON.parse(await readFile(path.resolve(process.cwd(), file), "utf8"))
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  })}`
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url")
  const response = await fetch(key.token_uri, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
    // Everything waits on this: a stalled answer mustn't hold it forever.
    signal: AbortSignal.timeout(30_000),
  })
  const body = await response.json().catch(() => ({}))
  if (!body.access_token) {
    const why = `${body.error_description ?? body.error ?? response.statusText}`
    // A key that's been revoked, or an account that's gone, signs in no more.
    if (response.status === 400 || refused(response.status)) void deniedByGoogle("Google sign-in", response.status, why)
    throw new Error(`Google auth: ${why}`)
  }
  token = { value: body.access_token, expires: Date.now() + body.expires_in * 1000, key }
  return token
}

export type Part = {
  text?: string
  inlineData?: { mimeType: string; data: string }
  /** A file in Cloud Storage (batch jobs only). */
  fileData?: { fileUri: string; mimeType: string }
}

// Vertex's shared quota answers 429 ("Resource has been exhausted") when
// busy — for the image models on our project most of the time: only a call
// or two a minute gets through, and a 429 comes back at once and costs
// nothing. Every model's calls go through a gate: a few at a time, and when
// one is told to back off, half as many may go and they all pause a few
// seconds — longer while it keeps happening, but never so long that a free
// slot goes unused for long — and one more may go with each success. Every
// try is also paced with every other server's (google/pace.ts).
// A call keeps trying that way while others get through: waiting its turn
// behind a dozen others is no reason to give up (it was until 12 Oct, and
// with many images asked for at once every one past the first few failed).
// It gives up with `StayedBusyError` once nothing has got through for anyone
// for PATIENCE, or after LONGEST of its own; a dropped connection or a
// passing server error is tried for PATIENCE.
// Kept low since 11 Oct: Google suspended an account over bursts of requests
// (20 at a time per model, each retried for 20 minutes). Two, as the old
// project's knowledge file has it for sync (google-bilder-batch-sync-wissen.md):
// online lets about one image a minute through anyway.
const MAX_PARALLEL = 2
/** Gemini Flash calls at once: it has room to spare (12 Oct: 30 a minute from all servers, none turned away). */
const MAX_PARALLEL_TEXT = 6
const PATIENCE = 5 * 60_000
const LONGEST = 30 * 60_000
const MAX_PAUSE = 20_000

type Gate = {
  limit: number
  active: number
  waiting: (() => void)[]
  until: number
  strikes: number
  /** Since when calls have been told to back off with none getting through; 0 once one does. */
  busySince: number
  /** Calls waiting their turn or trying; when none are left, the next starts afresh. */
  calls: number
}

// On globalThis, so every route (and a dev reload) shares the one gate per model.
const global = globalThis as typeof globalThis & { __geminiGates?: Map<string, Gate> }
const gates = (global.__geminiGates ??= new Map())

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Calls at once the gate lets through for `model`, when nothing's busy. */
const widest = (model: string) => (model === IMAGE_MODEL ? MAX_PARALLEL : MAX_PARALLEL_TEXT)

function gateFor(model: string) {
  let gate = gates.get(model)
  if (!gate) gates.set(model, (gate = { limit: widest(model), active: 0, waiting: [], until: 0, strikes: 0, busySince: 0, calls: 0 }))
  // A gate from before these were fields: a dev reload keeps the old object.
  gate.busySince ??= 0
  gate.calls ??= 0
  return gate
}

async function enter(gate: Gate) {
  while (gate.active >= gate.limit) await new Promise<void>((r) => gate.waiting.push(r))
  gate.active++
  while (Date.now() < gate.until) await sleep(gate.until - Date.now() + Math.random() * 1_500)
}

function leave(gate: Gate) {
  gate.active--
  gate.waiting.shift()?.()
}

/** Which of the shared paces a model's calls draw on. */
const paceOf = (model: string): PaceKind => (model === IMAGE_MODEL ? "image" : "text")

async function generate(model: string, parts: Part[], generationConfig: object) {
  const gate = gateFor(model)
  gate.calls++
  // When this call first got its turn: the wait for it doesn't count.
  let start = 0
  try {
    for (let attempt = 1; ; attempt++) {
      await enter(gate)
      start ||= Date.now()
      try {
        await pace(paceOf(model))
        const result = await generateOnce(model, parts, generationConfig)
        gate.strikes = 0
        gate.busySince = 0
        if (gate.limit < widest(model)) gate.limit++
        void calm(paceOf(model))
        return result
      } catch (error) {
        const busy = error instanceof BusyError
        if (!(busy || passing(error))) throw error
        const now = Date.now()
        if (busy) {
          gate.busySince ||= now
          void slowDown(paceOf(model))
        }
        if ((busy && now - gate.busySince > PATIENCE) || now - start > LONGEST) {
          throw new StayedBusyError(`${model}: Vertex stayed busy (its quota), try again in a few minutes`)
        }
        if (!busy && now - start > PATIENCE) throw error
        if (busy) {
          gate.strikes++
          gate.limit = Math.max(1, Math.floor(gate.limit / 2))
        }
        const wait = Math.min(MAX_PAUSE, 2_000 * 2 ** Math.min(Math.max(gate.strikes, attempt) - 1, 4))
        gate.until = Math.max(gate.until, now + wait * (0.75 + Math.random() * 0.5))
      } finally {
        leave(gate)
      }
    }
  } finally {
    if (--gate.calls === 0) gate.busySince = 0
  }
}

/** Vertex said it's busy (429, 503). */
class BusyError extends Error {}

/** Vertex failed on its side (500, 502, 504): it passes. */
class ServerError extends Error {}

/** Vertex said it's busy all along (see `generate`): worth asking again in a few minutes, or in a batch job. */
export class StayedBusyError extends Error {}

/** The connection failed (the laptop slept, Wi-Fi dropped) or stalled, or Vertex failed on its side: worth trying again. */
const passing = (error: unknown) =>
  error instanceof ServerError ||
  (error instanceof TypeError && error.message === "fetch failed") ||
  (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError"))

async function generateOnce(model: string, parts: Part[], generationConfig: object) {
  const { value, key } = await auth()
  const response = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${key.project_id}/locations/global/publishers/google/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${value}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
      // Nano Banana takes up to a minute or two; a call that's said nothing for far longer has stalled.
      signal: AbortSignal.timeout(model === IMAGE_MODEL ? 5 * 60_000 : 3 * 60_000),
    }
  )
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = `${model}: ${body.error?.message ?? response.statusText}`
    if (response.status === 429 || response.status === 503) throw new BusyError(message)
    if (response.status >= 500) throw new ServerError(message)
    if (refused(response.status)) void deniedByGoogle(model, response.status, body.error?.message ?? response.statusText)
    else if (wrong(response.status)) void rejectedByGoogle(model, response.status, body.error?.message ?? response.statusText)
    throw new Error(message)
  }
  const candidate = body.candidates?.[0]
  if (!candidate?.content?.parts) {
    throw new Error(`${model}: no result (${candidate?.finishReason ?? body.promptFeedback?.blockReason ?? "empty"})`)
  }
  return candidate.content.parts as Part[]
}

/** JPEG of at most 2048 px on the long edge — plenty for the models, cheap to send. */
export function modelJpeg(image: Buffer) {
  return sharp(image)
    .rotate()
    .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .jpeg({ quality: 92 })
    .toBuffer()
}

async function inline(image: Buffer): Promise<Part> {
  return { inlineData: { mimeType: "image/jpeg", data: (await modelJpeg(image)).toString("base64") } }
}

const RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]

function nearestRatio(width: number, height: number) {
  const r = Math.log(width / height)
  const value = (s: string) => {
    const [a, b] = s.split(":").map(Number)
    return Math.log(a / b)
  }
  return RATIOS.reduce((best, s) => (Math.abs(value(s) - r) < Math.abs(value(best) - r) ? s : best))
}

export const BLANK_PROMPT = `Recreate this exact photo as a 1:1 replica: same camera angle, framing, composition, room, furniture, frame, mat, lighting and colours. Do not move, resize or crop anything.
The only change: the artwork inside every frame becomes a completely blank, plain white sheet of paper. Remove every trace of the printed design — no text, no illustration, no colour from the old print. Borders, margins and lines printed on the artwork are part of the design and become white too; only a real mat (passe-partout) or the frame stays.
Keep everything that lies on top of the artwork exactly as it is: glass reflections, glare, highlights, the shadow cast by the frame onto the paper, light falloff and any objects in front of the frame. These should now be visible over the white paper.`

/**
 * A blank mockup made again, the way the user asked: from the photo (the
 * first image), with the earlier attempt (the second, if given) to improve on.
 */
export function blankAgainPrompt(feedback: string | undefined, previous: boolean) {
  return [
    BLANK_PROMPT,
    previous &&
      "The second image is an earlier attempt at this. Make a new one from the first image; keep what the earlier attempt got right and fix what it got wrong.",
    feedback && `What should be different this time, in the user's words: ${feedback}`,
  ]
    .filter(Boolean)
    .join("\n")
}

/** The reference mockup redrawn with a blank white sheet in the frame. */
export async function blankReplica(reference: Buffer) {
  return redraw(reference, BLANK_PROMPT)
}

// A new design from someone else's poster, at three levels of distance from
// it. Ideas, themes and styles are free to use; the drawing, characters and
// wording are someone's work, so even the closest version redraws all of it.
const REIMAGINE_PROMPT = `This is a poster design someone else made and sells. Create a NEW, ORIGINAL design for a printable wall-art poster based on it.
It must not be a copy, trace or close derivative: draw every element yourself. Never reproduce its characters, mascots, exact composition or linework, and never include any logo, trademark, brand, signature, watermark or copyrighted character. Do not copy its lettering; if there is text, write new wording.
Output only the flat artwork, front-on and edge to edge: no frame, wall, room, mockup or drop shadow. Crisp and print-ready, with clean, correctly spelled lettering.`

export const CREATIVITY = {
  low: "Creativity: low. Stay close to the original's subject, art style, colour palette and overall layout, so it would sit in the same shop next to it — but redraw everything with clearly different details: different poses and shapes, a different arrangement of the secondary elements, different patterns and textures, and new wording in a similar lettering style.",
  medium: "Creativity: medium. Keep the theme, mood and style genre, but make a new composition: a different main subject or viewpoint, new supporting elements, a shifted colour palette and new wording.",
  high: "Creativity: high. Take only the theme and the kind of buyer it appeals to as loose inspiration. Invent a fresh concept, composition, palette and style that suits it — a sister product, not a variation.",
} as const

export type Creativity = keyof typeof CREATIVITY

/** A new, original poster after `poster` at the given distance from it. */
export async function reimagine(poster: Buffer, creativity: Creativity) {
  return redraw(poster, `${REIMAGINE_PROMPT}\n${CREATIVITY[creativity]}`)
}

/** Nano Banana's take on `image` as told by `prompt`, at the image's aspect ratio. */
async function redraw(image: Buffer, prompt: string) {
  return paint(prompt, [image])
}

/**
 * Nano Banana: a new image from `prompt` and the `images` it refers to (in the
 * order the prompt names them), at the first image's aspect ratio unless
 * `aspect` (width / height) is given.
 */
export async function paint(prompt: string, images: Buffer[], aspect?: number) {
  const parts = await generate(
    IMAGE_MODEL,
    [...(await Promise.all(images.map(inline))), { text: prompt }],
    await paintConfig(images, aspect)
  )
  return imageOf(parts)
}

export const PAINT_MODEL = IMAGE_MODEL

/**
 * Nano Banana 2, painting what Nano Banana 2.1 can't get to while it's
 * overloaded (see the online lane and `follow` in generation/run.ts). It
 * costs twice as much (2K: about $0.10 online, $0.05 in batch, against $0.05
 * and $0.025) and paints a little more dramatically, once adding lettering
 * no one asked for; but on 12 Oct, a week after 2.1 came out, it painted the
 * same requests in 14 s each without a single busy answer, while 2.1 took
 * 20–168 s and turned 6 requests away 11 times, and its batch job had half
 * its images in 9 minutes while 2.1's had 6 percent after 15.
 */
export const FALLBACK_MODEL = "gemini-3.1-flash-image"

/** How Nano Banana is asked to paint: at `aspect`, else the first image's. */
export async function paintConfig(images: Buffer[], aspect?: number) {
  const first = images[0] ? await sharp(images[0]).rotate().metadata() : null
  const ratio = aspect ?? (first ? first.width! / first.height! : 1)
  return {
    responseModalities: ["IMAGE"],
    imageConfig: { aspectRatio: nearestRatio(ratio, 1), imageSize: "2K" },
  }
}

/** The image in a Nano Banana answer. */
export function imageOf(parts: Part[] | undefined) {
  const result = parts?.find((p) => p.inlineData)?.inlineData
  if (!result) throw new Error("Nano Banana returned no image")
  return Buffer.from(result.data, "base64")
}

/**
 * Gemini Flash answering `prompt` (about `images`, if any) as JSON. With a
 * `schema` (Vertex's OpenAPI subset) the answer is held to that shape.
 */
export async function askJson<T>(
  prompt: string,
  images: Buffer[] = [],
  {
    schema,
    temperature = 0.7,
    quick = false,
  }: { schema?: object; temperature?: number; /** Hardly any thinking, for plain yes/no looks. */ quick?: boolean } = {}
): Promise<T> {
  const parts = await generate(
    VISION_MODEL,
    [...(await Promise.all(images.map(inline))), { text: prompt }],
    {
      responseMimeType: "application/json",
      ...(schema && { responseSchema: schema }),
      ...(quick && { thinkingConfig: { thinkingLevel: "MINIMAL" } }),
      temperature,
    }
  )
  const text = parts.filter((p) => p.text).map((p) => p.text).join("")
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${VISION_MODEL}: answer wasn't JSON`)
  }
}

/** Bounding box of every framed print in a finished mockup, largest first; none for a flat design. */
export async function guessArtwork(image: Buffer): Promise<Quad[]> {
  const quads = await detectBoxes(
    image,
    "Detect every printed artwork or poster shown in this photo (the printed image only, inside any frame moulding and mat). Skip the photo itself if it is just a flat design with no room around it."
  )
  const area = (q: Quad) => (q[1][0] - q[0][0]) * (q[3][1] - q[0][1])
  return quads.sort((a, b) => area(b) - area(a))
}

async function detectBoxes(image: Buffer, prompt: string): Promise<Quad[]> {
  const { width, height } = await sharp(image).metadata()
  const parts = await generate(
    VISION_MODEL,
    [
      await inline(image),
      {
        text: `${prompt} Output a JSON list where each entry has the 2D bounding box in "box_2d" as [ymin, xmin, ymax, xmax] normalized to 0-1000.`,
      },
    ],
    { responseMimeType: "application/json", temperature: 0 }
  )
  const json = JSON.parse(parts.find((p) => p.text)?.text ?? "[]")
  return (Array.isArray(json) ? json : [])
    .map((s) => s?.box_2d)
    .filter((b): b is number[] => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite))
    .map(([ymin, xmin, ymax, xmax]) => {
      const [x0, x1] = [(xmin / 1000) * width!, (xmax / 1000) * width!]
      const [y0, y1] = [(ymin / 1000) * height!, (ymax / 1000) * height!]
      return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Quad
    })
}

/** A sheet's box, or something in front of one, as Gemini saw it in a blank mockup. */
export type Seen = { label: string; quad: Quad }

/**
 * Every blank sheet in a mockup and everything standing in front of one
 * (a hand, books, a lamp, another frame), boxes in pixels of `image`, in one
 * look: the sheets as wholes, hidden parts included, so their corners can be
 * found where the edges are hidden too.
 */
export async function guessScene(image: Buffer): Promise<{ sheets: Quad[]; front: Seen[] }> {
  const seen = await detectLabelled(
    image,
    `This photo shows a room with one or more picture frames (or unframed prints) whose artwork has been replaced by blank white paper. Find:
1. Every blank paper sheet: the paper only, inside the frame moulding and any mat. Include sheets that are partly hidden by objects or by other frames, cut off at the image edge, tilted, leaning, or held in someone's hands. Box the whole sheet, its hidden parts included. Label each one "sheet".
2. Every object that stands in front of a sheet and hides part of its paper: a hand or fingers, a book, a lamp, a vase, a plant or its leaves, a chair, a pillow, a bottle, another frame in front of it, and so on. Label each with what it is. Leave out shadows, reflections and light on the paper, and objects that only touch the frame from behind.`
  )
  const sheets = seen.filter((s) => /^sheets?$/i.test(s.label.trim())).map((s) => s.quad)
  if (!sheets.length) throw new Error("Couldn't find a sheet")
  return { sheets: readingOrder(sheets), front: seen.filter((s) => !/^sheets?$/i.test(s.label.trim())) }
}

async function detectLabelled(image: Buffer, prompt: string): Promise<Seen[]> {
  const { width, height } = await sharp(image).metadata()
  const parts = await generate(
    VISION_MODEL,
    [
      await inline(image),
      {
        text: `${prompt}\nOutput a JSON list where each entry has the 2D bounding box in "box_2d" as [ymin, xmin, ymax, xmax] normalized to 0-1000, and "label".`,
      },
    ],
    { responseMimeType: "application/json", temperature: 0 }
  )
  const json = JSON.parse(parts.find((p) => p.text)?.text ?? "[]")
  return (Array.isArray(json) ? json : [])
    .filter((s) => Array.isArray(s?.box_2d) && s.box_2d.length === 4 && s.box_2d.every(Number.isFinite))
    .map((s) => {
      const [ymin, xmin, ymax, xmax] = s.box_2d as number[]
      const [x0, x1] = [(xmin / 1000) * width!, (xmax / 1000) * width!]
      const [y0, y1] = [(ymin / 1000) * height!, (ymax / 1000) * height!]
      return { label: String(s.label ?? ""), quad: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Quad }
    })
}

function readingOrder(quads: Quad[]) {
  // Rows top to bottom (centres within half a sheet height), then left to right.
  const centre = (q: Quad) => [q.reduce((s, p) => s + p[0], 0) / 4, q.reduce((s, p) => s + p[1], 0) / 4]
  const tall = (q: Quad) => (q[3][1] - q[0][1] + q[2][1] - q[1][1]) / 2
  return quads.sort((a, b) => {
    const [ax, ay] = centre(a)
    const [bx, by] = centre(b)
    return Math.abs(ay - by) < Math.min(tall(a), tall(b)) / 2 ? ax - bx : ay - by
  })
}
