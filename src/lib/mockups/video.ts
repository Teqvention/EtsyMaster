import {
  BufferTarget,
  canEncodeVideo,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  type Quality,
} from "mediabunny"
import { Matrix } from "pixi.js"

import { fileUrl } from "./client"
import { frameAt } from "./motion"
import { SceneRenderer, type Source } from "./renderer"
import type { Clip, Motion, Scene } from "./types"

// Clips to MP4 in the browser: Pixi draws each frame, WebCodecs encodes it
// (H.264, what Etsy takes), Mediabunny writes the file.

const FPS = 30

/** Etsy recommends 1080p. */
export const VIDEO = { edge: 1080, quality: QUALITY_VERY_HIGH }
/** Hover previews on the mockups page. */
export const PREVIEW = { edge: 480, quality: QUALITY_MEDIUM }

/** `edge` px on the short side; H.264 wants even sizes. */
export function videoSize(scene: Scene, edge: number) {
  const f = edge / Math.min(scene.width, scene.height)
  const even = (v: number) => Math.max(2, Math.round((v * f) / 2) * 2)
  return { width: even(scene.width), height: even(scene.height) }
}

/** `motion` on a renderer that has `scene` built. */
export async function encodeMotion(
  renderer: SceneRenderer,
  scene: Scene,
  motion: Motion,
  { edge, quality }: { edge: number; quality: Quality },
  onProgress?: (done: number) => void
) {
  const { width, height } = videoSize(scene, edge)
  if (!(await canEncodeVideo("avc", { width, height }))) {
    throw new Error("This browser can't encode H.264 video")
  }
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  })
  const source = new CanvasSource(renderer.canvas, { codec: "avc", bitrate: quality, keyFrameInterval: 2 })
  output.addVideoTrack(source, { frameRate: FPS })
  await output.start()
  const view = new Matrix().scale(width / scene.width, height / scene.height)
  const frames = Math.max(1, Math.round(motion.duration * FPS))
  for (let i = 0; i < frames; i++) {
    renderer.draw(view, width, height, frameAt(scene, motion, i / FPS))
    // Reads the canvas before yielding, while the WebGL frame is still there.
    await source.add(i / FPS, 1 / FPS)
    onProgress?.((i + 1) / frames)
  }
  source.close()
  await output.finalize()
  return new Blob([output.target.buffer!], { type: "video/mp4" })
}

/** The listing video for `clip`, from a throwaway renderer. */
export async function exportClip(
  scene: Scene,
  clip: Clip,
  poster: ImageBitmap,
  resolve: (src: string) => Source = (src) => fileUrl(scene.id, src),
  onProgress?: (done: number) => void
) {
  const renderer = await SceneRenderer.create()
  try {
    await renderer.build(scene, { resolve, poster, exact: true })
    return await encodeMotion(renderer, scene, clip, VIDEO, onProgress)
  } finally {
    renderer.destroy()
  }
}

/** 01-push-in.mp4 — listing place, then the clip. */
export function clipFileName(scene: Scene, clip: Clip) {
  const slug = clip.name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return `${String(scene.order).padStart(2, "0")}-${slug || "video"}.mp4`
}
