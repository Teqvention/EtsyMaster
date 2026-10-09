// A mockup scene: one room photo split into layers, bottom to top, with a
// poster slot somewhere in the stack. Coordinates are scene pixels, origin
// top left. Stored as data/mockups/<id>/scene.json next to its layer images.

export type Point = [number, number]

/** Corners clockwise from top left: TL, TR, BR, BL. */
export type Quad = [Point, Point, Point, Point]

export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "add",
  "overlay",
  "soft-light",
  "linear-burn",
] as const
export type BlendMode = (typeof BLEND_MODES)[number]

/** What a layer is for — drives icons and the brush tool, never rendering. */
export type LayerRole =
  | "background"
  | "light"
  | "shine"
  | "front"
  | "lift"
  | "overlay"

type LayerBase = {
  id: string
  name: string
  blend: BlendMode
  /** 0..1 */
  opacity: number
  visible: boolean
}

export type ImageLayer = LayerBase & {
  kind: "image"
  /** File name inside the scene folder. */
  src: string
  x: number
  y: number
  width: number
  height: number
  role?: LayerRole
}

/** Lives inside a poster and is stretched over the poster's quad. */
export type PosterChild = Omit<ImageLayer, "x" | "y">

export type PosterLayer = LayerBase & {
  kind: "poster"
  quad: Quad
  /** Draw the poster this much larger (0.008 = 0.8 %), clipped to `quad`. */
  overscan: number
  /** `stretch` fills the quad like a Photoshop smart object; `cover` crops to `aspect`. */
  fit: "stretch" | "cover"
  /** Height / width the poster is cropped to when `fit` is `cover`. */
  aspect?: number
  /** Warm paper tone on the mockup copy of the poster (Robin, 16.09.2026). */
  tone: boolean
  /** Rooms with a blank white sheet: light and shine are derived from it. */
  sheet?: SheetSettings
  children: PosterChild[]
}

export type SheetSettings = {
  /** Layer id whose pixels hold the empty sheet. */
  source: string
  /** Glass reflection strength (0.45). */
  shine: number
  /** How much of the broad light gradient to remove (0.7). */
  flat: number
}

export type Layer = ImageLayer | PosterLayer

export type Scene = {
  version: 1
  id: string
  name: string
  /** Place in the Etsy listing; 1 is the thumbnail. */
  order: number
  /** Set of mockups it belongs to; matched case-insensitively. */
  category?: string
  source?: string
  width: number
  height: number
  layers: Layer[]
  clips?: Clip[]
}

// An animation of a scene: the camera and the light over a few seconds,
// rendered as a video for the listing and as a small one for hover previews.
// Framing is relative to the posters, so a clip fits any scene it's put on.

/** Where the camera is and how the picture looks at one moment. */
export type Shot = {
  /** 0 shows the whole room, 1 fills the frame with the poster(s). */
  frame: number
  /** Extra zoom on top of `frame`; 1 is none. */
  zoom: number
  /** Shift of the view centre, in poster widths and heights. */
  x: number
  y: number
  /** Degrees, clockwise. */
  rotate: number
  /** −1 … 1 stop. */
  exposure: number
  /** −1 cool … 1 warm. */
  warmth: number
  /** 0 … 1 lens blur. */
  blur: number
  /** 0 … 1 darkened corners. */
  vignette: number
  /** 0 the blank sheet … 1 the design. */
  design: number
  /** A light sweep across the glass: 0 … 1 is across the poster, outside is off. */
  glint: number
}

export const EASES = ["smooth", "out", "in", "linear"] as const
export type Ease = (typeof EASES)[number]

export type Keyframe = {
  /** 0 … 1 of the clip, so changing the duration keeps the timing. */
  t: number
  /** Easing towards the next key. */
  ease: Ease
  shot: Shot
}

/** What a template holds: a clip without a scene. */
export type Motion = {
  /** Seconds. */
  duration: number
  /** 0 … 1 handheld drift, loops seamlessly. */
  shake: number
  /** At least one, sorted by `t`. */
  keys: Keyframe[]
}

export type Clip = Motion & {
  id: string
  name: string
  /** Rendered with the listing export. */
  listing: boolean
  /** Hover video in the scene folder, named after what it shows. */
  preview?: string
}

export type Template = Motion & {
  id: string
  name: string
  /** Shipped with the app, can't be deleted. */
  builtIn?: boolean
}

export type ClipSummary = Pick<Clip, "id" | "name" | "duration" | "listing"> & {
  preview: string | null
}

export type SceneSummary = Pick<
  Scene,
  "id" | "name" | "order" | "width" | "height" | "category"
> & { thumb: string | null; clips: ClipSummary[] }

export type CategorySummary = { name: string; count: number }

/** pixel × 0.921 × (R 1.024 · G 1.000 · B 0.970) — 8 % toward the paper white. */
export const PAPER_TONE: [number, number, number] = [
  0.921 * 1.024,
  0.921,
  0.921 * 0.97,
]

/** Etsy: shortest edge of every exported mockup. */
export const EXPORT_EDGE = 2000
