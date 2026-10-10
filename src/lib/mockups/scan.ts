import sharp from "sharp"

import { readDoc, updateDoc } from "@/lib/db/documents"

import { askJson } from "./gemini"

// Before a shop's photos become mockups: which of them show the same room
// (a seller shoots one room with every poster), which aren't room mockups at
// all (size charts, close-ups, the flat design), and which show a room
// stolen already. Rooms are told apart by a tiny picture of each photo: the
// same room with another poster in the frame still matches nearly
// everywhere, another room almost nowhere (measured on a shop's 581 photos:
// same room 55–90 % of pixels alike, other rooms under 30 %).

const W = 32
const H = 24
/** Channels within this of each other count as alike. */
const NEAR = 12
/** Share of alike pixels from which two photos show the same room. */
const SAME = 0.45

/** Etsy serves every photo smaller under the same name. */
const small = (url: string) => url.replace("/il_fullxfull.", "/il_340x270.")

type Cache = { sigs: Map<string, Promise<Buffer>> }
const cache = ((globalThis as typeof globalThis & { __photoScan?: Cache }).__photoScan ??= { sigs: new Map() })

function signature(url: string) {
  let sig = cache.sigs.get(url)
  if (!sig) {
    sig = (async () => {
      const response = await fetch(small(url), { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error(`Photo ${response.status}`)
      const image = Buffer.from(await response.arrayBuffer())
      return sharp(image).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer()
    })()
    sig.catch(() => cache.sigs.delete(url))
    cache.sigs.set(url, sig)
  }
  return sig
}

/** Whether `a` and `b` show the same room; gives up once too much differs (a shop has thousands of photos). */
function sameRoom(a: Buffer, b: Buffer) {
  const allowed = Math.floor((1 - SAME) * W * H)
  let off = 0
  for (let p = 0; p < a.length; p += 3) {
    const d = Math.max(Math.abs(a[p] - b[p]), Math.abs(a[p + 1] - b[p + 1]), Math.abs(a[p + 2] - b[p + 2]))
    if (d > NEAR && ++off > allowed) return false
  }
  return true
}

/** Runs `task` over `items`, `limit` at a time. */
async function each<T>(items: T[], limit: number, task: (item: T, i: number) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        await task(items[i], i)
      }
    })
  )
}

// --- Is it a room mockup? Asked once per photo, kept for every server. ---

const KINDS = "mockups/photo-kinds"
const ASK_AT_ONCE = 16

const KIND_PROMPT = `These are Etsy listing photos of wall-art prints, numbered from 0 in the order given.
For each, say whether it is a room mockup: a photo or realistic render of a room or interior scene (wall, shelf, floor, table, bed, or held in hands) with one or more framed or hanging prints in it.
Not a mockup: the artwork alone, flat and edge to edge; a size guide or chart; an infographic or slide with text; a close-up of a frame corner, paper or texture; a collage of several prints without a room.`

const KIND_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: { index: { type: "INTEGER" }, mockup: { type: "BOOLEAN" } },
    required: ["index", "mockup"],
  },
}

async function mockupKinds(
  urls: string[],
  progress: (done: number) => void,
  signal?: AbortSignal
): Promise<Map<string, boolean>> {
  const known = await readDoc<Record<string, boolean>>(KINDS, {})
  const kinds = new Map(urls.flatMap((u) => (u in known ? [[u, known[u]] as const] : [])))
  const ask = urls.filter((u) => !kinds.has(u))
  const chunks = Array.from({ length: Math.ceil(ask.length / ASK_AT_ONCE) }, (_, i) =>
    ask.slice(i * ASK_AT_ONCE, (i + 1) * ASK_AT_ONCE)
  )
  const found: Record<string, boolean> = {}
  let done = urls.length - ask.length
  progress(done)
  await each(chunks, 8, async (chunk) => {
    // Nobody's waiting any more: what's found so far is kept.
    if (signal?.aborted) return
    try {
      const images = await Promise.all(
        chunk.map(async (u) => Buffer.from(await (await fetch(small(u), { signal: AbortSignal.timeout(30_000) })).arrayBuffer()))
      )
      const answer = await askJson<{ index: number; mockup: boolean }[]>(KIND_PROMPT, images, {
        schema: KIND_SCHEMA,
        temperature: 0,
        quick: true,
      })
      for (const { index, mockup } of answer) if (chunk[index]) found[chunk[index]] = mockup
    } catch (error) {
      // Unknown counts as a mockup: better offered once too often than lost.
      console.error("Telling mockups apart:", error)
    }
    progress((done += chunk.length))
  })
  if (Object.keys(found).length) await updateDoc<Record<string, boolean>>(KINDS, {}, (all) => ({ ...all, ...found }))
  for (const u of ask) kinds.set(u, found[u] ?? true)
  return kinds
}

// --- The scan ---

export type ScannedPhoto = {
  url: string
  /** False for size charts, close-ups, flat designs and the like. */
  mockup: boolean
  /** The first photo given of the same room (itself if it's the first). */
  room: string
  /** Its room is a mockup already: one of `stolen` shows it. */
  stolen: boolean
}

export type ScanProgress = { step: "looking" | "sorting"; done: number; total: number }

/**
 * Sorts `photos` (best first: the first of a room stands for it) into rooms,
 * says which are mockups, and which rooms one of the `stolen` photos (made
 * into mockups before) already shows.
 */
export async function scanPhotos(
  photos: string[],
  stolen: string[],
  progress: (p: ScanProgress) => void = () => {},
  signal?: AbortSignal
): Promise<ScannedPhoto[]> {
  const given = new Set(photos)
  const urls = [...given]
  const taken = new Set(stolen)
  const before = [...taken].filter((u) => !given.has(u))
  const all = [...urls, ...before]
  const sigs = new Map<string, Buffer>()
  let done = 0
  await each(all, 32, async (url) => {
    if (signal?.aborted) return
    try {
      sigs.set(url, await signature(url))
    } catch (error) {
      console.error(`Photo ${url}:`, error)
    }
    progress({ step: "looking", done: ++done, total: all.length })
  })

  // Each photo joins the room of the first one before it that matches.
  const room = new Map<string, string>()
  const firsts: string[] = []
  for (const url of urls) {
    const sig = sigs.get(url)
    const match = sig && firsts.find((f) => sameRoom(sig, sigs.get(f)!))
    room.set(url, match || url)
    if (sig && !match) firsts.push(url)
  }

  // One look per room says whether it's a mockup at all.
  signal?.throwIfAborted()
  const kinds = await mockupKinds(firsts, (done) => progress({ step: "sorting", done, total: firsts.length }), signal)
  signal?.throwIfAborted()

  const shown = new Set(
    firsts.filter((f) => before.some((b) => sigs.has(b) && sameRoom(sigs.get(f)!, sigs.get(b)!)))
  )
  // A photo stolen itself shows a stolen room.
  for (const url of urls) if (taken.has(url)) shown.add(room.get(url)!)

  return urls.map((url) => {
    const first = room.get(url)!
    return { url, mockup: kinds.get(first) ?? true, room: first, stolen: shown.has(first) }
  })
}
