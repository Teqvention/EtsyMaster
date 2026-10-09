import { createSign } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

import sharp from "sharp"

import type { Quad } from "./types"

// Vertex AI with a service-account key: Nano Banana redraws a reference
// mockup with a blank sheet, Gemini Flash points at where the sheet is.
// The key file is GOOGLE_APPLICATION_CREDENTIALS (relative to the app).

const IMAGE_MODEL = "gemini-nano-banana-2.1"
const VISION_MODEL = "gemini-3-flash-preview"

type Key = { client_email: string; private_key: string; project_id: string; token_uri: string }

let token: { value: string; expires: number; key: Key } | null = null

async function auth() {
  if (token && token.expires > Date.now() + 60_000) return token
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
  })
  const body = await response.json()
  if (!body.access_token) throw new Error(`Google auth: ${body.error_description ?? body.error}`)
  token = { value: body.access_token, expires: Date.now() + body.expires_in * 1000, key }
  return token
}

type Part = { text?: string; inlineData?: { mimeType: string; data: string } }

// Vertex's shared quota answers 429 when busy; it usually clears in seconds.
const RETRIES = [2_000, 5_000, 12_000]

async function generate(model: string, parts: Part[], generationConfig: object) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await generateOnce(model, parts, generationConfig)
    } catch (error) {
      const busy = error instanceof BusyError
      if (!busy || attempt >= RETRIES.length) throw error
      await new Promise((r) => setTimeout(r, RETRIES[attempt]))
    }
  }
}

class BusyError extends Error {}

async function generateOnce(model: string, parts: Part[], generationConfig: object) {
  const { value, key } = await auth()
  const response = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${key.project_id}/locations/global/publishers/google/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${value}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
    }
  )
  const body = await response.json()
  if (!response.ok) {
    const message = `${model}: ${body.error?.message ?? response.statusText}`
    throw response.status === 429 || response.status === 503 ? new BusyError(message) : new Error(message)
  }
  const candidate = body.candidates?.[0]
  if (!candidate?.content?.parts) {
    throw new Error(`${model}: no result (${candidate?.finishReason ?? body.promptFeedback?.blockReason ?? "empty"})`)
  }
  return candidate.content.parts as Part[]
}

/** JPEG of at most 2048 px on the long edge — plenty for the models, cheap to send. */
async function inline(image: Buffer): Promise<Part> {
  const jpeg = await sharp(image)
    .rotate()
    .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .jpeg({ quality: 92 })
    .toBuffer()
  return { inlineData: { mimeType: "image/jpeg", data: jpeg.toString("base64") } }
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

const BLANK_PROMPT = `Recreate this exact photo as a 1:1 replica: same camera angle, framing, composition, room, furniture, frame, mat, lighting and colours. Do not move, resize or crop anything.
The only change: the artwork inside every frame becomes a completely blank, plain white sheet of paper. Remove every trace of the printed design — no text, no illustration, no colour from the old print. Borders, margins and lines printed on the artwork are part of the design and become white too; only a real mat (passe-partout) or the frame stays.
Keep everything that lies on top of the artwork exactly as it is: glass reflections, glare, highlights, the shadow cast by the frame onto the paper, light falloff and any objects in front of the frame. These should now be visible over the white paper.`

/** The reference mockup redrawn with a blank white sheet in the frame. */
export async function blankReplica(reference: Buffer) {
  const { width, height } = await sharp(reference).rotate().metadata()
  const parts = await generate(IMAGE_MODEL, [await inline(reference), { text: BLANK_PROMPT }], {
    responseModalities: ["IMAGE"],
    imageConfig: { aspectRatio: nearestRatio(width!, height!), imageSize: "2K" },
  })
  const image = parts.find((p) => p.inlineData)?.inlineData
  if (!image) throw new Error("Nano Banana returned no image")
  return Buffer.from(image.data, "base64")
}

/**
 * Bounding box of every blank sheet as a quad (TL, TR, BR, BL) in pixels of
 * `image`, in reading order. Gemini is trained on `box_2d` — corner points
 * asked for directly come back far less accurate.
 */
export async function guessSheets(image: Buffer): Promise<Quad[]> {
  const { width, height } = await sharp(image).metadata()
  const parts = await generate(
    VISION_MODEL,
    [
      await inline(image),
      {
        text: 'Detect every blank white paper sheet inside a picture frame (the paper only, inside the frame moulding and mat) — there may be one or several frames. Output a JSON list where each entry has the 2D bounding box in "box_2d" as [ymin, xmin, ymax, xmax] normalized to 0-1000.',
      },
    ],
    { responseMimeType: "application/json", temperature: 0 }
  )
  const json = JSON.parse(parts.find((p) => p.text)?.text ?? "[]")
  const quads = (Array.isArray(json) ? json : [])
    .map((s) => s?.box_2d)
    .filter((b): b is number[] => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite))
    .map(([ymin, xmin, ymax, xmax]) => {
      const [x0, x1] = [(xmin / 1000) * width!, (xmax / 1000) * width!]
      const [y0, y1] = [(ymin / 1000) * height!, (ymax / 1000) * height!]
      return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Quad
    })
  if (!quads.length) throw new Error("Couldn't find a sheet")
  // Rows top to bottom (centres within half a sheet height), then left to right.
  const centre = (q: Quad) => [q.reduce((s, p) => s + p[0], 0) / 4, q.reduce((s, p) => s + p[1], 0) / 4]
  const tall = (q: Quad) => (q[3][1] - q[0][1] + q[2][1] - q[1][1]) / 2
  return quads.sort((a, b) => {
    const [ax, ay] = centre(a)
    const [bx, by] = centre(b)
    return Math.abs(ay - by) < Math.min(tall(a), tall(b)) / 2 ? ax - bx : ay - by
  })
}
