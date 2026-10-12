"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import {
  ArrowLeftIcon,
  BadgeCheckIcon,
  CopyIcon,
  FactoryIcon,
  FolderOpenIcon,
  HistoryIcon,
  ImagePlusIcon,
  ImagesIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RotateCcwIcon,
  SparklesIcon,
  SplitIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Chip } from "@/components/citys/request-editor"
import { CityGuideView } from "@/components/citys/styles/city-guide"
import { ProduceSheet } from "@/components/citys/styles/produce-sheet"
import { InterviewPanel, SuggestionsPanel } from "@/components/citys/styles/lab-interview"
import { CompareView, LabImageDialog, OlderRounds, rateError, RoundRunner, RoundView } from "@/components/citys/styles/lab-rounds"
import { SourcePicker } from "@/components/styles/source-picker"
import { Moodboard, NameField, StatusBadge } from "@/components/styles/style-detail"
import { StyleFromSavedDialog } from "@/components/styles/style-from-saved"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { useCityStyle } from "@/hooks/use-city-style"
import { deleteStyle, readStyleNow, uploadStyleImages } from "@/hooks/use-styles"
import { REF_MODES, type LabImage, type RefMode } from "@/lib/citys/studio-types"
import { MAX_IMAGES, type Style } from "@/lib/styles/types"
import { cn } from "@/lib/utils"

// A city style in the lab. The board and the guide read off it on the
// left; test rounds in the middle (the newest of the main guide, or of the
// variant picked at the top, with variants side by side against the main
// one); the interview and the variants to try on the right. A variant can
// be adopted (the others go), or made a style of its own. Every guide the
// style had stays in its history, one click to go back. Confirmed, a style
// is offered for posters at scale; a copy goes back into the lab.

const MAX_UPLOAD = 25 * 1024 * 1024

export function StyleLab({ id }: { id: Promise<string> }) {
  const styleId = React.use(id)
  const { data, error, act, patch, applyStyle, expectRead } = useCityStyle(styleId)
  const router = useRouter()
  const [selected, setSelected] = React.useState<string | null>(null)
  const [viewing, setViewing] = React.useState<{ set: string; image: LabImage } | null>(null)
  const [uploading, setUploading] = React.useState(0)
  const [picking, setPicking] = React.useState(false)
  const [fromSaved, setFromSaved] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [owning, setOwning] = React.useState<string | null>(null)
  const [producing, setProducing] = React.useState(false)
  const fileInput = React.useRef<HTMLInputElement>(null)

  if (!data) {
    return error ? (
      <div className="px-4 text-sm text-muted-foreground lg:px-6">
        Couldn&apos;t open this style: {error}.{" "}
        <Link href="/citys/styles" className="underline">
          Back to city styles
        </Link>
      </div>
    ) : (
      <div className="grid gap-4 px-4 lg:grid-cols-[20rem_minmax(0,1fr)_22rem] lg:px-6">
        <Skeleton className="h-[60svh] rounded-lg" />
        <Skeleton className="h-[60svh] rounded-lg" />
        <Skeleton className="h-[60svh] rounded-lg" />
      </div>
    )
  }

  const { style, rounds } = data
  const city = style.city
  const candidates = city?.candidates ?? []
  const candidate = candidates.find((c) => c.id === selected) ?? null
  const mainRounds = rounds.filter((r) => !r.candidate)
  const shownRound = candidate ? rounds.find((r) => r.id === candidate.round) : mainRounds[0]
  const older = (candidate ? [] : mainRounds.slice(1)).slice(0, 8)
  const anyPainting = rounds.some((r) => r.status !== "done")
  const room = MAX_IMAGES - style.images.length - (style.incoming ?? 0)

  const apply = (next: Style, options?: { expectRead?: boolean }) => {
    applyStyle(next)
    if (options?.expectRead) expectRead()
  }

  async function run(work: () => Promise<unknown>, done?: string) {
    try {
      await work()
      if (done) toast.success(done)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function upload(list: FileList | File[]) {
    const files = Array.from(list).filter((f) => f.type.startsWith("image/") && f.size <= MAX_UPLOAD).slice(0, Math.max(0, room))
    if (!files.length) return
    setUploading(files.length)
    try {
      apply(await uploadStyleImages(style.id, files), { expectRead: true })
    } catch (e) {
      toast.error(`Couldn't upload: ${(e as Error).message}`)
    } finally {
      setUploading(0)
    }
  }

  return (
    <div className="flex flex-col gap-3 px-4 lg:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="City styles" nativeButton={false} render={<Link href="/citys/styles" />}>
          <ArrowLeftIcon />
        </Button>
        <NameField style={style} apply={apply} />
        <StatusBadge style={style} />
        {city?.status === "confirmed" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <BadgeCheckIcon className="size-3.5" />
            Confirmed
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Draft · in the lab</span>
        )}
        {city?.medium && (
          <span
            className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            title={city.medium === "photo" ? "A photographic look: it makes real photos in this grading, whatever the reference is" : "Art: it makes posters in exactly this medium and line"}
          >
            {city.medium === "photo" ? "Photo look" : "Art"}
          </span>
        )}
        <TagsEditor tags={city?.tags ?? []} onChange={(tags) => run(() => patch({ tags }))} />
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/citys/outputs?style=${style.id}`} />} title="Every poster made in this style, its productions included">
            <ImagesIcon />
            Outputs
          </Button>
          <Button size="sm" variant="outline" onClick={() => setProducing(true)} disabled={!style.guide} className="active:scale-[0.97]" title="Paint this style over a list of places: sets and single posters">
            <FactoryIcon />
            Produce cities
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" disabled={room <= 0} />}>
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
          {city?.status === "confirmed" ? (
            <Button size="sm" variant="outline" onClick={() => run(() => patch({ status: "draft" }), "Back in the lab")}>
              Back to the lab
            </Button>
          ) : (
            <Button size="sm" onClick={() => run(() => patch({ status: "confirmed" }), `${style.name} is confirmed`)} disabled={!style.guide} className="active:scale-[0.97]">
              <BadgeCheckIcon />
              Confirm style
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="More" />}>
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={() =>
                  run(async () => {
                    const copy = (await act({ action: "duplicate" })) as Style
                    router.push(`/citys/styles/${copy.id}`)
                  }, "Copied into the lab")
                }
              >
                <CopyIcon />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => run(async () => apply(await readStyleNow(style.id)), "Reading the board again")}>
                <SparklesIcon />
                Read the board again
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2Icon />
                Delete style
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <VersionBar
        style={style}
        candidates={candidates}
        selected={selected}
        onSelect={setSelected}
        onRestore={(version) => run(() => act({ action: "restore", version }), "Back to that version")}
        onAdopt={(id) =>
          run(async () => {
            await act({ action: "adopt", candidate: id })
            setSelected(null)
          }, "Variant adopted as the main guide")
        }
        onDrop={(id) =>
          run(async () => {
            await act({ action: "drop", candidate: id })
            setSelected(null)
          })
        }
        onOwn={(id) => setOwning(id)}
      />

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files)
          e.target.value = ""
        }}
      />

      <div className="grid items-start gap-4 xl:grid-cols-[20rem_minmax(0,1fr)_22rem]">
        <aside className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-2" aria-label="Board">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Inspiration</h3>
            <Moodboard
              style={style}
              apply={apply}
              uploading={uploading}
              onFiles={(files) => void upload(files)}
              onUpload={() => fileInput.current?.click()}
              onPick={() => setPicking(true)}
              onSaved={() => setFromSaved(true)}
            />
          </section>
          <section className="flex flex-col gap-2 rounded-lg border p-3" aria-label="Guide">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{candidate ? `Variant ${candidates.indexOf(candidate) + 1}` : `Version ${city?.version ?? 0}`}</h3>
            <CityGuideView guide={candidate?.guide ?? style.guide} city={candidate?.city ?? city?.guide ?? null} />
          </section>
          <section className="flex flex-col gap-1.5 rounded-lg border p-3" aria-label="Scaling">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">When scaling</h3>
            <p className="text-[11px] text-muted-foreground">How it uses a reference photo by default.</p>
            <div className="flex flex-wrap gap-1">
              {REF_MODES.map((m) => {
                const modes = city?.modes ?? []
                const on = modes.includes(m.value)
                return (
                  <Chip
                    key={m.value}
                    on={on}
                    title={m.hint}
                    onClick={() => {
                      const next: RefMode[] = on ? modes.filter((x) => x !== m.value) : [...modes, m.value]
                      if (next.length) void run(() => patch({ modes: next }))
                    }}
                  >
                    {m.label}
                  </Chip>
                )
              })}
            </div>
          </section>
        </aside>

        <main className="flex min-w-0 flex-col gap-4">
          <RoundRunner
            disabled={!style.guide || !style.images.length}
            running={anyPainting}
            onRun={(blocks, delivery) => run(() => act({ action: "round", blocks, delivery, ...(candidate && { candidate: candidate.id }) }), "Round started")}
          />
          {candidates.length > 0 && !candidate && (
            <section className="flex flex-col gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <SplitIcon className="size-4 text-muted-foreground" />
                Main against the variants
              </h3>
              <CompareView main={mainRounds[0]} candidates={candidates} rounds={rounds} onOpen={(set, image) => setViewing({ set, image })} />
            </section>
          )}
          {shownRound ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">
                {candidate ? `Variant ${candidates.indexOf(candidate) + 1}` : "Latest round"}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {shownRound.status === "done" ? "done" : shownRound.status === "preparing" ? "getting ready" : "painting"}
                </span>
              </h3>
              <RoundView
                round={shownRound}
                onRate={(image, rating) => act({ action: "rate", round: shownRound.id, image: image.id, rating }).catch(rateError)}
                onOpen={(image) => setViewing({ set: shownRound.set, image })}
                onRetry={() => run(() => act({ action: "retry", round: shownRound.id }), "Painting them again")}
              />
            </section>
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {style.guide ? "No round yet: paint the first test round above." : "Add 4–10 inspiration images; the board is read a moment later, then the lab can paint."}
            </p>
          )}
          <OlderRounds
            rounds={older}
            onRate={(round, image, rating) => act({ action: "rate", round: round.id, image: image.id, rating }).catch(rateError)}
            onOpen={(set, image) => setViewing({ set, image })}
          />
        </main>

        <aside className="flex min-w-0 flex-col gap-5 rounded-lg border p-3 xl:sticky xl:top-0 xl:max-h-[calc(100svh-var(--header-height)-3rem)] xl:overflow-y-auto">
          <InterviewPanel
            interview={city?.interview}
            canAsk={!!style.guide}
            onAsk={() => act({ action: "interview" }).then(() => {})}
            onApply={(answers, notes) => act({ action: "answers", answers, notes }).then(() => void toast.success("New version: paint a round to see it"))}
          />
          <div className="h-px bg-border" />
          <SuggestionsPanel
            suggestions={city?.suggestions}
            room={5 - candidates.length}
            onTry={(ids, free) => act({ action: "candidates", suggestions: ids, free }).then(() => void toast.success("Variants on their way: they show as 1–5 at the top"))}
          />
        </aside>
      </div>

      <SourcePicker open={picking} onOpenChange={setPicking} style={style} onAdded={(next) => apply(next, { expectRead: true })} />
      <StyleFromSavedDialog open={fromSaved} onOpenChange={setFromSaved} style={style} onDone={(next) => apply(next)} />
      <ProduceSheet open={producing} onOpenChange={setProducing} styleId={style.id} styleName={style.name} medium={city?.medium ?? "art"} />
      <LabImageDialog image={viewing?.image ?? null} set={viewing?.set ?? null} onClose={() => setViewing(null)} />
      <OwnStyleDialog
        open={!!owning}
        onClose={() => setOwning(null)}
        onCreate={(name) =>
          run(async () => {
            const made = (await act({ action: "own", candidate: owning, name })) as Style
            setOwning(null)
            setSelected(null)
            router.push(`/citys/styles/${made.id}`)
          }, "A style of its own")
        }
      />
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {style.name}?</DialogTitle>
            <DialogDescription>Its board, guide, versions and lab rounds go. Posters already made in it stay.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                run(async () => {
                  await deleteStyle(style.id)
                  router.push("/citys/styles")
                }, `Deleted ${style.name}`)
              }
            >
              Delete style
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TagsEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [adding, setAdding] = React.useState(false)
  const [value, setValue] = React.useState("")
  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <span key={t} className="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs">
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="text-muted-foreground hover:text-foreground">
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim()) onChange([...tags, value.trim()])
            setValue("")
            setAdding(false)
          }}
        >
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => setAdding(false)} placeholder="cartoon, funky…" className="h-6 w-28 text-xs" />
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed px-2 text-xs text-muted-foreground hover:text-foreground">
          <PlusIcon className="size-3" />
          Group
        </button>
      )}
    </div>
  )
}

function VersionBar({
  style,
  candidates,
  selected,
  onSelect,
  onRestore,
  onAdopt,
  onDrop,
  onOwn,
}: {
  style: Style
  candidates: NonNullable<Style["city"]>["candidates"]
  selected: string | null
  onSelect: (id: string | null) => void
  onRestore: (versionId: string) => void
  onAdopt: (id: string) => void
  onDrop: (id: string) => void
  onOwn: (id: string) => void
}) {
  const city = style.city
  const history = city?.history ?? []
  const latest = history.at(-1)
  const candidate = candidates.find((c) => c.id === selected)
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={!selected}
        className={cn("rounded-md px-2 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50", !selected ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
      >
        Version {city?.version ?? 0}
      </button>
      {latest && !selected && <span className="max-w-md truncate text-xs text-muted-foreground" title={latest.note}>{latest.note}</span>}
      {candidates.length > 0 && (
        <div className="flex items-center gap-1" role="group" aria-label="Variants">
          {candidates.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(selected === c.id ? null : c.id)}
              aria-pressed={selected === c.id}
              title={c.label}
              className={cn(
                "grid size-7 place-items-center rounded-md border text-sm font-semibold tabular-nums outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.95]",
                selected === c.id ? "border-brand bg-brand text-white" : "border-brand/40 bg-brand/5 text-brand hover:bg-brand/10"
              )}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
      {candidate && (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="max-w-sm truncate text-xs text-muted-foreground" title={candidate.label}>
            {candidate.label}
          </span>
          <Button size="xs" onClick={() => onAdopt(candidate.id)}>
            Make main
          </Button>
          <Button size="xs" variant="outline" onClick={() => onOwn(candidate.id)}>
            Own style
          </Button>
          <Button size="xs" variant="ghost" onClick={() => onDrop(candidate.id)}>
            Drop
          </Button>
        </div>
      )}
      <Popover>
        <PopoverTrigger render={<Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" disabled={!history.length} />}>
          <HistoryIcon />
          History
        </PopoverTrigger>
        <PopoverContent align="end" className="max-h-[60svh] w-96 gap-0 overflow-y-auto p-1">
          <ol className="flex flex-col">
            {[...history].reverse().map((v) => (
              <li key={v.id} className="group/v flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded bg-muted text-[11px] font-semibold tabular-nums">{v.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-pretty">{v.note}</span>
                  <span className="text-[10px] text-muted-foreground">{new Date(v.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </span>
                {v.number !== city?.version && (
                  <Button variant="ghost" size="icon-xs" aria-label={`Back to version ${v.number}`} title="Back to this version" onClick={() => onRestore(v.id)} className="opacity-0 group-hover/v:opacity-100 focus-visible:opacity-100">
                    <RotateCcwIcon />
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function OwnStyleDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (name: string) => Promise<void> | void }) {
  const [name, setName] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!name.trim()) return
            setBusy(true)
            await onCreate(name.trim())
            setBusy(false)
            setName("")
          }}
        >
          <DialogHeader>
            <DialogTitle>A style of its own</DialogTitle>
            <DialogDescription>The variant becomes a new city style with the same board; it leaves this one.</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name it" maxLength={60} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <LoaderCircleIcon className="animate-spin" />}
              Create style
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
