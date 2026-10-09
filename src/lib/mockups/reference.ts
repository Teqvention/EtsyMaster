import { readFile, writeFile } from "node:fs/promises"

import sharp from "sharp"

import { freshFile } from "./edit"
import { blankReplica, guessSheets } from "./gemini"
import { refineSheet } from "./locate"
import { extractSheet, type Pixels } from "./sheet"
import { createScene, filePath, saveScene } from "./storage"
import type { PosterLayer, Quad, Scene } from "./types"

// A scene from someone else's finished mockup: Nano Banana redraws it with
// blank sheets, every sheet's corners are found, and each gets its own poster
// layer with light & shine exactly as the editor's "Generate" would make them.
export async function createSceneFromReference(
  name: string,
  reference: Buffer,
  about: Pick<Scene, "category" | "source"> = {}
) {
  const scene = await createScene(name, await blankReplica(reference), about)
  try {
    return { ...(await placeSheets(scene)), located: true }
  } catch (error) {
    // The replica is still useful: corners can be set by hand in the editor.
    console.error(`Locating the sheets in ${scene.id}:`, error)
    return { ...scene, located: false }
  }
}

/** A listing photo from Etsy's image CDN, the only host references are fetched from. */
export async function fetchReference(url: string) {
  const parsed = URL.canParse(url) ? new URL(url) : null
  if (parsed?.protocol !== "https:" || !parsed.hostname.endsWith(".etsystatic.com")) {
    throw new Error("Only Etsy listing photos can be used as a reference")
  }
  const response = await fetch(parsed, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Couldn't download the listing photo (${response.status})`)
  return Buffer.from(await response.arrayBuffer())
}

/** Replaces the scene's placeholder poster with one poster per sheet found. */
export async function placeSheets(scene: Scene): Promise<Scene> {
  const background = await readFile(filePath(scene.id, "background.jpg"))
  const { data, info } = await sharp(background).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const room = { data: new Uint8ClampedArray(data), width: info.width, height: info.height }
  const quads = (await guessSheets(background)).map((q) => refineSheet(room, q))

  const template = scene.layers.find((l): l is PosterLayer => l.kind === "poster")!
  const posters: PosterLayer[] = []
  for (const [i, quad] of quads.entries()) {
    const n = quads.length > 1 ? i + 1 : 0
    posters.push(await sheetPoster(scene.id, room, quad, template, n))
  }
  const at = scene.layers.indexOf(template)
  const layers = [...scene.layers.slice(0, at), ...posters, ...scene.layers.slice(at + 1)]
  const next = { ...scene, layers }
  await saveScene(next)
  return next
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
  await writeFile(filePath(id, lightSrc), await png(light))
  await writeFile(filePath(id, shineSrc), await png(shine))
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
