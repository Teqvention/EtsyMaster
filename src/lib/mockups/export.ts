import { fileUrl, putFile, toCanvas, toJpeg } from "./client"
import { SceneRenderer, type Source } from "./renderer"
import type { Scene } from "./types"

/** The listing JPEG for `scene` with `poster`, from a throwaway renderer. */
export async function exportScene(
  scene: Scene,
  poster: ImageBitmap,
  resolve: (src: string) => Source = (src) => fileUrl(scene.id, src)
) {
  const renderer = await SceneRenderer.create()
  try {
    await renderer.build(scene, { resolve, poster, exact: true })
    return await toJpeg(renderer.pixels())
  } finally {
    renderer.destroy()
  }
}

/** The grid's thumb.jpg: 720 px on the long edge, from a renderer already built with the poster. */
export async function thumbJpeg(renderer: SceneRenderer, scene: Scene) {
  const thumb = toCanvas(renderer.pixels(Math.min(1, 720 / Math.max(scene.width, scene.height))))
  const blob = await new Promise<Blob | null>((res) => thumb.toBlob(res, "image/jpeg", 0.86))
  if (!blob) throw new Error("Couldn't encode thumbnail")
  return blob
}

/** Renders and uploads thumb.jpg for a scene saved without one. */
export async function renderThumb(scene: Scene, poster: ImageBitmap) {
  const renderer = await SceneRenderer.create()
  try {
    await renderer.build(scene, { resolve: (src) => fileUrl(scene.id, src), poster })
    await putFile(scene.id, "thumb.jpg", await thumbJpeg(renderer, scene))
  } finally {
    renderer.destroy()
  }
}

/** 01.jpg … — the place in the listing. */
export const exportName = (scene: Scene) => `${String(scene.order).padStart(2, "0")}.jpg`
