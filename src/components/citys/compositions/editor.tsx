"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import {
  ArrowLeftIcon,
  BoxIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FileImageIcon,
  HistoryIcon,
  ImageIcon,
  LayoutGridIcon,
  LoaderCircleIcon,
  LockIcon,
  MinusIcon,
  PaletteIcon,
  Redo2Icon,
  RotateCcwIcon,
  SaveIcon,
  ShapesIcon,
  SparklesIcon,
  StarIcon,
  Trash2Icon,
  TypeIcon,
  Undo2Icon,
  UnlockIcon,
  WandSparklesIcon,
} from "lucide-react"
import { toast } from "sonner"

import { CompositionCanvas, type Box } from "@/components/citys/compositions/canvas"
import { ColorField, ElementProperties, Group } from "@/components/citys/compositions/properties"
import { useMockupHistory } from "@/components/citys/compositions/history"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { useLoadedFonts } from "@/hooks/use-fonts"
import { useStyles } from "@/hooks/use-styles"
import { OFFERED, SIZE_BY_KEY, type SizeKey } from "@/lib/catalog/sizes"
import {
  heightOf,
  newElementId,
  SAMPLE_FACTS,
  textElement,
  type Composition,
  type CompositionData,
  type CompositionElement,
  type PlaceFacts,
} from "@/lib/citys/composition/model"
import { DEFAULT_PALETTE, fontsOf, renderSvg, type Palette, type PhotoInput } from "@/lib/citys/composition/render"
import { cn } from "@/lib/utils"

// The composition editor: layers on the left, the poster in the middle as it
// prints, properties on the right. Every change saves itself a moment later
// and can be undone; a version is kept when asked. Above the canvas: the
// print sizes (each can be nudged on its own), a sample place to try long
// names and short ones, and Gemini's tools: build from an image, five
// remixes to try, a combination with a style or another poster. Variants
// come back as 1–5 to look at and adopt.

const RATIOS = [
  { value: 3 / 4, label: "3 : 4" },
  { value: 4 / 5, label: "4 : 5" },
  { value: 2 / 3, label: "2 : 3" },
  { value: 1 / Math.SQRT2, label: "A sizes" },
  { value: 5 / 7, label: "5 : 7" },
]

const SAMPLES: { label: string; facts: PlaceFacts }[] = [
  { label: "Chicago", facts: SAMPLE_FACTS },
  {
    label: "A long name",
    facts: { ...SAMPLE_FACTS, city: "Santiago de los Caballeros", country: "Dominican Republic", region: "Santiago", code: "STI", lat: 19.4517, lng: -70.697, tagline: "The heart of the Cibao valley", landmark: "Monumento a los Héroes" },
  },
  {
    label: "A beach",
    facts: { ...SAMPLE_FACTS, city: "Bondi Beach", country: "Australia", region: "New South Wales", code: "SYD", lat: -33.8915, lng: 151.2767, tagline: "Sand, surf and the ocean pool", landmark: "Bondi Icebergs" },
  },
]

type Loaded = { composition: Composition; at: number }

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result as T
}

const dataOf = (c: CompositionData): CompositionData => ({ ratio: c.ratio, background: c.background, elements: c.elements, sizes: c.sizes ?? {} })

const loadedAt = () => Date.now()

export function CompositionEditor({ id }: { id: Promise<string> }) {
  const compId = React.use(id)
  const [loaded, setLoaded] = React.useState<Loaded | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const composition = await json<Composition>(`/api/citys/compositions/${compId}`)
      setLoaded({ composition, at: loadedAt() })
    } catch (e) {
      setError((e as Error).message)
    }
  }, [compId])

  React.useEffect(() => {
    let cancelled = false
    json<Composition>(`/api/citys/compositions/${compId}`).then(
      (composition) => !cancelled && setLoaded({ composition, at: loadedAt() }),
      (e: Error) => !cancelled && setError(e.message)
    )
    return () => {
      cancelled = true
    }
  }, [compId])

  // While Gemini works on it, the composition is read again until it's done.
  const busy = !!loaded?.composition.busy
  React.useEffect(() => {
    if (!busy) return
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [busy, load])

  if (!loaded) {
    return error ? (
      <p className="px-4 text-sm text-muted-foreground lg:px-6">
        Couldn&apos;t open it: {error}.{" "}
        <Link href="/citys/compositions" className="underline">
          Back to compositions
        </Link>
      </p>
    ) : (
      <div className="grid gap-4 px-4 lg:grid-cols-[14rem_minmax(0,1fr)_18rem] lg:px-6">
        <Skeleton className="h-[70svh] rounded-lg" />
        <Skeleton className="h-[70svh] rounded-lg" />
        <Skeleton className="h-[70svh] rounded-lg" />
      </div>
    )
  }
  return <Editor key={loaded.composition.id} composition={loaded.composition} reload={load} onLoaded={(composition) => setLoaded({ composition, at: Date.now() })} />
}

function Editor({ composition, reload, onLoaded }: { composition: Composition; reload: () => Promise<void>; onLoaded: (c: Composition) => void }) {
  const router = useRouter()
  const history = useMockupHistory<CompositionData>(dataOf(composition))
  const { reset } = history
  const data = history.value
  const [selected, setSelected] = React.useState<string | null>(null)
  const [size, setSize] = React.useState<SizeKey | null>(null)
  const [sample, setSample] = React.useState(0)
  const [facts, setFacts] = React.useState<PlaceFacts>(SAMPLE_FACTS)
  const [photo, setPhoto] = React.useState<PhotoInput>(null)
  const [palette, setPalette] = React.useState<Palette>(DEFAULT_PALETTE)
  const [saving, setSaving] = React.useState<"idle" | "saving" | "saved">("saved")
  const [candidate, setCandidate] = React.useState<string | null>(null)
  const [sizesOpen, setSizesOpen] = React.useState(false)
  const [versioning, setVersioning] = React.useState(false)
  const importInput = React.useRef<HTMLInputElement>(null)
  const savedData = React.useRef(JSON.stringify(dataOf(composition)))
  const version = React.useRef(composition.version)

  // The sample photo and its colours.
  React.useEffect(() => {
    void json<{ set: string | null; file: string | null }>("/api/citys/sample").then(async (ref) => {
      if (!ref.set || !ref.file) return
      const href = `/api/generations/${ref.set}/files/${ref.file}?w=960`
      const img = new Image()
      img.onload = () => setPhoto({ href, width: img.naturalWidth, height: img.naturalHeight })
      img.src = href
      setPalette(await json<Palette>(`/api/citys/palette?photo=${ref.set}/${ref.file}`).catch(() => DEFAULT_PALETTE))
    }, () => {})
  }, [])

  // A new version from the server (built from an image, a variant adopted): it replaces what's shown.
  React.useEffect(() => {
    if (composition.version !== version.current) {
      version.current = composition.version
      const fresh = dataOf(composition)
      savedData.current = JSON.stringify(fresh)
      reset(fresh)
      setCandidate(null)
    }
  }, [composition, reset])

  // Saves a moment after the last change.
  React.useEffect(() => {
    const text = JSON.stringify(data)
    if (text === savedData.current) return
    setSaving("saving")
    const timer = setTimeout(async () => {
      try {
        await json(`/api/citys/compositions/${composition.id}`, { method: "PUT", body: JSON.stringify({ data }) })
        savedData.current = text
        setSaving("saved")
      } catch (e) {
        setSaving("idle")
        toast.error(`Couldn't save: ${(e as Error).message}`)
      }
    }, 700)
    return () => clearTimeout(timer)
  }, [data, composition.id])

  const shownCandidate = composition.candidates.find((c) => c.id === candidate) ?? null
  const view = shownCandidate ? shownCandidate.data : data
  const ratio = size ? SIZE_BY_KEY[size].widthMm / SIZE_BY_KEY[size].heightMm : view.ratio
  const current = view.elements.find((e) => e.id === selected) ?? null
  const shownFacts = sample === 0 ? facts : SAMPLES[sample].facts

  const commit = (change: (d: CompositionData) => CompositionData, merge?: string) => {
    if (shownCandidate) return toast.message("Adopt the variant to edit it")
    history.commit(change, merge)
  }

  function patchElement(id: string, patch: Partial<CompositionElement>, merge?: string) {
    commit((d) => {
      const geometry = ["x", "y", "w", "h"].some((k) => k in patch) || ("size" in patch && Object.keys(patch).length === 1)
      if (size && geometry) {
        const tweak = { ...(d.sizes[size] ?? {}) }
        tweak[id] = { ...tweak[id], ...Object.fromEntries(Object.entries(patch).filter(([k]) => ["x", "y", "w", "h", "size"].includes(k))) }
        return { ...d, sizes: { ...d.sizes, [size]: tweak } }
      }
      return { ...d, elements: d.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as CompositionElement) : e)) }
    }, merge)
  }

  function onBox(id: string, box: Box, merge: string) {
    patchElement(id, box, merge)
  }

  function add(kind: "text" | "rect" | "line" | "icon" | "photo") {
    const H = heightOf(data.ratio)
    const el: CompositionElement =
      kind === "text"
        ? textElement({ name: "Text", text: "{tagline}", y: H / 2, h: 50, size: 28, case: "none", font: { family: "Inter", weight: 400, italic: false }, hold: "center" })
        : kind === "rect"
          ? { id: newElementId(), name: "Box", type: "rect", x: 100, y: H / 2 - 50, w: 300, h: 100, hold: "center", fill: { kind: "photo", role: "dominant", fallback: "#3B7A8C" }, radius: 0 }
          : kind === "line"
            ? { id: newElementId(), name: "Rule", type: "line", x: 80, y: H / 2, w: 840, h: 4, hold: "center", color: { kind: "fixed", hex: "#111111" }, thickness: 2 }
            : kind === "icon"
              ? { id: newElementId(), name: "Icon", type: "icon", x: 470, y: H / 2 - 30, w: 60, h: 60, hold: "center", icon: "compass", color: { kind: "fixed", hex: "#111111" }, stroke: 1.6 }
              : { id: newElementId(), name: "Photo", type: "photo", x: 100, y: 200, w: 800, h: H - 400, hold: "stretch", focusX: 0.5, focusY: 0.5, radius: 0 }
    commit((d) => ({ ...d, elements: [...d.elements, el] }))
    setSelected(el.id)
  }

  function remove(id: string) {
    commit((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== id) }))
    setSelected(null)
  }

  function duplicate(id: string) {
    const el = data.elements.find((e) => e.id === id)
    if (!el) return
    const copy = { ...el, id: newElementId(), name: `${el.name} copy`, x: el.x + 20, y: el.y + 20 } as CompositionElement
    commit((d) => ({ ...d, elements: [...d.elements, copy] }))
    setSelected(copy.id)
  }

  function reorder(id: string, step: number) {
    commit((d) => {
      const list = [...d.elements]
      const at = list.findIndex((e) => e.id === id)
      const to = Math.max(0, Math.min(list.length - 1, at + step))
      const [el] = list.splice(at, 1)
      list.splice(to, 0, el)
      return { ...d, elements: list }
    })
  }

  // Keys: arrows nudge (Shift ×10), Delete removes, ⌘D copies, ⌘Z undoes, Esc lets go.
  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      if (target.closest("input, textarea, select, [contenteditable], [role=dialog]")) return
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault()
        if (event.shiftKey) history.redo()
        else history.undo()
        return
      }
      if (!selected) return
      const el = view.elements.find((e) => e.id === selected)
      if (!el) return
      const step = event.shiftKey ? 10 : 1
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      if (moves[event.key]) {
        event.preventDefault()
        const placed = view.elements.find((e) => e.id === selected)!
        patchElement(selected, { x: placed.x + moves[event.key][0], y: placed.y + moves[event.key][1] }, `nudge:${selected}`)
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault()
        remove(selected)
      } else if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault()
        duplicate(selected)
      } else if (event.key === "Escape") setSelected(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  async function flush() {
    const text = JSON.stringify(data)
    if (text !== savedData.current) {
      await json(`/api/citys/compositions/${composition.id}`, { method: "PUT", body: JSON.stringify({ data }) })
      savedData.current = text
    }
  }

  async function action(body: Record<string, unknown>, done?: string) {
    try {
      await flush()
      const next = await json<Composition>(`/api/citys/compositions/${composition.id}`, { method: "POST", body: JSON.stringify(body) })
      if (next && "elements" in next) onLoaded(next)
      else await reload()
      if (done) toast.success(done)
      return next
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function importImage(file: File) {
    try {
      await flush()
      const body = new FormData()
      body.append("file", file)
      onLoaded(await json<Composition>(`/api/citys/compositions/${composition.id}/import`, { method: "POST", body }))
      toast.success("Reading the layout: it shows in a moment")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="flex flex-col gap-3 px-4 lg:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Compositions" nativeButton={false} render={<Link href="/citys/compositions" />}>
          <ArrowLeftIcon />
        </Button>
        <NameField composition={composition} />
        <span className="text-xs text-muted-foreground">{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : "Not saved"}</span>
        <Button variant="ghost" size="icon-sm" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo" title="Undo (⌘Z)">
          <Undo2Icon />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo" title="Redo (⇧⌘Z)">
          <Redo2Icon />
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => importInput.current?.click()} disabled={!!composition.busy}>
            <FileImageIcon />
            From an image
          </Button>
          <RemixPopover composition={composition} onAsk={(body) => action(body)} busy={!!composition.busy} />
          <CombinePopover composition={composition} onStyle={(body) => action(body, "Combining: the variants show as 1–5")} reload={reload} busy={!!composition.busy} />
          <Button size="sm" variant="outline" onClick={() => setSizesOpen(true)}>
            <LayoutGridIcon />
            All sizes
          </Button>
          <Button size="sm" onClick={() => setVersioning(true)} className="active:scale-[0.97]">
            <SaveIcon />
            Save version
          </Button>
        </div>
        <input
          ref={importInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void importImage(file)
            e.target.value = ""
          }}
        />
      </div>

      <VersionStrip
        composition={composition}
        candidate={candidate}
        onCandidate={setCandidate}
        onRestore={(versionId) => action({ action: "restore", version: versionId }, "Back to that version")}
        onAdopt={(id) => action({ action: "adopt", candidate: id }, "Variant adopted")}
        onDrop={(id) => {
          setCandidate(null)
          void action({ action: "drop", candidate: id })
        }}
        onOwn={async (id) => {
          const made = await action({ action: "own", candidate: id, name: `${composition.name} · variant` })
          if (made && "id" in made) router.push(`/citys/compositions/${(made as Composition).id}`)
        }}
      />

      {composition.busy && (
        <p className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
          {composition.busy}…
        </p>
      )}
      {composition.busyError && !composition.busy && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{composition.busyError}</p>}

      <div className="grid items-start gap-4 lg:grid-cols-[14rem_minmax(0,1fr)_18rem]">
        <Layers
          elements={view.elements}
          selected={selected}
          onSelect={setSelected}
          onAdd={add}
          onToggle={(id, key) => {
            const el = data.elements.find((e) => e.id === id)
            if (el) patchElement(id, { [key]: !el[key] } as Partial<CompositionElement>)
          }}
          onMove={reorder}
          onRemove={remove}
        />

        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Print size">
              <SizeChip on={!size} onClick={() => setSize(null)} label="Layout" />
              {OFFERED.map((s) => (
                <SizeChip key={s.key} on={size === s.key} onClick={() => setSize(s.key)} label={s.cm.replace(" cm", "").replace(/ \(A\d\)/, "")} tweaked={!!data.sizes[s.key] && Object.keys(data.sizes[s.key]!).length > 0} />
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1">
              {SAMPLES.map((s, i) => (
                <SizeChip key={s.label} on={sample === i} onClick={() => setSample(i)} label={s.label} />
              ))}
            </div>
          </div>
          {size && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              Moving and sizing here only changes {SIZE_BY_KEY[size].cm}.
              {data.sizes[size] && (
                <button type="button" className="underline underline-offset-2" onClick={() => commit((d) => ({ ...d, sizes: { ...d.sizes, [size]: {} } }))}>
                  Reset this size
                </button>
              )}
            </p>
          )}
          <div className="rounded-lg bg-muted/50 p-6">
            <CompositionCanvas
              data={view}
              ratio={ratio}
              size={size ?? undefined}
              facts={shownFacts}
              photo={photo}
              palette={palette}
              selected={selected}
              onSelect={setSelected}
              onBox={onBox}
              maxHeight={720}
            />
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4 rounded-lg border p-3 lg:sticky lg:top-0 lg:max-h-[calc(100svh-var(--header-height)-3rem)] lg:overflow-y-auto">
          {current ? (
            <>
              <div className="flex items-center gap-1.5">
                <Input value={current.name} onChange={(e) => patchElement(current.id, { name: e.target.value }, `name:${current.id}`)} className="h-7 text-sm" aria-label="Layer name" />
                <Button variant="ghost" size="icon-sm" aria-label="Duplicate" title="Duplicate (⌘D)" onClick={() => duplicate(current.id)}>
                  <CopyIcon />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Delete" title="Delete" onClick={() => remove(current.id)}>
                  <Trash2Icon />
                </Button>
              </div>
              <ElementProperties el={current} palette={palette} sizeView={!!size} onPatch={(patch, merge) => patchElement(current.id, patch, merge)} />
            </>
          ) : (
            <Group title="Composition">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">Made at</span>
                <div className="flex flex-wrap gap-1">
                  {RATIOS.map((r) => (
                    <SizeChip
                      key={r.label}
                      on={Math.abs(data.ratio - r.value) < 0.003}
                      label={r.label}
                      onClick={() => commit((d) => ({ ...d, ratio: r.value }))}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">Every print size is made from this layout; elements keep their distance as their hold says.</p>
              </div>
              <ColorField label="Paper" value={data.background} palette={palette} onChange={(background) => commit((d) => ({ ...d, background }))} />
              <SampleFacts facts={facts} onChange={setFacts} />
            </Group>
          )}
        </aside>
      </div>

      <SizesDialog open={sizesOpen} onOpenChange={setSizesOpen} data={view} facts={shownFacts} photo={photo} palette={palette} onEdit={(s) => {
        setSize(s)
        setSizesOpen(false)
      }} />
      <SaveVersionDialog
        open={versioning}
        onOpenChange={setVersioning}
        onSave={async (note) => {
          try {
            const saved = await json<Composition>(`/api/citys/compositions/${composition.id}`, { method: "PUT", body: JSON.stringify({ data, version: note || "Saved by hand" }) })
            savedData.current = JSON.stringify(data)
            version.current = saved.version
            onLoaded(saved)
            toast.success(`Version ${saved.version} saved`)
          } catch (e) {
            toast.error((e as Error).message)
          }
        }}
      />
    </div>
  )
}

function SizeChip({ on, onClick, label, tweaked }: { on: boolean; onClick: () => void; label: string; tweaked?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "relative inline-flex h-6 items-center rounded-md border px-2 text-[11px] tabular-nums outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
        on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
      {tweaked && <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-brand" title="Nudged by hand" />}
    </button>
  )
}

function NameField({ composition }: { composition: Composition }) {
  const [value, setValue] = React.useState(composition.name)
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value.trim() && value.trim() !== composition.name) void json(`/api/citys/compositions/${composition.id}`, { method: "PATCH", body: JSON.stringify({ name: value }) }).catch((e: Error) => toast.error(e.message))
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      aria-label="Composition name"
      maxLength={60}
      className="field-sizing-content h-8 max-w-full min-w-24 rounded-md border border-transparent bg-transparent px-2 text-base font-medium outline-none hover:border-input focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    />
  )
}

const LAYER_ICON: Record<CompositionElement["type"], React.ReactNode> = {
  text: <TypeIcon />,
  rect: <BoxIcon />,
  line: <MinusIcon />,
  icon: <StarIcon />,
  photo: <ImageIcon />,
}

function Layers({
  elements,
  selected,
  onSelect,
  onAdd,
  onToggle,
  onMove,
  onRemove,
}: {
  elements: CompositionElement[]
  selected: string | null
  onSelect: (id: string) => void
  onAdd: (kind: "text" | "rect" | "line" | "icon" | "photo") => void
  onToggle: (id: string, key: "hidden" | "locked") => void
  onMove: (id: string, step: number) => void
  onRemove: (id: string) => void
}) {
  return (
    <aside className="flex min-w-0 flex-col gap-2 rounded-lg border p-2">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Layers</h3>
        <div className="flex">
          {(
            [
              ["text", <TypeIcon key="t" />, "Text"],
              ["rect", <BoxIcon key="r" />, "Colour box"],
              ["line", <MinusIcon key="l" />, "Rule"],
              ["icon", <ShapesIcon key="i" />, "Icon"],
              ["photo", <ImageIcon key="p" />, "Photo frame"],
            ] as const
          ).map(([kind, icon, label]) => (
            <Button key={kind} variant="ghost" size="icon-xs" aria-label={`Add ${label}`} title={`Add ${label}`} onClick={() => onAdd(kind)}>
              {icon}
            </Button>
          ))}
        </div>
      </div>
      <ul className="flex flex-col">
        {[...elements].reverse().map((el) => (
          <li key={el.id}>
            <div
              className={cn(
                "group/layer flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs [&_svg]:size-3.5",
                el.id === selected ? "bg-accent" : "hover:bg-accent/60",
                el.hidden && "opacity-50"
              )}
            >
              <button type="button" onClick={() => onSelect(el.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:underline">
                <span className="text-muted-foreground">{LAYER_ICON[el.type]}</span>
                <span className="truncate">{el.name}</span>
              </button>
              <div className="flex opacity-0 group-hover/layer:opacity-100 focus-within:opacity-100">
                <IconButton label="Forward" onClick={() => onMove(el.id, 1)} icon={<ChevronUpIcon />} />
                <IconButton label="Backward" onClick={() => onMove(el.id, -1)} icon={<ChevronDownIcon />} />
                <IconButton label="Delete" onClick={() => onRemove(el.id)} icon={<Trash2Icon />} />
              </div>
              <IconButton label={el.locked ? "Unlock" : "Lock"} onClick={() => onToggle(el.id, "locked")} icon={el.locked ? <LockIcon /> : <UnlockIcon />} dim={!el.locked} />
              <IconButton label={el.hidden ? "Show" : "Hide"} onClick={() => onToggle(el.id, "hidden")} icon={el.hidden ? <EyeOffIcon /> : <EyeIcon />} dim={!el.hidden} />
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function IconButton({ label, onClick, icon, dim }: { label: string; onClick: () => void; icon: React.ReactNode; dim?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={cn("grid size-5 place-items-center rounded outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/50", dim && "text-muted-foreground opacity-0 group-hover/layer:opacity-100")}>
      {icon}
    </button>
  )
}

function SampleFacts({ facts, onChange }: { facts: PlaceFacts; onChange: (facts: PlaceFacts) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] text-muted-foreground">Sample place (for trying the layout)</span>
      <Input value={facts.city} onChange={(e) => onChange({ ...facts, city: e.target.value })} className="h-7 text-xs" aria-label="Sample place" />
      <Input value={facts.country} onChange={(e) => onChange({ ...facts, country: e.target.value })} className="h-7 text-xs" aria-label="Sample country" />
      <Textarea value={facts.description} onChange={(e) => onChange({ ...facts, description: e.target.value })} className="min-h-20 text-xs" aria-label="Sample paragraph" />
    </div>
  )
}

function VersionStrip({
  composition,
  candidate,
  onCandidate,
  onRestore,
  onAdopt,
  onDrop,
  onOwn,
}: {
  composition: Composition
  candidate: string | null
  onCandidate: (id: string | null) => void
  onRestore: (versionId: string) => void
  onAdopt: (id: string) => void
  onDrop: (id: string) => void
  onOwn: (id: string) => void
}) {
  const shown = composition.candidates.find((c) => c.id === candidate)
  if (!composition.history.length && !composition.candidates.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5">
      <button
        type="button"
        onClick={() => onCandidate(null)}
        aria-pressed={!candidate}
        className={cn("rounded-md px-2 py-0.5 text-sm font-medium outline-none", !candidate ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
      >
        Version {composition.version}
      </button>
      {composition.candidates.map((c, i) => (
        <button
          key={c.id}
          type="button"
          title={c.label}
          aria-pressed={candidate === c.id}
          onClick={() => onCandidate(candidate === c.id ? null : c.id)}
          className={cn("grid size-7 place-items-center rounded-md border text-sm font-semibold tabular-nums outline-none active:scale-[0.95]", candidate === c.id ? "border-brand bg-brand text-white" : "border-brand/40 bg-brand/5 text-brand hover:bg-brand/10")}
        >
          {i + 1}
        </button>
      ))}
      {shown && (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="max-w-md truncate text-xs text-muted-foreground">{shown.label}</span>
          <Button size="xs" onClick={() => onAdopt(shown.id)}>
            Make main
          </Button>
          <Button size="xs" variant="outline" onClick={() => onOwn(shown.id)}>
            Own composition
          </Button>
          <Button size="xs" variant="ghost" onClick={() => onDrop(shown.id)}>
            Drop
          </Button>
        </div>
      )}
      <Popover>
        <PopoverTrigger render={<Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" disabled={!composition.history.length} />}>
          <HistoryIcon />
          History
        </PopoverTrigger>
        <PopoverContent align="end" className="max-h-[60svh] w-80 gap-0 overflow-y-auto p-1">
          {[...composition.history].reverse().map((v) => (
            <div key={v.id} className="group/v flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded bg-muted text-[11px] font-semibold tabular-nums">{v.number}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs">{v.note}</span>
                <span className="text-[10px] text-muted-foreground">{new Date(v.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </span>
              {v.number !== composition.version && (
                <Button variant="ghost" size="icon-xs" aria-label={`Back to version ${v.number}`} onClick={() => onRestore(v.id)} className="opacity-0 group-hover/v:opacity-100 focus-visible:opacity-100">
                  <RotateCcwIcon />
                </Button>
              )}
            </div>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  )
}

function RemixPopover({ composition, onAsk, busy }: { composition: Composition; onAsk: (body: Record<string, unknown>) => Promise<unknown>; busy: boolean }) {
  const [picked, setPicked] = React.useState<string[]>([])
  const [free, setFree] = React.useState("")
  const [creativity, setCreativity] = React.useState(3)
  const [asking, setAsking] = React.useState(false)
  const ideas = composition.remixes ?? []
  const room = 5 - composition.candidates.length
  return (
    <Popover>
      <PopoverTrigger render={<Button size="sm" variant="outline" disabled={busy} />}>
        <WandSparklesIcon />
        Remix
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Five ways to remix it</span>
          <Button
            size="xs"
            variant="ghost"
            disabled={asking}
            onClick={async () => {
              setAsking(true)
              await onAsk({ action: "ideas" })
              setAsking(false)
            }}
          >
            {asking ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
            {ideas.length ? "New ideas" : "Suggest"}
          </Button>
        </div>
        <ul className="flex flex-col gap-1">
          {ideas.map((idea) => {
            const on = picked.includes(idea.id)
            return (
              <li key={idea.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked((list) => (on ? list.filter((x) => x !== idea.id) : [...list, idea.id]))}
                  className={cn("w-full rounded-md border px-2 py-1.5 text-left text-xs outline-none", on ? "border-brand/60 bg-brand/10" : "border-border hover:border-foreground/25")}
                >
                  {idea.text}
                </button>
              </li>
            )
          })}
          {!ideas.length && <li className="text-xs text-muted-foreground">Ask for ideas, or write your own below.</li>}
        </ul>
        <Input value={free} onChange={(e) => setFree(e.target.value)} placeholder="Or your own idea" className="h-8 text-xs" />
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Creativity</span>
          <Slider value={creativity} min={1} max={5} step={1} onValueChange={(v) => setCreativity(Array.isArray(v) ? v[0] : v)} className="flex-1" />
          <span className="w-4 text-xs tabular-nums">{creativity}</span>
        </div>
        <Button
          size="sm"
          disabled={(!picked.length && !free.trim()) || picked.length + (free.trim() ? 1 : 0) > room}
          onClick={async () => {
            await onAsk({ action: "remix", ideas: picked, free, creativity })
            setPicked([])
            setFree("")
          }}
        >
          <WandSparklesIcon />
          Try {picked.length + (free.trim() ? 1 : 0) || ""} as variants
        </Button>
        {room < 5 && <p className="text-[11px] text-muted-foreground">{room} of 5 variant slots free.</p>}
      </PopoverContent>
    </Popover>
  )
}

function CombinePopover({ composition, onStyle, reload, busy }: { composition: Composition; onStyle: (body: Record<string, unknown>) => Promise<unknown>; reload: () => Promise<void>; busy: boolean }) {
  const styles = useStyles()
  const [styleId, setStyleId] = React.useState("")
  const [count, setCount] = React.useState(2)
  const [creativity, setCreativity] = React.useState(3)
  const input = React.useRef<HTMLInputElement>(null)
  const room = 5 - composition.candidates.length
  return (
    <Popover>
      <PopoverTrigger render={<Button size="sm" variant="outline" disabled={busy} />}>
        <PaletteIcon />
        Combine
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3">
        <span className="text-sm font-medium">Combine with a style or a poster</span>
        <select value={styleId} onChange={(e) => setStyleId(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm" aria-label="Style">
          <option value="">Pick a style…</option>
          {(styles ?? []).filter((s) => s.guide).map((s) => (
            <option key={s.id} value={s.id}>
              {s.kind === "city" ? "City · " : ""}
              {s.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-3">
          <span className="w-16 text-xs text-muted-foreground">Variants</span>
          <Slider value={count} min={1} max={Math.max(1, room)} step={1} onValueChange={(v) => setCount(Array.isArray(v) ? v[0] : v)} className="flex-1" />
          <span className="w-4 text-xs tabular-nums">{count}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-16 text-xs text-muted-foreground">Creativity</span>
          <Slider value={creativity} min={1} max={5} step={1} onValueChange={(v) => setCreativity(Array.isArray(v) ? v[0] : v)} className="flex-1" />
          <span className="w-4 text-xs tabular-nums">{creativity}</span>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" className="flex-1" disabled={!styleId || room < 1} onClick={() => onStyle({ action: "combine", styleId, count, creativity })}>
            With the style
          </Button>
          <Button size="sm" variant="outline" className="flex-1" disabled={room < 1} onClick={() => input.current?.click()}>
            With a poster…
          </Button>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (!file) return
            const body = new FormData()
            body.append("file", file)
            body.append("count", String(count))
            body.append("creativity", String(creativity))
            try {
              await json(`/api/citys/compositions/${composition.id}/combine`, { method: "POST", body })
              await reload()
              toast.success("Combining: the variants show as 1–5")
            } catch (error) {
              toast.error((error as Error).message)
            }
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function SizesDialog({
  open,
  onOpenChange,
  data,
  facts,
  photo,
  palette,
  onEdit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: CompositionData
  facts: PlaceFacts
  photo: PhotoInput
  palette: Palette
  onEdit: (size: SizeKey) => void
}) {
  const fonts = useLoadedFonts(fontsOf(data))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Every print size</DialogTitle>
          <DialogDescription>The same layout at each size the listing offers. Click one to nudge it on its own.</DialogDescription>
        </DialogHeader>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] items-end gap-4">
          {OFFERED.map((s) => {
            const ratio = s.widthMm / s.heightMm
            const { svg } = renderSvg({ data, ratio, size: s.key, facts, fonts, photo, palette, width: 180 })
            return (
              <li key={s.key}>
                <button type="button" onClick={() => onEdit(s.key)} className="group/size flex w-full flex-col items-center gap-1.5 outline-none">
                  <div className="w-full shadow-sm ring-1 ring-border transition-shadow group-hover/size:ring-brand" style={{ aspectRatio: String(ratio) }} dangerouslySetInnerHTML={{ __html: svg.replace(/width="[^"]+" height="[^"]+"/, 'width="100%" height="100%"') }} />
                  <span className="text-xs tabular-nums">{s.cm}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

function SaveVersionDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; onSave: (note: string) => Promise<void> }) {
  const [note, setNote] = React.useState("")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={async (e) => {
            e.preventDefault()
            await onSave(note.trim())
            setNote("")
            onOpenChange(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>Save a version</DialogTitle>
            <DialogDescription>Keeps the layout as it is now, to come back to.</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed (optional)" />
          <DialogFooter>
            <Button type="submit">
              <SaveIcon />
              Save version
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

