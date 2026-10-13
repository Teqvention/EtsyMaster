import sharp from "sharp"

import { boxOf, containment, drawingOrder, iou, locate, looksBlank, paperBehind, type Box } from "./detect"
import { freshFile, uniqueId } from "./edit"
import { blankReplica, guessArtwork, guessScene } from "./gemini"
import { extractSheet, type Pixels } from "./sheet"
import { createScene, readSceneFile, replaceRoom, saveFile, saveScene } from "./storage"
import type { ImageLayer, Layer, PosterLayer, Quad, Scene } from "./types"

// A scene from someone else's finished mockup: Nano Banana redraws it with
// blank sheets, every sheet's corners are found (see detect.ts), and each
// gets its own poster layer with light & shine exactly as the editor's
// "Generate" would make them. What stands in front of a sheet (a hand,
// books, a lamp) goes on an "In front of poster" layer above the posters,
// as it would be painted with Reveal, and the light under it is read off
// the paper around it. The photo the blank was made from, where there is
// one, helps find all of it.
export async function createSceneFromReference(
  name: string,
  reference: Buffer,
  about: Pick<Scene, "category" | "source" | "shop"> = {}
) {
  return createSceneFromBlank(name, await blankReplica(reference), about, reference)
}

/** A scene from a reference already redrawn with blank frames (see `blankReplica`), `original` the photo it was made from. */
export async function createSceneFromBlank(
  name: string,
  blank: Buffer,
  about: Pick<Scene, "category" | "source" | "shop"> = {},
  original?: Buffer | null
) {
  return located(await createScene(name, blank, about), original)
}

/** A scene's blank made again: the new one goes under it, its sheets found afresh. */
export async function replaceBlank(id: string, blank: Buffer, original?: Buffer | null) {
  return located(await replaceRoom(id, blank), original)
}

async function located(scene: Scene, original?: Buffer | null) {
  try {
    return { ...(await placeSheets(scene, original)), located: true }
  } catch (error) {
    // The replica is still useful: corners can be set by hand in the editor.
    console.error(`Locating the sheets in ${scene.id}:`, error)
    return { ...scene, located: false }
  }
}

/** The file of the scene's room. */
export const roomFile = (scene: Scene) =>
  scene.layers.find((l): l is ImageLayer => l.kind === "image" && l.role === "background")?.src ?? "background.jpg"

/** A listing photo from Etsy's image CDN, the only host references are fetched from. */
export async function fetchReference(url: string) {
  const parsed = URL.canParse(url) ? new URL(url) : null
  if (parsed?.protocol !== "https:" || !parsed.hostname.endsWith(".etsystatic.com")) {
    throw new Error("Only Etsy listing photos can be used as a reference")
  }
  // Etsy's image servers turn a request away now and then (429, 5xx) or drop it: asked again a little later.
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(parsed, { signal: AbortSignal.timeout(30_000) })
      if (response.ok) return Buffer.from(await response.arrayBuffer())
      if (attempt >= 3 || !(response.status === 429 || response.status >= 500)) {
        throw new Error(`Couldn't download the listing photo (${response.status})`)
      }
    } catch (error) {
      const passing = error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError")
      if (attempt >= 3 || !passing) throw error
    }
    await new Promise((r) => setTimeout(r, attempt * 5_000))
  }
}

/** The id the "In front of poster" layer placeSheets makes starts with; one painted in the editor keeps its own. */
const AUTO_FRONT = "front-auto"

/**
 * The scene's posters made afresh, one per sheet found, and what stands in
 * front of them on a layer of its own. Its other layers stay; the first
 * poster there was gives the new ones its settings (tone, blend, sheet).
 */
export async function placeSheets(scene: Scene, original?: Buffer | null): Promise<Scene> {
  const background = await readSceneFile(scene.id, roomFile(scene))
  const room = await rgba(background)
  const photo = original ? await rgba(original, room.width, room.height).catch(() => null) : null
  const [seen, prints] = await Promise.all([
    guessScene(background),
    // The photo's prints, for any sheet the look at the blank missed (a set of three seen as two).
    original ? guessArtwork(original).catch(() => [] as Quad[]) : ([] as Quad[]),
  ])
  const sheets = seen.sheets.map(boxOf)
  const meta = original ? await sharp(original).rotate().metadata() : null
  for (const print of prints) {
    const [x0, y0, x1, y1] = boxOf(print)
    const fx = room.width / (meta?.width ?? room.width)
    const fy = room.height / (meta?.height ?? room.height)
    const box: Box = [x0 * fx, y0 * fy, x1 * fx, y1 * fy]
    const known = sheets.some((s) => iou(s, box) > 0.25 || containment(box, s) > 0.5 || containment(s, box) > 0.5)
    if (!known && looksBlank(room, box)) sheets.push(box)
  }
  const { quads, front } = locate(room, sheets, seen.front.map((f) => boxOf(f.quad)), photo ?? undefined)

  const posterAt = scene.layers.findIndex((l) => l.kind === "poster")
  const template = scene.layers[posterAt] as PosterLayer | undefined
  const kept = scene.layers.filter(
    (l) => l.kind !== "poster" && !(l.kind === "image" && l.role === "front" && l.id.startsWith(AUTO_FRONT))
  )
  // Light and shine from the paper as it would be with nothing in front of it.
  const lit = front ? paperBehind(room, front, quads) : room
  const base = { ...scene, layers: kept }
  const posters: Layer[] = []
  for (const i of drawingOrder(quads)) {
    const n = quads.length > 1 ? i + 1 : 0
    posters.push(await sheetPoster(scene.id, lit, quads[i], template ?? defaultPoster(scene), n))
  }
  if (front) posters.push(await frontLayer(scene.id, room, front, uniqueId(base, AUTO_FRONT)))
  // Where the posters were (else right above the room), the other layers around them as they were.
  const at = template
    ? kept.filter((l) => scene.layers.indexOf(l) < posterAt).length
    : kept.findIndex((l) => l.kind === "image" && l.role === "background") + 1
  const next = { ...scene, layers: [...kept.slice(0, at), ...posters, ...kept.slice(at)] }
  await saveScene(next)
  return next
}

/** The image's pixels as RGBA, at `width` × `height` when given. */
async function rgba(image: Buffer, width?: number, height?: number): Promise<Pixels> {
  let pipeline = sharp(image).rotate()
  if (width && height) pipeline = pipeline.resize(width, height, { fit: "fill" })
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height }
}

/** A poster's settings when the scene has none to copy: as a new scene's. */
function defaultPoster(scene: Scene): PosterLayer {
  return {
    id: "poster", kind: "poster", name: "Poster", quad: [[0, 0], [1, 0], [1, 1], [0, 1]],
    overscan: 0.008, fit: "cover", aspect: 1.4, tone: true, blend: "normal", opacity: 1, visible: true,
    sheet: { source: scene.layers.find((l) => l.kind === "image" && l.role === "background")?.id ?? "background", shine: 0.45, flat: 0.7 },
    children: [],
  }
}

/** The room's pixels where something stands in front of a poster, the rest clear, cropped to them. */
async function frontLayer(id: string, room: Pixels, mask: Uint8Array, layerId: string): Promise<ImageLayer> {
  const { width: w, height: h } = room
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  const cw = x1 - x0 + 1
  const ch = y1 - y0 + 1
  const out = new Uint8Array(cw * ch * 4)
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const i = ((y + y0) * w + x + x0) * 4
      const o = (y * cw + x) * 4
      out[o] = room.data[i]
      out[o + 1] = room.data[i + 1]
      out[o + 2] = room.data[i + 2]
      out[o + 3] = mask[(y + y0) * w + x + x0]
    }
  const src = freshFile("front")
  await saveFile(id, src, await sharp(Buffer.from(out), { raw: { width: cw, height: ch, channels: 4 } }).png().toBuffer())
  return {
    id: layerId, kind: "image", name: "In front of poster", src, x: x0, y: y0, width: cw, height: ch,
    blend: "normal", opacity: 1, visible: true, role: "front",
  }
}

/** Poster `n` (0 when it's the only one) over `quad`, with light and shine saved next to it. */
async function sheetPoster(id: string, room: Pixels, quad: Quad, template: PosterLayer, n: number) {
  const flat = template.sheet?.flat ?? 0.7
  const { width, height, light, shine } = extractSheet(room, quad, { flat })
  const png = (pixels: Uint8ClampedArray) =>
    sharp(Buffer.from(pixels.buffer), { raw: { width, height, channels: 4 } }).png().toBuffer()
  const suffix = n ? `-${n}` : ""
  const lightSrc = freshFile(`light${suffix}`)
  const shineSrc = freshFile(`shine${suffix}`)
  await saveFile(id, lightSrc, await png(light))
  await saveFile(id, shineSrc, await png(shine))
  const poster: PosterLayer = {
    ...template,
    id: `poster${suffix}`,
    name: n ? `Poster ${n}` : "Poster",
    quad,
    fit: "cover",
    aspect: height / width,
    children: [
      {
        id: `light${suffix}`, kind: "image", name: "Light", src: lightSrc, width, height,
        blend: "multiply", opacity: 1, visible: true, role: "light",
      },
      {
        id: `shine${suffix}`, kind: "image", name: "Glass reflection", src: shineSrc, width, height,
        blend: "add", opacity: template.sheet?.shine ?? 0.45, visible: true, role: "shine",
      },
    ],
  }
  return poster
}
