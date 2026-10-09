import type { PixelRequest } from "./pixels.worker"
import type { Rect } from "./resample"
import type { Pixels, SheetResult } from "./sheet"
import type { Quad, Scene, Template } from "./types"

// Browser side of the mockup tool: API calls and pixel plumbing.

export const fileUrl = (id: string, file: string, version = 0) =>
  `/api/mockups/${id}/files/${file}${version ? `?v=${version}` : ""}`

async function check(response: Response) {
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error ?? `${response.status} ${response.statusText}`)
  }
  return response
}

export async function fetchScene(id: string): Promise<Scene> {
  return (await check(await fetch(`/api/mockups/${id}`, { cache: "no-store" }))).json()
}

export async function putScene(scene: Scene) {
  await check(
    await fetch(`/api/mockups/${scene.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scene),
    })
  )
}

export async function putFile(id: string, file: string, data: Blob) {
  await check(await fetch(fileUrl(id, file), { method: "PUT", body: data }))
}

export async function fetchTemplates(): Promise<Template[]> {
  return (await check(await fetch("/api/mockups/templates", { cache: "no-store" }))).json()
}

export async function postTemplate(template: Omit<Template, "id">): Promise<Template> {
  const body = JSON.stringify(template)
  return (await check(await fetch("/api/mockups/templates", { method: "POST", body }))).json()
}

export async function putTemplate(id: string, patch: Partial<Template>): Promise<Template> {
  const body = JSON.stringify(patch)
  return (await check(await fetch(`/api/mockups/templates/${id}`, { method: "PUT", body }))).json()
}

export async function deleteTemplate(id: string) {
  await check(await fetch(`/api/mockups/templates/${id}`, { method: "DELETE" }))
}

/** Raw RGBA → listing JPEG (2000 px short edge, q92) on the server. */
export async function toJpeg(pixels: Pixels) {
  const response = await check(
    await fetch(`/api/mockups/export?w=${pixels.width}&h=${pixels.height}`, {
      method: "POST",
      body: new Blob([pixels.data as Uint8ClampedArray<ArrayBuffer>]),
    })
  )
  return response.blob()
}

// One shared worker for sheet extraction and poster resampling.
let worker: Worker | null = null
let nextRequest = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

type Request = DistributiveOmit<PixelRequest, "id">
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

function call<T>(request: Request, transfer: Transferable[] = []) {
  if (!worker) {
    worker = new Worker(new URL("./pixels.worker.ts", import.meta.url), { type: "module" })
    worker.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const { id, result, error } = event.data
      const p = pending.get(id)
      pending.delete(id)
      if (error) p?.reject(new Error(error))
      else p?.resolve(result)
    }
  }
  const id = nextRequest++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    worker!.postMessage({ ...request, id }, transfer)
  })
}

/** Light and shine maps from the empty sheet. */
export function extractSheetInWorker(room: Pixels, quad: Quad, flat: number) {
  return call<SheetResult>({ type: "sheet", room, quad, flat })
}

const posterKeys = new WeakMap<ImageBitmap, Promise<number>>()
let nextPoster = 0

/** The poster `crop` resampled to width × height with Lanczos (as PIL). */
export function resamplePoster(poster: ImageBitmap, crop: Rect, width: number, height: number) {
  let key = posterKeys.get(poster)
  if (!key) {
    const k = nextPoster++
    key = readPixels(poster).then((pixels) =>
      call({ type: "poster", key: k, pixels }, [pixels.data.buffer]).then(() => k)
    )
    posterKeys.set(poster, key)
  }
  return key.then((k) => call<Pixels>({ type: "resize", key: k, crop, width, height }))
}

/** Free a poster's pixels in the worker. */
export function dropPoster(poster: ImageBitmap) {
  posterKeys.get(poster)?.then((key) => call({ type: "drop", key }))
  posterKeys.delete(poster)
}

export function canvas(width: number, height: number) {
  const c = document.createElement("canvas")
  c.width = width
  c.height = height
  return c
}

export function toCanvas({ data, width, height }: Pixels) {
  const c = canvas(width, height)
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0)
  return c
}

export function pngBlob(c: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed"))), "image/png")
  )
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Pixels of an image (straight alpha). */
export async function readPixels(bitmap: ImageBitmap | HTMLCanvasElement): Promise<Pixels> {
  const c = canvas(bitmap.width, bitmap.height)
  const ctx = c.getContext("2d", { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  const { data } = ctx.getImageData(0, 0, c.width, c.height)
  return { data, width: c.width, height: c.height }
}

/** Neutral stand-in design: gradient, grid and corner marks to judge placement. */
export function testPoster(width = 1500, height = 2100) {
  const c = canvas(width, height)
  const ctx = c.getContext("2d")!
  const g = ctx.createLinearGradient(0, 0, width, height)
  g.addColorStop(0, "#2f4858")
  g.addColorStop(0.5, "#86bbd8")
  g.addColorStop(1, "#f6ae2d")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = "rgba(255,255,255,0.5)"
  ctx.lineWidth = 3
  for (let x = 0; x <= width; x += width / 10) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }
  for (let y = 0; y <= height; y += width / 10) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
  ctx.fillStyle = "#f26419"
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, width * 0.22, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = "#fff"
  ctx.font = `bold ${width * 0.09}px sans-serif`
  ctx.textAlign = "center"
  ctx.fillText("TEST POSTER", width / 2, height / 2 + width * 0.03)
  const s = width * 0.06
  ctx.fillStyle = "#e63946"
  ctx.fillRect(0, 0, s, s)
  ctx.fillStyle = "#2a9d8f"
  ctx.fillRect(width - s, 0, s, s)
  ctx.fillStyle = "#264653"
  ctx.fillRect(width - s, height - s, s, s)
  ctx.fillStyle = "#e9c46a"
  ctx.fillRect(0, height - s, s, s)
  return createImageBitmap(c)
}
