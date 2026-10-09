"use client"

import { useRouter } from "next/navigation"
import * as React from "react"
import { LoaderCircleIcon, PaletteIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"

import { ImagePicker, ThumbStack, type ImagePick } from "@/components/generation/image-picker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { generationFileUrl } from "@/hooks/use-generations"
import { addGeneratedImages, createStyle, suggestStyleName } from "@/hooks/use-styles"
import { MAX_IMAGES } from "@/lib/styles/types"
import { cn } from "@/lib/utils"

// A new style from a set's generated images: name it, pick the ones that
// share the look (approved picked to start), and they become its moodboard.
// Gemini suggests a name from the picks as the dialog opens (and again on
// request), and reads the board right after it's made.

/** A generated image of the set, by its file. */
export type StyleImagePick = { file: string; title: string; approved?: boolean }

export function StyleFromImagesDialog({
  open,
  onOpenChange,
  generation,
  images,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  generation: string
  images: StyleImagePick[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-xl">
        {open && <Form generation={generation} images={images} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function Form({
  generation,
  images,
  onDone,
}: {
  generation: string
  images: StyleImagePick[]
  onDone: () => void
}) {
  const router = useRouter()
  const items = React.useMemo<ImagePick[]>(
    () =>
      images.map((i) => ({
        id: i.file,
        src: generationFileUrl(generation, i.file),
        title: i.title,
        approved: i.approved,
      })),
    [generation, images]
  )
  const [picked, setPicked] = React.useState(() => {
    const approved = items.filter((i) => i.approved)
    return new Set((approved.length ? approved : items).slice(0, MAX_IMAGES).map((i) => i.id))
  })
  const [name, setName] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  // Asking from the start, as the dialog opens with picks.
  const [naming, setNaming] = React.useState(() => picked.size > 0)
  const latest = React.useRef(0)
  const input = React.useRef<HTMLInputElement>(null)

  const chosen = items.filter((i) => picked.has(i.id))
  const ready = name.trim() !== "" && chosen.length > 0

  /** A suggested name for these picks, or null when a newer ask overtook it. */
  async function ask(files: string[]) {
    const id = ++latest.current
    const next = await suggestStyleName(files.map((file) => ({ generation, file })))
    return id === latest.current ? next : null
  }

  // On open, from the picks it opens with; it only fills an empty field.
  React.useEffect(() => {
    if (!picked.size) return
    ask([...picked])
      .then((next) => next && setName((current) => current.trim() ? current : next))
      .catch(() => {})
      .finally(() => setNaming(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function suggest() {
    setNaming(true)
    try {
      const next = await ask(chosen.map((i) => i.id))
      if (next === null) return
      setName(next)
      input.current?.select()
    } catch (error) {
      toast.error(`Couldn't suggest a name: ${(error as Error).message}`)
    } finally {
      setNaming(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    try {
      const style = await createStyle(name)
      await addGeneratedImages(
        style.id,
        chosen.map((i) => ({ generation, file: i.id }))
      )
      toast.success(`Created ${style.name}`, {
        description: `${chosen.length} ${chosen.length === 1 ? "image" : "images"} · reading its style guide`,
        action: { label: "Open", onClick: () => router.push(`/styles/${style.id}`) },
      })
      onDone()
    } catch (error) {
      toast.error(`Couldn't create the style: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex max-h-[min(88svh,52rem)] min-w-0 flex-col">
      <DialogHeader className="flex-row items-center gap-3 border-b p-4 pr-12">
        {chosen.length > 0 ? (
          <ThumbStack thumbs={chosen.slice(0, 3).map((i) => i.src)} />
        ) : (
          <span className="grid h-11 w-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
            <PaletteIcon />
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <DialogTitle>Create style</DialogTitle>
          <DialogDescription className="truncate">Pick the images that share the look</DialogDescription>
        </div>
      </DialogHeader>

      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="style-name" className="text-xs font-medium text-muted-foreground">
            Name
          </label>
          <div className="flex items-center gap-2">
            <Input
              ref={input}
              id="style-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={naming ? "Suggesting a name…" : "e.g. Retro Gouache Kitchen"}
              maxLength={60}
              className={cn("transition-[filter,opacity] duration-200 ease-out", naming && name && "opacity-60 blur-[1px]")}
            />
            <Button
              type="button"
              variant="outline"
              disabled={naming || chosen.length === 0}
              onClick={suggest}
              title="Suggest a name from the picked images"
              className="shrink-0 active:scale-[0.97]"
            >
              {naming ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
              Suggest
            </Button>
          </div>
        </div>
        <ImagePicker label="Moodboard" items={items} picked={picked} max={MAX_IMAGES} onChange={setPicked} />
      </div>

      <DialogFooter className="m-0 flex-row items-center gap-2 rounded-b-xl border-t bg-muted/40 p-3 sm:justify-between">
        <p className="text-xs text-muted-foreground tabular-nums">
          {chosen.length === 0
            ? "Pick at least one image"
            : !name.trim()
              ? "Name the style"
              : chosen.length < 3
                ? "3 or more images read best"
                : "Gemini reads the board once it's made"}
        </p>
        <Button type="submit" disabled={!ready || busy} className="active:scale-[0.97]">
          {busy ? <LoaderCircleIcon className="animate-spin" /> : <PaletteIcon />}
          Create with {chosen.length} {chosen.length === 1 ? "image" : "images"}
        </Button>
      </DialogFooter>
    </form>
  )
}
