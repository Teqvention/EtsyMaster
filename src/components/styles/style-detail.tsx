"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderOpenIcon,
  ImagePlusIcon,
  ImagesIcon,
  LoaderCircleIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { AutoScaleDialog } from "@/components/styles/auto-scale"
import { GuidePanel, isStale } from "@/components/styles/style-guide"
import { SourcePicker } from "@/components/styles/source-picker"
import { StyleFromSavedDialog } from "@/components/styles/style-from-saved"
import { Badge } from "@/components/ui/badge"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import {
  deleteStyle,
  readStyleNow,
  removeStyleImage,
  styleFileUrl,
  updateStyle,
  uploadStyleImages,
  useStyle,
} from "@/hooks/use-styles"
import { MAX_IMAGES, READ_IMAGES, type Style, type StyleGuide } from "@/lib/styles/types"
import { cn } from "@/lib/utils"

// One style: the moodboard on the left, the guide Gemini wrote from it on the
// right. Every change to the board is saved at once; the server re-reads the
// style a moment later, and the page keeps polling until the new guide lands.

const MAX_UPLOAD = 25 * 1024 * 1024

export function StyleDetail({ id }: { id: Promise<string> }) {
  const styleId = React.use(id)
  const { style, error, apply } = useStyle(styleId)

  if (!style && error) {
    return (
      <div className="px-4 text-sm text-muted-foreground lg:px-6">
        Couldn&apos;t open this style: {error}.{" "}
        <Link href="/styles" className="underline">
          Back to all styles
        </Link>
      </div>
    )
  }
  if (!style) {
    return (
      <div className="flex flex-col gap-4 px-4 lg:px-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-[3/4] rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    )
  }
  return <Detail style={style} apply={apply} />
}

export type Apply = (style: Style, options?: { expectRead?: boolean }) => void

function Detail({ style, apply }: { style: Style; apply: Apply }) {
  const router = useRouter()
  const fileInput = React.useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = React.useState(0)
  const [picking, setPicking] = React.useState(false)
  const [fromSaved, setFromSaved] = React.useState(false)
  const [confirm, setConfirm] = React.useState<"delete" | "reread" | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [scaling, setScaling] = React.useState(false)

  const running = style.guideStatus === "running"
  const room = MAX_IMAGES - style.images.length - (style.incoming ?? 0)

  async function upload(list: FileList | File[]) {
    const all = Array.from(list).filter((f) => f.type.startsWith("image/"))
    if (all.length === 0) {
      toast.error("Those aren't images")
      return
    }
    const fitting = all.filter((f) => f.size <= MAX_UPLOAD)
    if (fitting.length < all.length) toast.error("Images over 25 MB were skipped")
    const files = fitting.slice(0, Math.max(0, room))
    if (files.length < fitting.length) {
      toast.error(`A style holds ${MAX_IMAGES} images; ${fitting.length - files.length} were left out`)
    }
    if (files.length === 0) return
    setUploading(files.length)
    try {
      apply(await uploadStyleImages(style.id, files), { expectRead: true })
    } catch (e) {
      toast.error(`Couldn't upload: ${(e as Error).message}`)
    } finally {
      setUploading(0)
    }
  }

  async function read() {
    setConfirm(null)
    try {
      apply(await readStyleNow(style.id))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function saveGuide(guide: StyleGuide) {
    apply(await updateStyle(style.id, { guide }))
    toast.success("Guide saved")
  }

  async function remove() {
    setDeleting(true)
    try {
      await deleteStyle(style.id)
      toast.success(`Deleted ${style.name}`)
      router.push("/styles")
    } catch (e) {
      toast.error(`Couldn't delete: ${(e as Error).message}`)
      setDeleting(false)
    }
  }

  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" variant="outline" disabled={room <= 0} className="active:scale-[0.97]" />
        }
      >
        <ImagePlusIcon />
        Add images
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => fileInput.current?.click()}>
          <UploadIcon />
          Upload files…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPicking(true)}>
          <ImagesIcon />
          From Generation…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setFromSaved(true)}>
          <FolderOpenIcon />
          From Saved…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="All styles"
          nativeButton={false}
          render={<Link href="/styles" />}
        >
          <ArrowLeftIcon />
        </Button>
        <NameField style={style} apply={apply} />
        <StatusBadge style={style} />
        <div className="ml-auto flex items-center gap-2">
          {style.autoSet && style.kind !== "city" && (
            <Button
              size="sm"
              variant="ghost"
              nativeButton={false}
              render={<Link href={`/generation/${style.autoSet}`} />}
            >
              <ImagesIcon />
              Scaled posters
            </Button>
          )}
          {addMenu}
          {style.kind !== "city" && (
            <Button
              size="sm"
              variant="outline"
              disabled={style.images.length === 0 || !!style.incoming}
              onClick={() => setScaling(true)}
              title="New posters in this style, planned and painted from the whole board"
              className="active:scale-[0.97]"
            >
              {style.studyStatus === "running" ? <LoaderCircleIcon className="animate-spin" /> : <WandSparklesIcon />}
              {style.studyStatus === "running" ? "Studying the board…" : "Autonomous scale"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={running || style.images.length === 0 || !!style.incoming}
            onClick={() => (style.guideEdited ? setConfirm("reread") : read())}
            className="active:scale-[0.97]"
          >
            {running ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
            {running ? "Reading…" : style.guide ? "Re-read style" : "Read style"}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Delete style"
            onClick={() => setConfirm("delete")}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) upload(e.target.files)
          e.target.value = ""
        }}
      />

      {style.kind === "city" && (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          A city style: it&apos;s read for how it shows a place too, and tried in the lab.{" "}
          <Link href={`/citys/styles/${style.id}`} className="font-medium text-foreground underline underline-offset-2">
            Open it in the city lab
          </Link>
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
        <Moodboard
          style={style}
          apply={apply}
          uploading={uploading}
          onFiles={upload}
          onUpload={() => fileInput.current?.click()}
          onPick={() => setPicking(true)}
          onSaved={() => setFromSaved(true)}
        />
        <GuidePanel
          style={style}
          onRead={() => (style.guideEdited ? setConfirm("reread") : read())}
          onSave={saveGuide}
          className="lg:sticky lg:top-6 lg:max-h-[calc(100svh-var(--header-height)-6rem)]"
        />
      </div>

      <SourcePicker
        open={picking}
        onOpenChange={setPicking}
        style={style}
        onAdded={(next) => apply(next, { expectRead: true })}
      />
      <StyleFromSavedDialog
        open={fromSaved}
        onOpenChange={setFromSaved}
        style={style}
        onDone={(next) => apply(next)}
      />
      <AutoScaleDialog
        open={scaling}
        onOpenChange={setScaling}
        styleId={style.id}
        name={style.name}
        count={style.images.length}
      />

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          {confirm === "delete" ? (
            <>
              <DialogHeader>
                <DialogTitle>Delete {style.name}?</DialogTitle>
                <DialogDescription>
                  Its {style.images.length === 1 ? "image" : `${style.images.length} images`} and guide
                  are deleted. Posters already generated in this style stay where they are.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={remove} disabled={deleting}>
                  {deleting && <LoaderCircleIcon className="animate-spin" />}
                  Delete style
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Replace your edits?</DialogTitle>
                <DialogDescription>
                  You changed this guide by hand. Reading the board again writes a new guide over it.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)}>
                  Keep my guide
                </Button>
                <Button onClick={read}>Re-read style</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function StatusBadge({ style }: { style: Style }) {
  if (style.incoming) {
    return (
      <Badge variant="secondary">
        <LoaderCircleIcon className="animate-spin" />
        Adding posters
      </Badge>
    )
  }
  if (style.guideStatus === "running") {
    return (
      <Badge variant="secondary">
        <LoaderCircleIcon className="animate-spin" />
        Reading
      </Badge>
    )
  }
  if (style.guideStatus === "error") return <Badge variant="destructive">Couldn&apos;t read</Badge>
  if (!style.guide) return style.images.length ? <Badge variant="outline">Not read yet</Badge> : null
  if (isStale(style)) return <Badge variant="outline">Board changed</Badge>
  return <Badge variant="secondary">Understood</Badge>
}

/** The name as a heading that's edited in place: Enter or leaving saves, Escape reverts. */
export function NameField({ style, apply }: { style: Style; apply: Apply }) {
  const [value, setValue] = React.useState(style.name)
  const [saved, setSaved] = React.useState(style.name)
  if (saved !== style.name) {
    // Renamed elsewhere (or saved): show the stored name.
    setSaved(style.name)
    setValue(style.name)
  }

  async function commit() {
    const name = value.trim().replace(/\s+/g, " ")
    if (!name) {
      setValue(style.name)
      return
    }
    if (name === style.name) return
    try {
      apply(await updateStyle(style.id, { name }))
    } catch (e) {
      setValue(style.name)
      toast.error(`Couldn't rename: ${(e as Error).message}`)
    }
  }

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
        else if (e.key === "Escape") {
          setValue(style.name)
          // Blurring after the reset is rendered saves nothing.
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
        }
      }}
      aria-label="Style name"
      maxLength={60}
      spellCheck={false}
      className="field-sizing-content h-8 max-w-full min-w-24 truncate rounded-md border border-transparent bg-transparent px-2 text-base font-medium outline-none transition-colors hover:border-input focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    />
  )
}

// --- The board ---

export function Moodboard({
  style,
  apply,
  uploading,
  onFiles,
  onUpload,
  onPick,
  onSaved,
}: {
  style: Style
  apply: Apply
  uploading: number
  onFiles: (files: FileList) => void
  onUpload: () => void
  onPick: () => void
  onSaved: () => void
}) {
  // While dragging (and until the new order is saved) the board shows `order`.
  const [order, setOrder] = React.useState<string[] | null>(null)
  const [dragging, setDragging] = React.useState<string | null>(null)
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set())
  const [fileOver, setFileOver] = React.useState(false)
  const [viewing, setViewing] = React.useState<number | null>(null)
  const focusAfter = React.useRef<string | null>(null)
  const board = React.useRef<HTMLUListElement>(null)

  const byFile = React.useMemo(() => new Map(style.images.map((i) => [i.file, i])), [style.images])
  const stored = style.images.map((i) => i.file)
  const files = (order ?? stored).filter((f) => byFile.has(f) && !hidden.has(f))
  const read = style.guideImages ? new Set(style.guideImages) : null

  React.useEffect(() => {
    const file = focusAfter.current
    if (!file) return
    focusAfter.current = null
    board.current?.querySelector<HTMLElement>(`[data-file="${file}"] [data-tile]`)?.focus()
  })

  async function saveOrder(next: string[]) {
    if (next.join() === stored.join()) {
      setOrder(null)
      return
    }
    setOrder(next)
    try {
      apply(await updateStyle(style.id, { order: next }))
    } catch (e) {
      toast.error(`Couldn't reorder: ${(e as Error).message}`)
    } finally {
      setOrder(null)
    }
  }

  async function remove(file: string) {
    const at = files.indexOf(file)
    focusAfter.current = files[at + 1] ?? files[at - 1] ?? null
    setHidden((h) => new Set(h).add(file))
    try {
      apply(await removeStyleImage(style.id, file), { expectRead: true })
    } catch (e) {
      toast.error(`Couldn't remove the image: ${(e as Error).message}`)
    } finally {
      setHidden((h) => {
        const next = new Set(h)
        next.delete(file)
        return next
      })
    }
  }

  function move(file: string, by: number) {
    const at = files.indexOf(file)
    const to = Math.max(0, Math.min(files.length - 1, at + by))
    if (to === at) return
    const next = [...files]
    next.splice(at, 1)
    next.splice(to, 0, file)
    focusAfter.current = file
    saveOrder(next)
  }

  function onTileKey(event: React.KeyboardEvent, file: string, index: number) {
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && event.altKey) {
      move(file, event.key === "ArrowLeft" ? -1 : 1)
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const to = files[index + (event.key === "ArrowLeft" ? -1 : 1)]
      if (!to) return
      board.current?.querySelector<HTMLElement>(`[data-file="${to}"] [data-tile]`)?.focus()
    } else if (event.key === "Delete" || event.key === "Backspace") {
      remove(file)
    } else return
    event.preventDefault()
  }

  const hasFiles = (event: React.DragEvent) => !dragging && event.dataTransfer.types.includes("Files")

  const dropProps = {
    onDragOver(event: React.DragEvent) {
      if (!hasFiles(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = "copy"
      setFileOver(true)
    },
    onDragLeave(event: React.DragEvent) {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFileOver(false)
    },
    onDrop(event: React.DragEvent) {
      if (!hasFiles(event)) return
      event.preventDefault()
      setFileOver(false)
      if (event.dataTransfer.files.length) onFiles(event.dataTransfer.files)
    },
  }

  const count = files.length
  // Saved listings still being taken out of their photos hold a place too.
  const coming = uploading + (style.incoming ?? 0)
  const empty = count === 0 && coming === 0

  return (
    <section aria-label="Moodboard" className="relative flex min-w-0 flex-col gap-3" {...dropProps}>
      {empty ? (
        <div
          className={cn(
            "flex min-h-[50svh] flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 text-center transition-colors duration-150",
            fileOver && "border-brand bg-brand/5"
          )}
        >
          <div className="grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">
            <ImagePlusIcon className="size-5" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Drop posters here</p>
            <p className="max-w-sm text-sm text-pretty text-muted-foreground">
              3–12 posters that share a look read best: same medium, palette and feel, different
              subjects.
            </p>
            {style.importError && <p className="max-w-sm text-xs text-destructive">{style.importError}</p>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onUpload}>
              <UploadIcon />
              Upload files
            </Button>
            <Button size="sm" variant="outline" onClick={onPick}>
              <ImagesIcon />
              From Generation
            </Button>
            <Button size="sm" variant="outline" onClick={onSaved}>
              <FolderOpenIcon />
              From Saved
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ul
            ref={board}
            className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3"
            aria-label={`${count} images. Alt and arrow keys move one, Delete removes it.`}
          >
            {files.map((file, index) => {
              const fresh = !!style.guide && !!read && !read.has(file)
              return (
                <li
                  key={file}
                  data-file={file}
                  draggable
                  onDragStart={(event) => {
                    setDragging(file)
                    setOrder(files)
                    event.dataTransfer.effectAllowed = "move"
                    event.dataTransfer.setData("text/plain", file)
                  }}
                  onDragOver={(event) => {
                    if (!dragging) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = "move"
                    if (dragging === file) return
                    setOrder((o) => {
                      const list = [...(o ?? files)]
                      const from = list.indexOf(dragging)
                      const to = list.indexOf(file)
                      if (from < 0 || to < 0 || from === to) return o
                      list.splice(from, 1)
                      list.splice(to, 0, dragging)
                      return list
                    })
                  }}
                  onDrop={(event) => dragging && event.preventDefault()}
                  onDragEnd={() => {
                    setDragging(null)
                    saveOrder(order ?? files)
                  }}
                  className={cn(
                    "group/tile relative aspect-[3/4] overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10 transition-opacity duration-150 ease-out",
                    dragging === file && "opacity-30"
                  )}
                >
                  <button
                    type="button"
                    data-tile
                    aria-label={`Image ${index + 1} of ${count}${fresh ? ", not in the guide yet" : ""}`}
                    onClick={() => setViewing(index)}
                    onKeyDown={(event) => onTileKey(event, file, index)}
                    className="block size-full cursor-grab rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset active:cursor-grabbing"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={styleFileUrl(style.id, file, 480)}
                      alt=""
                      draggable={false}
                      className="size-full object-cover transition-transform duration-300 ease-out-strong group-hover/tile:scale-[1.03] motion-reduce:transition-none"
                    />
                  </button>
                  <span className="pointer-events-none absolute bottom-1.5 left-1.5 min-w-5 rounded-md bg-background/85 px-1.5 text-center text-[11px] leading-5 font-medium tabular-nums backdrop-blur-sm">
                    {index + 1}
                  </span>
                  {fresh && (
                    <span
                      title="Added since the guide was read"
                      className="pointer-events-none absolute top-2 left-2 size-2 rounded-full bg-brand ring-2 ring-background"
                    />
                  )}
                  <Button
                    variant="secondary"
                    size="icon-xs"
                    aria-label={`Remove image ${index + 1}`}
                    tabIndex={-1}
                    onClick={() => remove(file)}
                    className="absolute top-1.5 right-1.5 bg-background/90 shadow-sm backdrop-blur-sm transition-opacity duration-150 pointer-fine:opacity-0 pointer-fine:group-focus-within/tile:opacity-100 pointer-fine:group-hover/tile:opacity-100"
                  >
                    <XIcon />
                  </Button>
                </li>
              )
            })}
            {Array.from({ length: coming }, (_, i) => (
              <li key={`uploading-${i}`} className="relative aspect-[3/4] overflow-hidden rounded-lg bg-muted">
                <span className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-foreground/6 to-transparent motion-reduce:animate-none" />
              </li>
            ))}
            {count + coming < MAX_IMAGES && (
              <li className="aspect-[3/4]">
                <button
                  type="button"
                  onClick={onPick}
                  className="flex size-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-xs text-muted-foreground outline-none transition-[color,border-color,transform] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] hover:border-foreground/30 hover:text-foreground"
                >
                  <PlusIcon className="size-4" />
                  Add images
                </button>
              </li>
            )}
          </ul>
          <BoardHint count={count} style={style} />
        </>
      )}

      {fileOver && !empty && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl border-2 border-dashed border-brand bg-background/70 backdrop-blur-[2px] starting:opacity-0 transition-opacity duration-150">
          <p className="flex items-center gap-2 text-sm font-medium">
            <UploadIcon className="size-4" />
            Drop to add to the board
          </p>
        </div>
      )}

      <Viewer
        style={style}
        files={files}
        index={viewing}
        onIndex={setViewing}
        onRemove={(file) => {
          remove(file)
          setViewing((i) => (i === null || files.length <= 1 ? null : Math.min(i, files.length - 2)))
        }}
      />
    </section>
  )
}

function BoardHint({ count, style }: { count: number; style: Style }) {
  if (style.incoming) {
    return (
      <p className="text-xs text-muted-foreground">
        Taking the posters out of {style.incoming === 1 ? "1 saved photo" : `${style.incoming} saved photos`} —
        the board is read once they&apos;re in.
      </p>
    )
  }
  if (style.importError) return <p className="text-xs text-destructive">{style.importError}</p>
  let text: string
  if (count < 3) text = `Add ${3 - count} more for a reliable read — 3 to 12 posters work best.`
  else if (count > READ_IMAGES)
    text = `Gemini reads ${READ_IMAGES} of the ${count}, picked evenly across the board — put the strongest first.`
  else text = "Drag to reorder; the first four make the cover. Drop files anywhere on the board."
  return <p className="text-xs text-muted-foreground">{text}</p>
}

function Viewer({
  style,
  files,
  index,
  onIndex,
  onRemove,
}: {
  style: Style
  files: string[]
  index: number | null
  onIndex: (index: number | null) => void
  onRemove: (file: string) => void
}) {
  const open = index !== null && index < files.length
  const file = open ? files[index] : null
  const image = file ? style.images.find((i) => i.file === file) : null

  // On the dialog itself: keys inside it don't reach the window.
  function onKeyDown(event: React.KeyboardEvent) {
    if (index === null) return
    if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1)
    else if (event.key === "ArrowRight" && index < files.length - 1) onIndex(index + 1)
    else return
    event.preventDefault()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onIndex(null)}>
      <DialogContent
        onKeyDown={onKeyDown}
        className="flex max-h-[94svh] flex-col gap-3 p-3 sm:max-w-[min(94vw,64rem)]"
      >
        <DialogHeader className="flex-row items-center gap-2 pr-9">
          <DialogTitle className="shrink-0 tabular-nums">
            {index !== null ? index + 1 : 0} of {files.length}
          </DialogTitle>
          <DialogDescription className="truncate">
            {image?.from ? "From Generation" : "Uploaded"}
            {image ? ` · ${image.width}×${image.height}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="relative grid min-h-0 flex-1 place-items-center rounded-lg bg-muted/50">
          {file && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={file}
              src={styleFileUrl(style.id, file)}
              alt={`Image ${(index ?? 0) + 1}`}
              className="max-h-[calc(94svh-9.5rem)] w-auto max-w-full object-contain"
            />
          )}
          {index !== null && index > 0 && (
            <Button
              variant="secondary"
              size="icon"
              aria-label="Previous"
              className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-background/90 shadow-sm"
              onClick={() => onIndex(index - 1)}
            >
              <ChevronLeftIcon />
            </Button>
          )}
          {index !== null && index < files.length - 1 && (
            <Button
              variant="secondary"
              size="icon"
              aria-label="Next"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-background/90 shadow-sm"
              onClick={() => onIndex(index + 1)}
            >
              <ChevronRightIcon />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex min-w-0 gap-1.5 overflow-x-auto p-0.5">
            {files.map((f, i) => (
              <button
                key={f}
                type="button"
                aria-label={`Image ${i + 1}`}
                aria-current={i === index || undefined}
                onClick={() => onIndex(i)}
                className="relative size-11 shrink-0 overflow-hidden rounded-md opacity-60 ring-1 ring-foreground/10 transition-[opacity,transform] duration-150 ease-out outline-none hover:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 aria-current:opacity-100 aria-current:ring-2 aria-current:ring-brand"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={styleFileUrl(style.id, f, 160)} alt="" className="size-full object-cover" />
              </button>
            ))}
          </div>
          {file && (
            <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => onRemove(file)}>
              <Trash2Icon />
              Remove
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
