"use client"

import * as React from "react"
import { HistoryIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { timeAgo } from "@/components/generation/parts"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { restorePosters } from "@/hooks/use-uploads"
import { posterKey } from "@/lib/uploads/groups"
import type { RemovedView } from "@/lib/uploads/types"

// The posters deleted from the uploads, out of the way: a quiet button by
// the tabs opens the list, and any of them can come back as it was.

export function RemovedLog({ removed }: { removed: RemovedView[] }) {
  const [busy, setBusy] = React.useState<string | null>(null)
  if (removed.length === 0) return null

  async function restore(key: string) {
    setBusy(key)
    try {
      await restorePosters([key])
      toast("Poster back in the uploads", { description: "Approved again, with the listing it had." })
    } catch (error) {
      toast.error(`Couldn't bring it back: ${(error as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="xs" className="text-muted-foreground tabular-nums" />}
      >
        <HistoryIcon />
        {removed.length} deleted
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-1 p-0">
        <PopoverHeader className="px-3 pt-3">
          <PopoverTitle>Deleted posters</PopoverTitle>
          <PopoverDescription className="text-xs">
            No longer approved. Restore one to put it back in the uploads, listing and all.
          </PopoverDescription>
        </PopoverHeader>
        <ul className="flex max-h-80 flex-col overflow-y-auto p-1.5">
          {removed.map((entry) => {
            const key = posterKey(entry.generationId, entry.outputId)
            return (
              <li
                key={key}
                className="flex items-center gap-2.5 rounded-md p-1.5 transition-colors duration-150 [@media(hover:hover)]:hover:bg-muted/60"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={entry.thumb}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="h-10 shrink-0 rounded-sm bg-muted object-cover ring-1 ring-foreground/10"
                  style={{
                    aspectRatio:
                      entry.posterWidth && entry.posterHeight ? `${entry.posterWidth} / ${entry.posterHeight}` : "3 / 4",
                  }}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-xs" title={entry.title}>
                    {entry.title}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {entry.folder} · {timeAgo(entry.removedAt)}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy !== null}
                  onClick={() => restore(key)}
                  className="shrink-0 text-muted-foreground"
                >
                  {busy === key && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
                  Restore
                </Button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
