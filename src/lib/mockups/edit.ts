import type { ImageLayer, Layer, PosterChild, PosterLayer, Scene } from "./types"

// Pure scene edits for the editor. Layer ids are unique across the scene,
// poster children included.

export type AnyLayer = Layer | PosterChild

export function findLayer(scene: Scene, id: string | null): AnyLayer | null {
  for (const layer of scene.layers) {
    if (layer.id === id) return layer
    if (layer.kind === "poster") {
      const child = layer.children.find((c) => c.id === id)
      if (child) return child
    }
  }
  return null
}

/** The poster a child belongs to. */
export function parentOf(scene: Scene, id: string) {
  return scene.layers.find(
    (l): l is PosterLayer => l.kind === "poster" && l.children.some((c) => c.id === id)
  )
}

export function updateLayer(scene: Scene, id: string, patch: Partial<AnyLayer>): Scene {
  return {
    ...scene,
    layers: scene.layers.map((layer) => {
      if (layer.id === id) return { ...layer, ...patch } as Layer
      if (layer.kind === "poster" && layer.children.some((c) => c.id === id)) {
        return {
          ...layer,
          children: layer.children.map((c) => (c.id === id ? ({ ...c, ...patch } as PosterChild) : c)),
        }
      }
      return layer
    }),
  }
}

export function removeLayer(scene: Scene, id: string): Scene {
  return {
    ...scene,
    layers: scene.layers
      .filter((l) => l.id !== id)
      .map((l) => (l.kind === "poster" ? { ...l, children: l.children.filter((c) => c.id !== id) } : l)),
  }
}

/** Move up (+1, towards the top) or down (−1) within its own list. */
export function moveLayer(scene: Scene, id: string, by: 1 | -1): Scene {
  const shift = <T extends { id: string }>(list: T[]) => {
    const i = list.findIndex((l) => l.id === id)
    const j = i + by
    if (i < 0 || j < 0 || j >= list.length) return list
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  }
  return {
    ...scene,
    layers: shift(scene.layers).map((l) =>
      l.kind === "poster" ? { ...l, children: shift(l.children) } : l
    ),
  }
}

/** Insert above `afterId` (or on top). */
export function insertLayer(scene: Scene, layer: Layer, afterId?: string | null): Scene {
  const layers = [...scene.layers]
  const i = afterId ? layers.findIndex((l) => l.id === afterId) : -1
  layers.splice(i < 0 ? layers.length : i + 1, 0, layer)
  return { ...scene, layers }
}

export function uniqueId(scene: Scene, base: string) {
  const taken = new Set<string>()
  for (const l of scene.layers) {
    taken.add(l.id)
    if (l.kind === "poster") l.children.forEach((c) => taken.add(c.id))
  }
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

/** A fresh file name, so undo can still reach the old pixels. */
export function freshFile(base: string, ext = "png") {
  return `${base.replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "layer"}-${Date.now().toString(36)}.${ext}`
}

/** Index in `scene.layers` of the poster a front layer sits over: the nearest one below it. */
export function posterBelow(scene: Scene, id: string) {
  const i = scene.layers.findIndex((l) => l.id === id)
  for (let j = i - 1; j >= 0; j--) if (scene.layers[j].kind === "poster") return j
  return -1
}

export function isImage(layer: AnyLayer | null): layer is ImageLayer {
  return !!layer && layer.kind === "image" && "x" in layer
}
