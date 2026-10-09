"use client"

import * as React from "react"
import {
  AlertCircleIcon,
  CheckIcon,
  CopyIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { READ_IMAGES, type Style, type StyleGuide } from "@/lib/styles/types"
import { cn } from "@/lib/utils"

// The guide Gemini wrote from the moodboard, laid out to be read at a glance:
// the palette first, then how the posters are made, what to do and avoid,
// and the paragraph generation actually sends. It can be rewritten by hand.

const SECTIONS = [
  ["medium", "Medium"],
  ["technique", "Technique & texture"],
  ["lighting", "Light & shadow"],
  ["composition", "Composition"],
  ["detail", "Detail"],
  ["typography", "Typography"],
  ["mood", "Mood"],
] as const satisfies readonly (readonly [keyof StyleGuide, string])[]

const MAX_COLOURS = 10

/** Whether the board changed since the guide was read. */
export function isStale(style: Style) {
  if (!style.guide || !style.guideImages) return false
  const read = new Set(style.guideImages)
  return style.images.length !== read.size || style.images.some((i) => !read.has(i.file))
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    toast.error("Couldn't copy to the clipboard")
  }
}

export function GuidePanel({
  style,
  onRead,
  onSave,
  className,
}: {
  style: Style
  onRead: () => void
  onSave: (guide: StyleGuide) => Promise<void>
  className?: string
}) {
  const [editing, setEditing] = React.useState(false)
  const scroller = React.useRef<HTMLDivElement>(null)
  const { guide } = style

  // Opening or closing the editor starts at the top of the guide.
  React.useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [editing])
  const running = style.guideStatus === "running"

  let body: React.ReactNode
  if (editing && guide) {
    body = (
      <GuideEditor
        guide={guide}
        onCancel={() => setEditing(false)}
        onSave={async (next) => {
          await onSave(next)
          setEditing(false)
        }}
      />
    )
  } else if (guide) {
    body = (
      <div className="flex flex-col gap-4">
        {running ? (
          <Notice icon={<LoaderCircleIcon className="animate-spin" />} shimmer>
            Re-reading the board — the guide below is replaced when it&apos;s done.
          </Notice>
        ) : style.guideStatus === "error" ? (
          <Notice icon={<AlertCircleIcon />} tone="error" action={<RetryButton onRead={onRead} />}>
            The last read failed: {style.guideError ?? "unknown error"}
          </Notice>
        ) : style.guideEdited && isStale(style) ? (
          <Notice icon={<SparklesIcon />} action={<RetryButton onRead={onRead} label="Re-read" />}>
            The board changed since you edited this guide.
          </Notice>
        ) : null}
        <div
          className={cn(
            "transition-opacity duration-200 ease-out",
            running && "pointer-events-none opacity-50"
          )}
        >
          <GuideView style={style} guide={guide} />
        </div>
      </div>
    )
  } else if (running) {
    body = <Reading count={Math.min(style.images.length, READ_IMAGES)} />
  } else if (style.images.length === 0) {
    body = (
      <Placeholder title="Nothing to read yet">
        Add posters to the board. Gemini studies them together and writes the guide here — medium,
        palette, composition, what to do and avoid.
      </Placeholder>
    )
  } else if (style.guideStatus === "error") {
    body = (
      <Placeholder
        title="Couldn't read the board"
        tone="error"
        action={<RetryButton onRead={onRead} label="Try again" />}
      >
        {style.guideError ?? "Something went wrong."}
      </Placeholder>
    )
  } else {
    body = (
      <Placeholder
        title="Not read yet"
        action={
          <Button size="sm" onClick={onRead} className="active:scale-[0.97]">
            <SparklesIcon />
            Read style
          </Button>
        }
      >
        {style.images.length < 3
          ? "Reads best with 3 or more posters, but you can read it now."
          : "Starts by itself a moment after the board changes, or read it now."}
      </Placeholder>
    )
  }

  return (
    <section
      aria-label="Style guide"
      className={cn("flex min-h-0 flex-col rounded-xl border bg-card", className)}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="text-sm font-medium">Style guide</h2>
        {guide && !editing && (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={() => setEditing(true)}
            disabled={running}
          >
            <PencilIcon />
            Edit
          </Button>
        )}
      </header>
      <div ref={scroller} className="@container/guide min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {body}
      </div>
    </section>
  )
}

function RetryButton({ onRead, label = "Retry" }: { onRead: () => void; label?: string }) {
  return (
    <Button variant="outline" size="xs" onClick={onRead}>
      {label}
    </Button>
  )
}

function Notice({
  icon,
  tone,
  shimmer,
  action,
  children,
}: {
  icon: React.ReactNode
  tone?: "error"
  shimmer?: boolean
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      role="status"
      className={cn(
        "relative flex items-center gap-2 overflow-hidden rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground [&>svg]:size-3.5 [&>svg]:shrink-0",
        tone === "error" && "bg-destructive/10 text-destructive"
      )}
    >
      {shimmer && (
        <span className="absolute inset-y-0 w-full animate-shimmer bg-linear-to-r from-transparent via-foreground/6 to-transparent motion-reduce:hidden" />
      )}
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  )
}

function Placeholder({
  title,
  tone,
  action,
  children,
}: {
  title: string
  tone?: "error"
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-start gap-2 py-2">
      <p className={cn("text-sm font-medium", tone === "error" && "text-destructive")}>{title}</p>
      <p className="text-sm text-pretty text-muted-foreground">{children}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

/** The shape of a guide while Gemini writes it. */
function Reading({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-5" role="status" aria-label="Reading the style">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-3.5 animate-spin" />
        Studying {count === 1 ? "1 poster" : `${count} posters`} — about half a minute.
      </p>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      <Skeleton className="h-10 w-full rounded-lg" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      ))}
    </div>
  )
}

// --- Reading the guide ---

function GuideView({ style, guide }: { style: Style; guide: StyleGuide }) {
  const read = style.guideImages?.length
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm leading-relaxed text-pretty">{guide.summary}</p>

      {guide.palette.length > 0 && <Palette palette={guide.palette} />}

      <dl className="flex flex-col gap-3.5">
        {SECTIONS.map(([key, label]) => {
          const text = guide[key]
          if (!text) return null
          return (
            <div key={key} className="flex flex-col gap-1">
              <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
              <dd className="text-sm leading-relaxed text-pretty">{text}</dd>
            </div>
          )
        })}
      </dl>

      {guide.motifs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">Recurring motifs</h3>
          <ul className="flex flex-wrap gap-1.5">
            {guide.motifs.map((motif, i) => (
              <li key={`${motif}-${i}`}>
                <Badge variant="secondary" className="h-auto py-0.5 whitespace-normal">
                  {motif}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 @md/guide:grid-cols-2">
        <Rules title="Do" items={guide.do} icon={<CheckIcon className="text-emerald-600 dark:text-emerald-400" />} />
        <Rules title="Don't" items={guide.dont} icon={<XIcon className="text-destructive" />} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Prompt</h3>
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={() => copy(guide.prompt, "Prompt")}
          >
            <CopyIcon />
            Copy
          </Button>
        </div>
        <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-pretty text-foreground/90">
          {guide.prompt}
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        {!read
          ? "Read by Gemini"
          : read > READ_IMAGES
            ? `Read from ${READ_IMAGES} of ${read} images`
            : `Read from ${read === 1 ? "1 image" : `${read} images`}`}
        {style.guideEdited && " · edited by hand"}
      </p>
    </div>
  )
}

/** Dominant colour widest; any swatch copies its hex. */
function Palette({ palette }: { palette: StyleGuide["palette"] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-10 overflow-hidden rounded-lg ring-1 ring-foreground/10">
        {palette.map((c, i) => (
          <button
            key={`${c.hex}-${i}`}
            type="button"
            title={`${c.hex}${c.role ? ` · ${c.role}` : ""} — click to copy`}
            aria-label={`Copy ${c.hex}`}
            onClick={() => copy(c.hex, c.hex)}
            className="min-w-3 grow-(--grow) outline-none transition-[flex-grow] duration-200 ease-out-strong hover:grow-[8] focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none"
            style={{ backgroundColor: c.hex, "--grow": Math.max(1, palette.length - i) } as React.CSSProperties}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {palette.map((c, i) => (
          <li key={`${c.hex}-${i}`} className="min-w-0">
            <button
              type="button"
              onClick={() => copy(c.hex, c.hex)}
              className="flex w-full min-w-0 items-center gap-2 rounded-md py-0.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span
                className="size-3 shrink-0 rounded-full ring-1 ring-foreground/10"
                style={{ backgroundColor: c.hex }}
              />
              <span className="font-mono tabular-nums">{c.hex}</span>
              <span className="truncate text-muted-foreground">{c.role}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Rules({ title, items, icon }: { title: string; items: string[]; icon: React.ReactNode }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={`${item}-${i}`} className="flex gap-2 text-sm leading-snug [&>svg]:mt-0.5 [&>svg]:size-3.5 [&>svg]:shrink-0">
            {icon}
            <span className="text-pretty">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// --- Rewriting the guide ---

type Draft = Omit<StyleGuide, "motifs" | "do" | "dont" | "typography" | "palette"> & {
  typography: string
  motifs: string
  do: string
  dont: string
  palette: { key: number; hex: string; role: string }[]
}

const HEX = /^#?([0-9a-f]{6})$/i
const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean)

function GuideEditor({
  guide,
  onCancel,
  onSave,
}: {
  guide: StyleGuide
  onCancel: () => void
  onSave: (guide: StyleGuide) => Promise<void>
}) {
  const nextKey = React.useRef(guide.palette.length)
  const [draft, setDraft] = React.useState<Draft>(() => ({
    ...guide,
    typography: guide.typography ?? "",
    motifs: guide.motifs.join("\n"),
    do: guide.do.join("\n"),
    dont: guide.dont.join("\n"),
    palette: guide.palette.map((c, key) => ({ key, ...c })),
  }))
  const [busy, setBusy] = React.useState(false)

  const badHex = draft.palette.some((c) => !HEX.test(c.hex.trim()))
  const empty = !draft.summary.trim() && !draft.prompt.trim()

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }
  function setColour(key: number, change: Partial<{ hex: string; role: string }>) {
    set(
      "palette",
      draft.palette.map((c) => (c.key === key ? { ...c, ...change } : c))
    )
  }

  async function save() {
    if (busy || badHex || empty) return
    setBusy(true)
    try {
      await onSave({
        summary: draft.summary.trim(),
        medium: draft.medium.trim(),
        technique: draft.technique.trim(),
        palette: draft.palette.map((c) => ({
          hex: `#${HEX.exec(c.hex.trim())![1].toUpperCase()}`,
          role: c.role.trim(),
        })),
        lighting: draft.lighting.trim(),
        composition: draft.composition.trim(),
        detail: draft.detail.trim(),
        typography: draft.typography.trim() || null,
        mood: draft.mood.trim(),
        motifs: lines(draft.motifs),
        do: lines(draft.do),
        dont: lines(draft.dont),
        prompt: draft.prompt.trim(),
      })
    } catch (error) {
      toast.error(`Couldn't save the guide: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          save()
        } else if (event.key === "Escape") {
          event.preventDefault()
          onCancel()
        }
      }}
    >
      <Field label="Summary">
        <Textarea autoFocus value={draft.summary} onChange={(e) => set("summary", e.target.value)} />
      </Field>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Palette · dominant first</span>
        <ul className="flex flex-col gap-1.5">
          {draft.palette.map((c) => {
            const valid = HEX.test(c.hex.trim())
            return (
              <li key={c.key} className="flex items-center gap-1.5">
                <label
                  className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-foreground/10 focus-within:ring-3 focus-within:ring-ring/50"
                  style={{ backgroundColor: valid ? `#${HEX.exec(c.hex.trim())![1]}` : undefined }}
                >
                  <input
                    type="color"
                    aria-label="Pick colour"
                    value={valid ? `#${HEX.exec(c.hex.trim())![1].toLowerCase()}` : "#000000"}
                    onChange={(e) => setColour(c.key, { hex: e.target.value.toUpperCase() })}
                    className="absolute inset-0 size-full cursor-pointer opacity-0"
                  />
                </label>
                <Input
                  value={c.hex}
                  onChange={(e) => setColour(c.key, { hex: e.target.value })}
                  aria-label="Hex"
                  aria-invalid={!valid || undefined}
                  className="h-8 w-24 font-mono text-xs uppercase"
                  maxLength={7}
                />
                <Input
                  value={c.role}
                  onChange={(e) => setColour(c.key, { role: e.target.value })}
                  aria-label="How it's used"
                  placeholder="How it's used"
                  className="h-8 min-w-0 flex-1 text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${c.hex}`}
                  onClick={() => set("palette", draft.palette.filter((x) => x.key !== c.key))}
                >
                  <Trash2Icon />
                </Button>
              </li>
            )
          })}
        </ul>
        {draft.palette.length < MAX_COLOURS && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="self-start"
            onClick={() =>
              set("palette", [...draft.palette, { key: nextKey.current++, hex: "#888888", role: "" }])
            }
          >
            <PlusIcon />
            Add colour
          </Button>
        )}
      </div>

      {SECTIONS.map(([key, label]) => (
        <Field key={key} label={label} hint={key === "typography" ? "Leave empty for no lettering" : undefined}>
          <Textarea value={draft[key]} onChange={(e) => set(key, e.target.value)} className="min-h-12" />
        </Field>
      ))}
      <Field label="Recurring motifs" hint="One per line">
        <Textarea value={draft.motifs} onChange={(e) => set("motifs", e.target.value)} />
      </Field>
      <Field label="Do" hint="One per line">
        <Textarea value={draft.do} onChange={(e) => set("do", e.target.value)} />
      </Field>
      <Field label="Don't" hint="One per line">
        <Textarea value={draft.dont} onChange={(e) => set("dont", e.target.value)} />
      </Field>
      <Field label="Prompt" hint="Sent with every poster generated in this style">
        <Textarea value={draft.prompt} onChange={(e) => set("prompt", e.target.value)} className="min-h-32" />
      </Field>

      <div className="sticky bottom-0 -mx-4 -mb-4 flex items-center gap-2 border-t bg-card/95 px-4 py-3 backdrop-blur-sm">
        <span className="mr-auto hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd>
          to save
        </span>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy || badHex || empty}>
          {busy && <LoaderCircleIcon className="animate-spin" />}
          Save guide
        </Button>
      </div>
    </form>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactElement
}) {
  const id = React.useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-baseline gap-2 text-xs font-medium text-muted-foreground">
        {label}
        {hint && <span className="font-normal text-muted-foreground/70">{hint}</span>}
      </label>
      {React.cloneElement(children as React.ReactElement<{ id?: string }>, { id })}
    </div>
  )
}
