import { resize, type Rect } from "./resample"
import { extractSheet, type Pixels } from "./sheet"
import type { Quad } from "./types"

// Heavy pixel work off the main thread. Posters are sent once and kept here
// by id, so each resample only ships the result back.

export type PixelRequest =
  | { id: number; type: "sheet"; room: Pixels; quad: Quad; flat: number }
  | { id: number; type: "poster"; key: number; pixels: Pixels }
  | { id: number; type: "drop"; key: number }
  | { id: number; type: "resize"; key: number; crop: Rect; width: number; height: number }

const posters = new Map<number, Pixels>()

self.onmessage = (event: MessageEvent<PixelRequest>) => {
  const request = event.data
  try {
    if (request.type === "sheet") {
      const result = extractSheet(request.room, request.quad, { flat: request.flat })
      self.postMessage({ id: request.id, result }, { transfer: [result.light.buffer, result.shine.buffer] })
    } else if (request.type === "poster") {
      posters.set(request.key, request.pixels)
      self.postMessage({ id: request.id })
    } else if (request.type === "drop") {
      posters.delete(request.key)
      self.postMessage({ id: request.id })
    } else {
      const poster = posters.get(request.key)
      if (!poster) throw new Error("Unknown poster")
      const result = resize(poster, request.crop, request.width, request.height)
      self.postMessage({ id: request.id, result }, { transfer: [result.data.buffer] })
    }
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) })
  }
}
