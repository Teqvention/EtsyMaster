import {
  autoDetectRenderer,
  BlurFilter,
  CanvasSource,
  ColorMatrixFilter,
  Container,
  ImageSource,
  Matrix,
  Mesh,
  MeshGeometry,
  RenderTexture,
  Sprite,
  Texture,
  type Filter,
  type Renderer,
} from "pixi.js"

import { registerBlendModes } from "./blend"
import { resamplePoster } from "./client"
import { apply, coverCrop, grow, homography, rectQuad, sheetSize } from "./geometry"
import type { Frame } from "./motion"
import {
  PAPER_TONE,
  type ImageLayer,
  type Layer,
  type PosterChild,
  type PosterLayer,
  type Quad,
  type Scene,
} from "./types"

// Draws a scene with PixiJS. Layers map one to one onto display objects;
// a poster is a perspective mesh on its exact quad whose UVs come from the
// overscanned quad, so the clip needs no mask and every blend mode works.

registerBlendModes()

/** A layer image: a URL, or pixels the editor holds (painted or generated). */
export type Source = string | HTMLCanvasElement | OffscreenCanvas | ImageBitmap

export type BuildOptions = {
  /** Layer `src` → where its pixels are. */
  resolve: (src: string) => Source
  /** The design to show; null draws a neutral sheet. */
  poster: ImageBitmap | null
  /** Resample the poster to exactly the quad's size (export) instead of a coarse size bucket. */
  exact?: boolean
  /** Layers hidden on top of `visible`, e.g. everything from the poster up while brushing. */
  hide?: Set<string>
}

const GRID = 32
/** Width of the glint texture along the sweep, in poster diagonals. */
const GLINT_BAND = 0.5

/** What an animation frame changes on a poster. */
type PosterParts = {
  /** The design and its light map, faded together for `design`. */
  fades: { object: Mesh; opacity: number }[]
  glint: Mesh
  /** Per grid vertex: how far along the sweep it sits, 0 … 1. */
  along: Float32Array
}

export class SceneRenderer {
  /** The layers, in scene px; an animation frame moves it as the camera. */
  readonly root = new Container()
  /** `root` plus what sits on the frame rather than in the room. */
  private stage = new Container()
  private parts: PosterParts[] = []
  private partsOf = new WeakMap<Container, PosterParts>()
  private vignette: Sprite
  private grade = new ColorMatrixFilter({ resolution: "inherit", antialias: "inherit" })
  private blur = new BlurFilter({ strength: 0, quality: 4, resolution: "inherit", antialias: "inherit" })
  private filtered = ""
  private textures = new Map<Source, Promise<Texture>>()
  private posters = new Map<string, Promise<Texture>>()
  /** Last resampled poster per design and crop, shown while a new size is made. */
  private ready = new Map<string, Texture>()
  private resolved = new WeakMap<Promise<Texture>, Texture>()
  private generation = 0
  private destroyed = false
  private scene: Scene | null = null
  /** A texture the last build had to stand in for has arrived; build again. */
  onTexture?: () => void

  private constructor(readonly renderer: Renderer) {
    this.vignette = new Sprite(vignetteTexture())
    this.vignette.visible = false
    this.blur.repeatEdgePixels = true
    this.stage.addChild(this.root, this.vignette)
  }

  static async create(canvas?: HTMLCanvasElement) {
    const renderer = await autoDetectRenderer({
      preference: "webgl",
      canvas,
      antialias: true,
      useBackBuffer: true,
      backgroundAlpha: 0,
      autoDensity: !!canvas,
      resolution: canvas ? window.devicePixelRatio : 1,
      width: 1,
      height: 1,
    })
    return new SceneRenderer(renderer)
  }

  /** Replace the display list with `scene`. False when a newer build overtook it. */
  async build(scene: Scene, options: BuildOptions): Promise<boolean> {
    if (this.destroyed) return false
    const generation = ++this.generation
    const objects = await Promise.all(
      scene.layers.map((layer) => this.layerObject(layer, options))
    )
    if (generation !== this.generation || this.destroyed) {
      for (const o of objects) o.destroy({ children: true })
      return false
    }
    for (const child of this.root.removeChildren()) child.destroy({ children: true })
    this.root.addChild(...objects)
    this.parts = objects.flatMap((o) => this.partsOf.get(o) ?? [])
    this.scene = scene
    return true
  }

  /** Re-upload pixels the editor changed in place (brush strokes). */
  async refresh(source: Source) {
    const texture = await this.textures.get(source)
    if (!this.destroyed) texture?.source.update()
  }

  /** Forget a source the editor has dropped. */
  release(source: Source) {
    const texture = this.textures.get(source)
    this.textures.delete(source)
    texture?.then((t) => t.destroy(true))
  }

  /**
   * Draw onto the canvas, scene → screen through `view`. With an animation
   * `frame` the scene is seen through its camera, in a scene-sized frame.
   */
  draw(view: Matrix, width: number, height: number, frame: Frame | null = null) {
    if (this.destroyed) return
    const r = this.renderer
    if (r.width !== width || r.height !== height) r.resize(width, height)
    this.pose(frame, view.a)
    r.render({ container: this.stage, transform: view, clearColor: [0, 0, 0, 0] })
  }

  /** The scene at `scale` × its own size, as straight RGBA. */
  pixels(scale = 1) {
    if (!this.scene) throw new Error("Nothing built")
    const width = Math.round(this.scene.width * scale)
    const height = Math.round(this.scene.height * scale)
    const target = RenderTexture.create({ width, height, antialias: true })
    this.pose(null, scale)
    this.renderer.render({
      container: this.stage,
      target,
      transform: new Matrix().scale(scale, scale),
      clearColor: [1, 1, 1, 1],
    })
    const { pixels } = this.renderer.extract.pixels(target)
    target.destroy(true)
    return { data: new Uint8ClampedArray(pixels.buffer), width, height }
  }

  /** The canvas `draw` renders to; what the video encoder reads. */
  get canvas() {
    return this.renderer.canvas as HTMLCanvasElement
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.generation++
    // Renderer first, so no shader still holds the textures when they go.
    this.renderer.destroy()
    this.stage.destroy({ children: true })
    this.grade.destroy()
    this.blur.destroy()
    for (const t of [...this.textures.values(), ...this.posters.values()]) {
      t.then((t) => t.destroy(true)).catch(() => {})
    }
  }

  // Camera, grade, blur, vignette, design fade and glint for one frame; null
  // puts everything back as the scene is. `scale` is target px per scene px.
  private pose(frame: Frame | null, scale: number) {
    const scene = this.scene
    const { x = 0, y = 0, zoom = 1, rotate = 0 } = frame?.camera ?? {}
    const w = scene?.width ?? 0
    const h = scene?.height ?? 0
    this.root.setFromMatrix(
      frame ? new Matrix().translate(-x, -y).scale(zoom, zoom).rotate(rotate).translate(w / 2, h / 2) : new Matrix()
    )

    const filters: Filter[] = []
    if (frame && (frame.exposure || frame.warmth)) {
      const gain = 2 ** frame.exposure
      const r = gain * (1 + 0.1 * frame.warmth)
      const g = gain * (1 + 0.02 * frame.warmth)
      const b = gain * (1 - 0.14 * frame.warmth)
      this.grade.matrix = [r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0]
      filters.push(this.grade)
    }
    if (frame && frame.blur > 0.005) {
      this.blur.strength = frame.blur * 0.012 * Math.min(w, h) * scale
      filters.push(this.blur)
    }
    const key = filters.length ? filters.map((f) => (f === this.grade ? "g" : "b")).join("") : ""
    if (key !== this.filtered) {
      this.root.filters = filters.length ? filters : null
      this.filtered = key
    }

    this.vignette.visible = !!frame && frame.vignette > 0.005
    this.vignette.alpha = frame?.vignette ?? 0
    this.vignette.setSize(w, h)

    const design = frame ? Math.min(1, Math.max(0, frame.design)) : 1
    const glint = frame?.glint ?? -1
    const lit = glint > -GLINT_BAND && glint < 1 + GLINT_BAND
    for (const part of this.parts) {
      for (const { object, opacity } of part.fades) object.alpha = opacity * design
      part.glint.visible = lit
      if (!lit) continue
      const uvs = part.glint.geometry.uvs
      for (let i = 0; i < part.along.length; i++) {
        uvs[i * 2] = (part.along[i] - glint) / GLINT_BAND + 0.5
        uvs[i * 2 + 1] = 0.5
      }
      part.glint.geometry.getBuffer("aUV").update()
    }
  }

  private async layerObject(layer: Layer, options: BuildOptions) {
    const hidden = !layer.visible || !!options.hide?.has(layer.id)
    if (layer.kind === "image") {
      const sprite = new Sprite(await this.texture(options.resolve(layer.src)))
      sprite.position.set(layer.x, layer.y)
      sprite.setSize(layer.width, layer.height)
      style(sprite, layer, hidden)
      return sprite
    }
    return this.posterObject(layer, options, hidden)
  }

  private async posterObject(layer: PosterLayer, options: BuildOptions, hidden: boolean) {
    const container = new Container()
    container.visible = !hidden
    const over = grow(layer.quad, layer.overscan)
    const [texture, children] = await Promise.all([
      this.posterTexture(layer, over, options),
      Promise.all(layer.children.map((c) => this.texture(options.resolve(c.src)))),
    ])

    const design = new Mesh({ geometry: quadGeometry(layer.quad, over), texture })
    style(design, layer, false)
    if (layer.tone && options.poster) design.tint = PAPER_TONE
    container.addChild(design)
    const fades = [{ object: design, opacity: layer.opacity }]

    layer.children.forEach((child: PosterChild, i) => {
      const mesh = new Mesh({ geometry: quadGeometry(layer.quad, over), texture: children[i] })
      style(mesh, child, !child.visible || !!options.hide?.has(child.id))
      container.addChild(mesh)
      // The light map is the sheet's own shading: on the blank sheet it would count twice.
      if (child.role === "light") fades.push({ object: mesh, opacity: child.opacity })
    })

    const { geometry, along } = glintGeometry(layer.quad)
    const glint = new Mesh({ geometry, texture: glintTexture() })
    glint.blendMode = "screen"
    glint.alpha = 0.55
    glint.visible = false
    container.addChild(glint)
    this.partsOf.set(container, { fades, glint, along })
    return container
  }

  private texture(source: Source) {
    let texture = this.textures.get(source)
    if (!texture) {
      texture = load(source)
      this.textures.set(source, texture)
      texture.catch(() => this.textures.delete(source))
    }
    return texture
  }

  // The design resampled once on the CPU to about the quad's size (as the
  // script's Lanczos/bicubic step) and cropped for `cover`, so the GPU only
// fills in perspective.
  private posterTexture(layer: PosterLayer, over: Quad, options: BuildOptions) {
    const poster = options.poster
    if (!poster) return Promise.resolve(Texture.WHITE)
    const d = (a: number, b: number) => Math.hypot(over[a][0] - over[b][0], over[a][1] - over[b][1])
    // Cover: the sheet's own size (the light map's grid), as in the script.
    let w = layer.fit === "cover" ? sheetSize(layer.quad).width : Math.max(d(0, 1), d(3, 2))
    let h = layer.fit === "cover" ? w * (layer.aspect ?? 1.4) : Math.max(d(0, 3), d(1, 2))
    if (!options.exact) {
      // Dragging corners would otherwise resample on every move.
      const step = 128
      w = Math.ceil(w / step) * step
      h = Math.ceil(h / step) * step
    }
    w = Math.max(1, Math.round(w))
    h = Math.max(1, Math.round(h))
    const crop =
      layer.fit === "cover"
        ? coverCrop(poster.width, poster.height, layer.aspect ?? 1.4)
        : { x: 0, y: 0, width: poster.width, height: poster.height }
    const base = `${posterId(poster)}:${crop.x},${crop.y},${crop.width},${crop.height}`
    const key = `${base}:${w}x${h}`
    let texture = this.posters.get(key)
    if (!texture) {
      let settled = false
      texture = resamplePoster(poster, crop, w, h)
        .then((pixels) => createImageBitmap(new ImageData(pixels.data as Uint8ClampedArray<ArrayBuffer>, w, h)))
        .then(bitmapTexture)
        .then((t) => {
          settled = true
          this.ready.set(base, t)
          this.resolved.set(texture!, t)
          return t
        })
      this.posters.set(key, texture)
      this.evict()
      // Dragging: keep showing the previous size (the mesh spans any
      // texture) and build again when the new one lands.
      const stand = this.ready.get(base)
      if (!options.exact && stand) {
        texture.then(() => this.onTexture?.())
        return Promise.resolve().then(() => (settled ? texture! : stand))
      }
    }
    return texture
  }

  // Bounded cache; never drops what is on screen or standing in.
  private evict() {
    if (this.posters.size <= 12) return
    const keep = new Set<Texture>(this.ready.values())
    for (const object of this.root.children) {
      for (const child of object.children) if (child instanceof Mesh) keep.add(child.texture)
    }
    for (const [key, texture] of [...this.posters]) {
      if (this.posters.size <= 12) break
      const t = this.resolved.get(texture)
      if (!t || keep.has(t)) continue
      this.posters.delete(key)
      t.destroy(true)
    }
  }
}

const ids = new WeakMap<ImageBitmap, number>()
let nextId = 0
function posterId(bitmap: ImageBitmap) {
  let id = ids.get(bitmap)
  if (id === undefined) ids.set(bitmap, (id = nextId++))
  return id
}

function style(
  object: Sprite | Mesh,
  layer: Pick<ImageLayer, "blend" | "opacity">,
  hidden: boolean
) {
  object.blendMode = layer.blend
  object.alpha = layer.opacity
  object.visible = !hidden
}

// Grid over the exact quad (projective, so straight lines stay straight).
// Each vertex samples the texture where the overscanned quad puts it.
function quadGeometry(quad: Quad, over: Quad) {
  const toScene = homography(rectQuad(1, 1), quad)
  const toUv = homography(over, rectQuad(1, 1))
  const n = GRID + 1
  const positions = new Float32Array(n * n * 2)
  const uvs = new Float32Array(n * n * 2)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [x, y] = apply(toScene, i / GRID, j / GRID)
      const [u, v] = apply(toUv, x, y)
      const k = (j * n + i) * 2
      positions[k] = x
      positions[k + 1] = y
      uvs[k] = u
      uvs[k + 1] = v
    }
  }
  const indices = new Uint32Array(GRID * GRID * 6)
  let o = 0
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const a = j * n + i
      indices.set([a, a + 1, a + n, a + 1, a + n + 1, a + n], o)
      o += 6
    }
  }
  return new MeshGeometry({ positions, uvs, indices })
}

// The poster grid again, with UVs set per frame from how far along a
// diagonal sweep (left to right, slightly downhill) each vertex sits.
function glintGeometry(quad: Quad) {
  const n = GRID + 1
  const along = new Float32Array(n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) along[j * n + i] = (i / GRID + (0.5 * j) / GRID) / 1.5
  }
  return { geometry: quadGeometry(quad, quad), along }
}

let glint: Texture | null = null
// A broad soft streak and a thin one beside it, as light catches glass.
function glintTexture() {
  if (glint) return glint
  const c = document.createElement("canvas")
  c.width = 512
  c.height = 1
  const ctx = c.getContext("2d")!
  const image = ctx.createImageData(512, 1)
  for (let i = 0; i < 512; i++) {
    const u = i / 511
    const a = Math.exp(-(((u - 0.5) / 0.12) ** 2)) + 0.5 * Math.exp(-(((u - 0.74) / 0.03) ** 2))
    image.data.set([255, 255, 255, Math.round(Math.min(1, a) * 255)], i * 4)
  }
  ctx.putImageData(image, 0, 0)
  glint = new Texture({ source: new CanvasSource({ resource: c, scaleMode: "linear" }) })
  return glint
}

let vignette: Texture | null = null
function vignetteTexture() {
  if (vignette) return vignette
  const c = document.createElement("canvas")
  c.width = c.height = 256
  const ctx = c.getContext("2d")!
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128 * Math.SQRT2)
  g.addColorStop(0, "rgba(0,0,0,0)")
  g.addColorStop(0.45, "rgba(0,0,0,0)")
  g.addColorStop(0.7, "rgba(0,0,0,0.22)")
  g.addColorStop(0.85, "rgba(0,0,0,0.5)")
  g.addColorStop(1, "rgba(0,0,0,0.8)")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  vignette = new Texture({ source: new CanvasSource({ resource: c, scaleMode: "linear" }) })
  return vignette
}

async function load(source: Source): Promise<Texture> {
  if (typeof source === "string") {
    const response = await fetch(source)
    if (!response.ok) throw new Error(`${source}: ${response.status}`)
    return bitmapTexture(await decode(await response.blob()))
  }
  if (source instanceof ImageBitmap) return bitmapTexture(source)
  return new Texture({
    source: new CanvasSource({
      resource: source as HTMLCanvasElement,
      autoGenerateMipmaps: true,
      scaleMode: "linear",
    }),
  })
}

/** Decode without colour management, so pixels stay what the files hold. */
export function decode(blob: Blob) {
  return createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "premultiply",
  })
}

function bitmapTexture(bitmap: ImageBitmap) {
  return new Texture({
    source: new ImageSource({
      resource: bitmap,
      alphaMode: "premultiplied-alpha",
      autoGenerateMipmaps: true,
      scaleMode: "linear",
    }),
  })
}
