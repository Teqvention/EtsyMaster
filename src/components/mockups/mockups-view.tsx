"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { zipSync } from "fflate"
import { FileArchiveIcon, FrameIcon, LoaderCircleIcon, PlusIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"

import { PosterPicker, usePoster } from "@/components/mockups/poster-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { download, fetchScene, fileUrl } from "@/lib/mockups/client"
import { exportName, exportScene } from "@/lib/mockups/export"
import type { SceneSummary } from "@/lib/mockups/types"

export function MockupsView() {
  const router = useRouter()
  const poster = usePoster()
  const [scenes, setScenes] = React.useState<SceneSummary[] | null>(null)
  const [progress, setProgress] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState<"room" | "reference" | null>(null)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const referenceInput = React.useRef<HTMLInputElement>(null)
  const [name, setName] = React.useState("")

  React.useEffect(() => {
    fetch("/api/mockups", { cache: "no-store" })
      .then((r) => r.json())
      .then(setScenes)
      .catch(() => toast.error("Couldn't load the mockups"))
  }, [])

  // A room with a blank sheet as is, or a finished mockup ("reference") that
  // Nano Banana redraws blank before corners, light and shine are set up.
  async function create(file: File, kind: "room" | "reference") {
    setCreating(kind)
    try {
      const body = new FormData()
      body.set("name", name.trim() || file.name.replace(/\.[^.]+$/, ""))
      body.set("image", file)
      const url = kind === "room" ? "/api/mockups" : "/api/mockups/reference"
      const response = await fetch(url, { method: "POST", body })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? response.statusText)
      if (result.located === false) toast.warning("Couldn't find the sheet — set the four corners by hand")
      router.push(`/mockups/${result.id}`)
    } catch (e) {
      toast.error(`Couldn't create the mockup: ${(e as Error).message}`)
      setCreating(null)
    }
  }

  // Every mockup with the current poster, as 01.jpg … in one zip.
  async function exportAll() {
    if (!poster || !scenes) return
    const files: Record<string, Uint8Array> = {}
    try {
      for (const [i, summary] of scenes.entries()) {
        setProgress(`${i + 1} / ${scenes.length}`)
        const scene = await fetchScene(summary.id)
        const jpeg = await exportScene(scene, poster.bitmap)
        files[exportName(scene)] = new Uint8Array(await jpeg.arrayBuffer())
      }
      const zip = zipSync(files, { level: 0 })
      const base = poster.test ? "mockups" : poster.name.replace(/\.[^.]+$/, "")
      download(new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${base}.zip`)
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`)
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          Rooms your poster is placed into. Exports are 2000 px on the short edge, numbered in
          listing order.
        </p>
        <PosterPicker />
        <Button size="sm" onClick={exportAll} disabled={!poster || !scenes?.length || !!progress}>
          {progress ? <LoaderCircleIcon className="animate-spin" /> : <FileArchiveIcon />}
          {progress ? `Rendering ${progress}` : "Export all"}
        </Button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
        {scenes === null
          ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-square rounded-xl" />)
          : scenes.map((scene) => (
              <Link
                key={scene.id}
                href={`/mockups/${scene.id}`}
                className="group overflow-hidden rounded-xl border bg-card transition-colors hover:border-foreground/30"
              >
                <div className="grid aspect-square place-items-center overflow-hidden bg-muted">
                  {scene.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fileUrl(scene.id, scene.thumb)}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <FrameIcon className="size-8 text-muted-foreground" />
                  )}
                </div>
                <div className="flex items-baseline gap-2 px-3 py-2">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {String(scene.order).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{scene.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {scene.width}×{scene.height}
                  </span>
                </div>
              </Link>
            ))}

        <div className="flex aspect-square flex-col justify-center gap-3 rounded-xl border border-dashed p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <PlusIcon className="size-4" /> New mockup
          </div>
          <p className="text-xs text-muted-foreground">
            Upload a room photo or AI render with a blank white sheet in the frame. Then set the
            four corners and generate light &amp; shine. Or start from someone else&apos;s finished
            mockup and let AI empty the frame.
          </p>
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={!!creating}>
            {creating === "room" && <LoaderCircleIcon className="animate-spin" />}
            Choose room image…
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => referenceInput.current?.click()}
            disabled={!!creating}
            title="Upload a finished mockup: it's redrawn with a blank sheet, then corners, light and shine are set up"
          >
            {creating === "reference" ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
            {creating === "reference" ? "Generating… (~1 min)" : "Generate from reference…"}
          </Button>
          {[
            { ref: fileInput, kind: "room" as const },
            { ref: referenceInput, kind: "reference" as const },
          ].map(({ ref, kind }) => (
            <input
              key={kind}
              ref={ref}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) create(file, kind)
                e.target.value = ""
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
