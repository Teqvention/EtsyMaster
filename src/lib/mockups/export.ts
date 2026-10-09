import { fileUrl, toJpeg } from "./client"
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

/** 01.jpg … — the place in the listing. */
export const exportName = (scene: Scene) => `${String(scene.order).padStart(2, "0")}.jpg`
