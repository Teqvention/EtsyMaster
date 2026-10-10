"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { AlertCircleIcon, FolderOpenIcon, LoaderCircleIcon, PaletteIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { StyleCover, Swatches } from "@/components/styles/style-cover"
import { StyleFromSavedDialog } from "@/components/styles/style-from-saved"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { createStyle, EXPECT_READ, POLL, refreshStyles, useStyles } from "@/hooks/use-styles"
import type { StyleSummary } from "@/lib/styles/types"

// Every style as a card: its moodboard's first images and the palette read
// from them. A new style starts empty and opens straight away, so its images
// can be added where they're shown; one from a Saved folder opens with its
// posters on their way in.

export function StylesView() {
  const styles = useStyles()
  const [creating, setCreating] = React.useState(false)
  const [fromSaved, setFromSaved] = React.useState(false)

  React.useEffect(() => {
    refreshStyles()
  }, [])

  // While posters come in or a guide is read, and once more after: a read
  // starts a moment after the last poster lands.
  const busy = styles?.some((s) => s.guideStatus === "running" || s.incoming) ?? false
  React.useEffect(() => {
    if (!busy) return
    const timer = setInterval(refreshStyles, POLL)
    return () => {
      clearInterval(timer)
      for (const wait of [EXPECT_READ / 2, EXPECT_READ]) setTimeout(refreshStyles, wait)
    }
  }, [busy])

  const fromSavedButton = (
    <Button size="sm" variant="outline" onClick={() => setFromSaved(true)} className="active:scale-[0.97]">
      <FolderOpenIcon />
      From Saved
    </Button>
  )

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto max-w-2xl text-sm text-muted-foreground">
          Moodboards of posters that share a look. Gemini reads each board once and writes a style
          guide; steals generated in a style follow it.
        </p>
        {fromSavedButton}
        <Button size="sm" onClick={() => setCreating(true)} className="active:scale-[0.97]">
          <PlusIcon />
          New style
        </Button>
      </div>

      {styles === null ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/5] rounded-xl" />
          ))}
        </div>
      ) : styles.length === 0 ? (
        <Empty className="min-h-[50svh] border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PaletteIcon />
            </EmptyMedia>
            <EmptyTitle>Make your first style</EmptyTitle>
            <EmptyDescription>
              Collect 3–12 posters with the look you want — a Saved folder, uploads or extracted
              steals from Generation. Then generate steals in that look.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            {fromSavedButton}
            <Button size="sm" onClick={() => setCreating(true)}>
              <PlusIcon />
              New style
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
          {styles.map((style) => (
            <li key={style.id}>
              <StyleCard style={style} />
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition-[color,border-color,transform] duration-150 ease-out outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] [@media(hover:hover)]:hover:border-foreground/30 [@media(hover:hover)]:hover:text-foreground"
            >
              <PlusIcon className="size-5" />
              New style
            </button>
          </li>
        </ul>
      )}

      <CreateStyleDialog open={creating} onOpenChange={setCreating} />
      <StyleFromSavedDialog open={fromSaved} onOpenChange={setFromSaved} navigate />
    </div>
  )
}

function StyleCard({ style }: { style: StyleSummary }) {
  return (
    <Link
      href={`/styles/${style.id}`}
      className="group/card flex flex-col overflow-hidden rounded-xl border bg-card outline-none transition-[border-color,transform] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99] [@media(hover:hover)]:hover:border-foreground/30"
    >
      <StyleCover covers={style.covers} width={480} className="aspect-square" />
      <div className="flex flex-col gap-1 px-3 py-2.5">
        <span className="truncate text-sm font-medium">{style.name}</span>
        <span className="flex h-4 items-center gap-2 text-xs text-muted-foreground tabular-nums">
          {style.count === 1 ? "1 image" : `${style.count} images`}
          <StyleState style={style} />
        </span>
      </div>
    </Link>
  )
}

/** Whether the style has been read: its palette, or what's happening instead. */
export function StyleState({
  style,
}: {
  style: Pick<StyleSummary, "guide" | "guideStatus" | "count" | "incoming">
}) {
  if (style.incoming) {
    return (
      <span className="ml-auto flex items-center gap-1">
        <LoaderCircleIcon className="size-3 animate-spin" />
        Adding {style.incoming}
      </span>
    )
  }
  if (style.guideStatus === "running") {
    return (
      <span className="ml-auto flex items-center gap-1">
        <LoaderCircleIcon className="size-3 animate-spin" />
        Reading
      </span>
    )
  }
  if (style.guideStatus === "error" && !style.guide) {
    return (
      <span className="ml-auto flex items-center gap-1 text-destructive">
        <AlertCircleIcon className="size-3" />
        Couldn&apos;t read
      </span>
    )
  }
  if (style.guide) return <Swatches palette={style.guide.palette} className="ml-auto" />
  return <span className="ml-auto">{style.count ? "Not read yet" : "Empty"}</span>
}

export function CreateStyleDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Instead of opening the new style. */
  onCreated?: (id: string, name: string) => void
}) {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const style = await createStyle(name)
      onOpenChange(false)
      setName("")
      if (onCreated) onCreated(style.id, style.name)
      else router.push(`/styles/${style.id}`)
    } catch (error) {
      toast.error(`Couldn't create the style: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>New style</DialogTitle>
            <DialogDescription>Name the look; add its posters next.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Retro gouache kitchen"
            aria-label="Style name"
            maxLength={60}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {busy && <LoaderCircleIcon className="animate-spin" />}
              Create style
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
