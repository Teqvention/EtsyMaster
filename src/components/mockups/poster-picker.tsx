"use client"

import * as React from "react"
import { ImageUpIcon, RotateCcwIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { choosePoster, getPoster, resetPoster, subscribePoster } from "@/lib/mockups/poster-store"

export function usePoster() {
  return React.useSyncExternalStore(subscribePoster, getPoster, () => null)
}

/** Which design the mockups show; shared by the list and every editor. */
export function PosterPicker() {
  const poster = usePoster()
  const input = React.useRef<HTMLInputElement>(null)
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Button variant="outline" size="sm" onClick={() => input.current?.click()} className="min-w-0">
        <ImageUpIcon />
        <span className="truncate">{poster ? poster.name : "Loading…"}</span>
      </Button>
      {poster && !poster.test && (
        <Button variant="ghost" size="icon-sm" aria-label="Back to test poster" onClick={() => resetPoster()}>
          <RotateCcwIcon />
        </Button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) choosePoster(file).catch((error) => toast.error(`Can't read ${file.name}: ${error.message}`))
          e.target.value = ""
        }}
      />
    </div>
  )
}
