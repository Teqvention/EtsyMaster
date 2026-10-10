import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { chromium, type Browser } from "playwright-core"
import sharp from "sharp"

import { chainPhotoName, type MockupChain } from "@/lib/mockups/chain-types"
import { getChain, getDefaultChain } from "@/lib/mockups/chains"
import { getScene } from "@/lib/mockups/storage"
import { EXPORT_EDGE } from "@/lib/mockups/types"

import { localPathUnder, writeFileUnder } from "./files"
import type { RenderJob, RenderResult } from "./render-job"

// The listing photos and video, rendered from a mockup chain by headless
// Chrome on the /render page: the Mockups page's own WebGL export and
// WebCodecs encoder, so a pipeline photo is what the editor would export.
// One browser for the whole server (on globalThis, so a reload doesn't
// start a second), three pages at a time, closed after a few idle minutes.
// The poster goes in by intercepting the page's request for it; the files
// come back base64, one at a time. Only a chain with a video picked gets
// one; if the browser can't encode H.264, it's made with ffmpeg from the
// first photo instead.

export type RenderedMedia = {
  /** Paths under pipeline/ in storage, in listing order. */
  photos: string[]
  video: string | null
  /** The mockup scene of each photo, in the same order; none for the poster alone. */
  scenes?: string[]
}

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const FFMPEG = process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg"
const PARALLEL = 3
const IDLE_MS = 3 * 60 * 1000
/** A chain of ten 4K scenes and a video takes a few minutes; past this something hangs. */
const TIMEOUT_MS = 15 * 60 * 1000
const POSTER_PATH = "/__pipeline/poster"

const baseUrl = () => process.env.PIPELINE_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`

type Renderer = {
  browser: Promise<Browser> | null
  active: number
  queue: (() => void)[]
  idle?: ReturnType<typeof setTimeout>
}
const global = globalThis as typeof globalThis & { __pipelineRenderer?: Renderer }
const renderer = (global.__pipelineRenderer ??= { browser: null, active: 0, queue: [] })

function browser() {
  renderer.browser ??= chromium
    .launch({
      executablePath: CHROME,
      headless: true,
      args: [
        "--enable-gpu",
        "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
    })
    .then(
      (b) => {
        b.on("disconnected", () => (renderer.browser = null))
        return b
      },
      (error) => {
        renderer.browser = null
        throw new Error(`Couldn't start Chrome for mockups (${CHROME}): ${(error as Error).message}`)
      }
    )
  return renderer.browser
}

/** Runs `work` once one of the PARALLEL slots is free; the browser closes when all are idle a while. */
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (renderer.active < PARALLEL) renderer.active++
  else await new Promise<void>((resolve) => renderer.queue.push(resolve))
  clearTimeout(renderer.idle)
  try {
    return await work()
  } finally {
    const next = renderer.queue.shift()
    if (next) next()
    else if (--renderer.active === 0) {
      renderer.idle = setTimeout(() => {
        const open = renderer.browser
        renderer.browser = null
        open?.then((b) => b.close()).catch(() => {})
      }, IDLE_MS)
    }
  }
}

/** The dev server's word of changed code (next/dist/server/dev/hot-reloader-types), on which a page reloads or refetches. */
const CODE_CHANGES = new Set([
  "turbopack-message",
  "serverComponentChanges",
  "staticParamsChanged",
  "reloadPage",
  "addedPage",
  "removedPage",
])

function isCodeChange(message: string | Buffer) {
  if (typeof message !== "string") return false
  try {
    return CODE_CHANGES.has((JSON.parse(message) as { type?: string }).type ?? "")
  } catch {
    return false
  }
}

function posterType(poster: Buffer) {
  if (poster[0] === 0x89 && poster[1] === 0x50) return "image/png"
  if (poster.subarray(8, 12).toString() === "WEBP") return "image/webp"
  return "image/jpeg"
}

/** Renders `job` with `poster` on a fresh page; answers the files by name. */
function render(job: Omit<RenderJob, "poster">, poster: Buffer, onProgress?: (text: string) => void) {
  return slot(async () => {
    const context = await (await browser()).newContext({ viewport: { width: 900, height: 600 } })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const page = await context.newPage()
      await page.route(`**${POSTER_PATH}`, (route) =>
        route.fulfill({ body: poster, contentType: posterType(poster), headers: { "Cache-Control": "no-store" } })
      )
      // The dev server's live reload, without its code changes: one (an edit,
      // another tab compiling) would reload the page mid-render. The socket
      // itself stays, as the page's first render comes over it.
      await page.routeWebSocket(/\/_next\/hmr/, (ws) => {
        const server = ws.connectToServer()
        server.onMessage((message) => {
          if (!isCodeChange(message)) ws.send(message)
        })
      })
      if (onProgress) await page.exposeFunction("__pipelineProgress", (text: string) => onProgress(text))
      await page.goto(`${baseUrl()}/render`, { waitUntil: "load", timeout: 120_000 })
      await page.waitForFunction(() => !!window.__pipelineRender, undefined, { timeout: 120_000 })

      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Rendering the mockups took too long")), TIMEOUT_MS)
      })
      const result: RenderResult = await Promise.race([
        page.evaluate((j) => window.__pipelineRender!.run(j), { ...job, poster: POSTER_PATH }),
        timeout,
      ])
      const files = new Map<string, Buffer>()
      for (const { name } of result.files) {
        const data = await page.evaluate((n) => window.__pipelineRender!.take(n), name)
        files.set(name, Buffer.from(data, "base64"))
      }
      return { files, videoError: result.videoError }
    } finally {
      clearTimeout(timer)
      await context.close().catch(() => {})
    }
  })
}

/** The chain's video; none when it has none picked (or its clip was deleted since). */
async function videoOf(chain: MockupChain): Promise<RenderJob["video"]> {
  if (!chain.video) return null
  const scene = await getScene(chain.video.sceneId).catch(() => null)
  const clip = scene?.clips?.find((c) => c.id === chain.video!.clipId)
  return clip ? { sceneId: chain.video.sceneId, clip } : null
}

/** The chain (the default one when null or deleted) with this poster, written into `dir` under pipeline/. */
export async function renderChainMedia(
  chainId: string | null,
  poster: Buffer,
  dir: string,
  onProgress?: (text: string) => void
): Promise<RenderedMedia> {
  const chain = (chainId && (await getChain(chainId).catch(() => null))) || (await getDefaultChain())
  if (!chain) throw new Error("There's no mockup chain yet: make one on the Mockups page")
  if (!chain.scenes.length) throw new Error(`The mockup chain "${chain.name}" has no photos`)

  const video = await videoOf(chain)
  const { files, videoError } = await render({ scenes: chain.scenes, video }, poster, onProgress)
  const photos: string[] = []
  for (const i of chain.scenes.keys()) {
    const name = chainPhotoName(i)
    const data = files.get(name)
    if (!data?.length) throw new Error(`Photo ${i + 1} of the chain didn't render`)
    await writeFileUnder(`${dir}/${name}`, data)
    photos.push(`${dir}/${name}`)
  }

  let videoFile: string | null = null
  if (video) {
    videoFile = `${dir}/video.mp4`
    const data = files.get("video.mp4")
    if (data?.length) await writeFileUnder(videoFile, data)
    else {
      console.warn(`Mockup video by ffmpeg instead: ${videoError ?? "the browser made none"}`)
      onProgress?.("Video with ffmpeg")
      await ffmpegVideo(photos[0], videoFile)
    }
  }
  return { photos, video: videoFile, scenes: chain.scenes }
}

/** "Poster only": the poster itself as the listing's one photo, EXPORT_EDGE on its short side, no video. */
export async function renderPosterOnly(poster: Buffer, dir: string): Promise<RenderedMedia> {
  const image = sharp(poster).rotate()
  const { width = EXPORT_EDGE, height = EXPORT_EDGE } = await image.metadata()
  const f = EXPORT_EDGE / Math.min(width, height)
  const jpeg = await image
    .toColourspace("srgb")
    .flatten({ background: "#ffffff" })
    .resize(Math.round(width * f), Math.round(height * f), { kernel: "lanczos3" })
    .withIccProfile("srgb")
    .jpeg({ quality: 92 })
    .toBuffer()
  const file = `${dir}/${chainPhotoName(0)}`
  await writeFileUnder(file, jpeg)
  return { photos: [file], video: null }
}

/** These scenes with this poster, as listing JPEGs, in order. */
export async function renderPhotos(poster: Buffer, sceneIds: string[]): Promise<Buffer[]> {
  if (!sceneIds.length) return []
  const { files } = await render({ scenes: sceneIds, video: null }, poster)
  return sceneIds.map((_, i) => {
    const data = files.get(chainPhotoName(i))
    if (!data?.length) throw new Error(`Photo ${i + 1} didn't render`)
    return data
  })
}

const run = promisify(execFile)

/**
 * An eight second push in on a photo, 1080 px on the short side, H.264 in
 * an MP4 that starts playing at once: what Etsy wants of a listing video.
 */
async function ffmpegVideo(photo: string, out: string) {
  const input = await localPathUnder(photo)
  const { width = 2000, height = 2000 } = await sharp(input).metadata()
  const f = 1080 / Math.min(width, height)
  const even = (v: number) => Math.max(2, Math.round((v * f) / 2) * 2)
  const size = `${even(width)}x${even(height)}`
  const frames = 8 * 30
  // Zooming a doubled image keeps the motion from stepping a pixel at a time.
  const filter = [
    "scale=iw*2:ih*2:flags=lanczos",
    `zoompan=z='1+0.18*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${size}:fps=30`,
    "format=yuv420p",
  ].join(",")
  // Made in a temporary folder, then stored.
  const folder = await mkdtemp(path.join(tmpdir(), "etsy-video-"))
  const output = path.join(folder, "video.mp4")
  const args = (codec: string[]) => [
    "-y",
    "-loglevel",
    "error",
    "-i",
    input,
    "-vf",
    filter,
    "-frames:v",
    String(frames),
    ...codec,
    "-movflags",
    "+faststart",
    output,
  ]
  try {
    try {
      await run(FFMPEG, args(["-c:v", "libx264", "-preset", "medium", "-crf", "18"]), { maxBuffer: 1 << 24 })
    } catch {
      await run(FFMPEG, args(["-c:v", "h264_videotoolbox", "-b:v", "8M"]), { maxBuffer: 1 << 24 })
    }
    await writeFileUnder(out, await readFile(output))
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}
