import type { Clip, Ease, Keyframe, Motion, Scene, Shot, Template } from "./types"

// Samples a clip: keyframes → the shot at a moment → a camera on the scene.
// Pure numbers, so the renderer, the video encoder and CSS previews agree.

export const NEUTRAL: Shot = {
  frame: 0,
  zoom: 1,
  x: 0,
  y: 0,
  rotate: 0,
  exposure: 0,
  warmth: 0,
  blur: 0,
  vignette: 0,
  design: 1,
  glint: -1,
}

const FIELDS = Object.keys(NEUTRAL) as (keyof Shot)[]

const EASE: Record<Ease, (t: number) => number> = {
  smooth: (t) => (1 - Math.cos(Math.PI * t)) / 2,
  out: (t) => 1 - (1 - t) ** 3,
  in: (t) => t ** 3,
  linear: (t) => t,
}

/** Poster framing reaches this share of the frame at `frame` 1. */
const FILL = 0.85
/** Beyond this the room's pixels run out at 1080p. */
const MAX_ZOOM = 4

/** The shot at `t`, 0 … 1 of the clip. */
export function shotAt(motion: Motion, t: number): Shot {
  const keys = motion.keys
  if (!keys.length) return NEUTRAL
  if (t <= keys[0].t) return complete(keys[0].shot)
  let i = 0
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++
  if (i === keys.length - 1) return complete(keys[i].shot)
  const a = keys[i]
  const b = keys[i + 1]
  const k = EASE[a.ease]((t - a.t) / (b.t - a.t))
  const shot = {} as Shot
  for (const f of FIELDS) {
    const from = a.shot[f] ?? NEUTRAL[f]
    const to = b.shot[f] ?? NEUTRAL[f]
    // Zoom is felt in ratios: 1 → 2 should look as steady as 2 → 4.
    shot[f] = f === "zoom" ? from * (to / from) ** k : from + (to - from) * k
  }
  return shot
}

const complete = (shot: Shot): Shot => ({ ...NEUTRAL, ...shot })

/** Scene point at the frame centre, zoom (1 = whole scene) and turn in radians. */
export type Camera = { x: number; y: number; zoom: number; rotate: number }

export type Frame = Pick<Shot, "exposure" | "warmth" | "blur" | "vignette" | "design" | "glint"> & {
  camera: Camera
}

/** Everything the renderer needs `time` seconds into the clip. */
export function frameAt(scene: Scene, motion: Motion, time: number): Frame {
  const shot = shotAt(motion, motion.duration > 0 ? time / motion.duration : 0)
  const { exposure, warmth, blur, vignette, design, glint } = shot
  return {
    camera: cameraFor(scene, shot, drift(motion, time)),
    exposure,
    warmth,
    blur,
    vignette,
    design,
    glint,
  }
}

type Drift = { x: number; y: number; rotate: number; margin: number }
const STILL: Drift = { x: 0, y: 0, rotate: 0, margin: 1 }

export function cameraFor(scene: Scene, shot: Shot, drift: Drift = STILL): Camera {
  const W = scene.width
  const H = scene.height
  const box = posterBox(scene)
  const fill = Math.max(1, Math.min(W / box.width, H / box.height) * FILL)
  const framed = fill ** Math.max(0, shot.frame)
  // The poster glides to the centre at an even pace while the camera closes in.
  const toward = shot.frame >= 1 ? 1 : 1 - (1 - Math.max(0, shot.frame)) / framed
  let zoom = Math.min(MAX_ZOOM, framed * shot.zoom) * drift.margin
  const rotate = ((shot.rotate + drift.rotate) * Math.PI) / 180
  let x = W / 2 + (box.x + box.width / 2 - W / 2) * toward + shot.x * box.width + (drift.x * W) / zoom
  let y = H / 2 + (box.y + box.height / 2 - H / 2) * toward + shot.y * box.height + (drift.y * H) / zoom

  // Never past the room's edge: zoom in until the turned frame fits, then keep it inside.
  const cos = Math.abs(Math.cos(rotate))
  const sin = Math.abs(Math.sin(rotate))
  zoom = Math.max(zoom, (W * cos + H * sin) / W, (W * sin + H * cos) / H)
  const hx = (W * cos + H * sin) / (2 * zoom)
  const hy = (W * sin + H * cos) / (2 * zoom)
  x = Math.min(W - hx, Math.max(hx, x))
  y = Math.min(H - hy, Math.max(hy, y))
  return { x, y, zoom, rotate }
}

/** Bounding box of the visible posters; the whole scene without any. */
function posterBox(scene: Scene) {
  const points = scene.layers.flatMap((l) => (l.kind === "poster" && l.visible ? l.quad : []))
  if (!points.length) return { x: 0, y: 0, width: scene.width, height: scene.height }
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const x = Math.max(0, Math.min(...xs))
  const y = Math.max(0, Math.min(...ys))
  return {
    x,
    y,
    width: Math.max(1, Math.min(scene.width, Math.max(...xs)) - x),
    height: Math.max(1, Math.min(scene.height, Math.max(...ys)) - y),
  }
}

// Handheld sway from a few sines in whole cycles per clip, so it loops.
function drift(motion: Motion, time: number): Drift {
  const s = motion.shake
  if (!s || motion.duration <= 0) return STILL
  const n = Math.max(1, Math.round(motion.duration * 0.25))
  const u = (2 * Math.PI * time) / motion.duration
  const wave = (phase: number) =>
    0.6 * Math.sin(n * u + phase) +
    0.3 * Math.sin((2 * n + 1) * u + phase * 2.3) +
    0.1 * Math.sin((3 * n + 2) * u + phase * 4.1)
  return {
    x: s * 0.007 * wave(0.3),
    y: s * 0.005 * wave(1.7),
    rotate: s * 0.35 * wave(4.2),
    margin: 1 + s * 0.04,
  }
}

/** A keyframe with every field not given left neutral. */
export const key = (t: number, shot: Partial<Shot>, ease: Ease = "smooth"): Keyframe => ({
  t,
  ease,
  shot: { ...NEUTRAL, ...shot },
})

export function clipFrom(template: Motion & { name: string }, scene: Scene): Clip {
  const taken = new Set(scene.clips?.map((c) => c.id))
  let n = (scene.clips?.length ?? 0) + 1
  while (taken.has(`clip-${n}`)) n++
  return {
    id: `clip-${n}`,
    name: template.name,
    duration: template.duration,
    shake: template.shake,
    keys: structuredClone(template.keys),
    // Etsy plays one video per listing; the first clip is it.
    listing: !scene.clips?.some((c) => c.listing),
  }
}

export const motionOf = ({ duration, shake, keys }: Motion): Motion => ({ duration, shake, keys })

/** Short stable hash, for file names that change with what they show. */
export function hash(text: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export const isTemplate = (t: unknown): t is Template =>
  !!t &&
  typeof (t as Template).name === "string" &&
  typeof (t as Template).duration === "number" &&
  Array.isArray((t as Template).keys) &&
  (t as Template).keys.length > 0
