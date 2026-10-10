import type { Clip } from "@/lib/mockups/types"

// What the headless /render page is asked to draw, and what it hands back.
// Shared by the page (browser) and render.ts (server), so types only.

export type RenderJob = {
  /** Where the page fetches the poster: the renderer answers it from memory. */
  poster: string
  /** Mockup scenes in listing order: 01.jpg, 02.jpg… */
  scenes: string[]
  /** The listing video: a clip played on one scene, or none. */
  video: { sceneId: string; clip: Clip } | null
}

export type RenderResult = {
  /** Names and sizes of the files made, ready to be taken one by one. */
  files: { name: string; bytes: number }[]
  /** Why the video couldn't be made in the browser (no H.264 encoder, say). */
  videoError?: string
}

export type RenderHost = {
  run(job: RenderJob): Promise<RenderResult>
  /** One file of the last run, base64. */
  take(name: string): Promise<string>
}

declare global {
  interface Window {
    __pipelineRender?: RenderHost
    /** Set by the renderer, so the page can say how far it is. */
    __pipelineProgress?: (text: string) => void
  }
}
