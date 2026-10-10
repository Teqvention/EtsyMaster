"use client"

import { useEffect, useState } from "react"

import { chainPhotoName } from "@/lib/mockups/chain-types"
import type { RenderHost as Host } from "@/lib/pipeline/render-job"

// Puts the render functions on `window` for headless Chrome to call: the
// same scene export and clip encoder the Mockups page uses, so a pipeline
// photo is exactly what the editor's export would give. The renderer loads
// on the first job, never on the server (pixi registers itself only once).

function base64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "")
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function RenderHost() {
  const [status, setStatus] = useState("Waiting for work")

  useEffect(() => {
    const files = new Map<string, Blob>()
    const progress = (text: string) => {
      setStatus(text)
      window.__pipelineProgress?.(text)
    }
    const host: Host = {
      async run(job) {
        files.clear()
        const [{ fetchScene }, { exportScene }, { exportClip }] = await Promise.all([
          import("@/lib/mockups/client"),
          import("@/lib/mockups/export"),
          import("@/lib/mockups/video"),
        ])
        const response = await fetch(job.poster, { cache: "no-store" })
        if (!response.ok) throw new Error(`Poster not found (${response.status})`)
        const poster = await createImageBitmap(await response.blob())
        try {
          for (const [i, id] of job.scenes.entries()) {
            progress(`Photo ${i + 1} of ${job.scenes.length}`)
            files.set(chainPhotoName(i), await exportScene(await fetchScene(id), poster))
          }
          let videoError: string | undefined
          if (job.video) {
            const { sceneId, clip } = job.video
            progress("Video 0 %")
            try {
              const blob = await exportClip(await fetchScene(sceneId), clip, poster, undefined, (done) =>
                progress(`Video ${Math.floor(done * 100)} %`)
              )
              files.set("video.mp4", blob)
            } catch (error) {
              videoError = error instanceof Error ? error.message : String(error)
            }
          }
          progress("Done")
          return { files: [...files].map(([name, blob]) => ({ name, bytes: blob.size })), videoError }
        } finally {
          poster.close()
        }
      },
      async take(name) {
        const blob = files.get(name)
        if (!blob) throw new Error(`Nothing rendered as ${name}`)
        return base64(blob)
      },
    }
    window.__pipelineRender = host
    return () => {
      if (window.__pipelineRender === host) delete window.__pipelineRender
    }
  }, [])

  return <main className="p-6 font-mono text-sm text-muted-foreground">Renderer · {status}</main>
}
