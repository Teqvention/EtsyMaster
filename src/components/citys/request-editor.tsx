"use client"

import * as React from "react"
import { BookmarkPlusIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ClockIcon, MinusIcon, PlusIcon, XIcon, ZapIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useCustomSkies } from "@/hooks/use-custom-skies"
import { saveTemplates, useCityShared } from "@/hooks/use-stealer"
import { useStyles } from "@/hooks/use-styles"
import { SKIES, skyById, type SkyId } from "@/lib/citys/skies"
import {
  LEVEL_LABEL,
  LEVELS,
  REF_MODES,
  requestSize,
  ROWS_MAX,
  SET_MAX,
  SET_MIN,
  type CityRequest,
  type CityTemplate,
  type CreativityRow,
  type Level,
  type RefMode,
  type StyleRequest,
} from "@/lib/citys/studio-types"
import type { StyleSummary } from "@/lib/styles/types"
import { cn } from "@/lib/utils"

// What a reference photo (or a whole pick of them) is asked for, in one
// panel that reads top to bottom: whether everything becomes a real photo
// (off: a sketch makes sketches) and whether we decide per photo
// (autonomous); then the variants by creativity with one sky per row (a
// "+" adds a row with another sky), new ideas, a set that hangs together,
// and the city styles. A template fills it in one click and any change can
// be saved as a new one.

export function RequestEditor({
  value,
  onChange,
  hasReference = true,
  compact = false,
}: {
  value: CityRequest
  onChange: (next: CityRequest) => void
  /** Without a reference photo only city-only styles can be made. */
  hasReference?: boolean
  compact?: boolean
}) {
  const styles = useStyles()
  const cityStyles = (styles ?? []).filter((s) => s.kind === "city")
  const normalStyles = (styles ?? []).filter((s) => s.kind !== "city" && s.guide)
  const set = (change: Partial<CityRequest>) => onChange({ ...value, ...change })

  const setRow = (index: number, row: CreativityRow | null) => {
    const rows = value.rows.flatMap((r, i) => (i === index ? (row ? [row] : []) : [r]))
    set({ rows: rows.length ? rows : [{ levels: {}, sky: "auto" }] })
  }
  const setLevel = (index: number, level: Level, count: number) => {
    const row = value.rows[index]
    const levels = { ...row.levels }
    if (count > 0) levels[level] = count
    else delete levels[level]
    setRow(index, { ...row, levels })
  }
  const styleOf = (id: string) => value.styles.find((s) => s.styleId === id)
  const setStyle = (id: string, next: StyleRequest | null) => {
    const others = value.styles.filter((s) => s.styleId !== id)
    set({ styles: next ? [...others, next] : others })
  }
  const auto = value.auto.on

  return (
    <div className={cn("flex flex-col", compact ? "gap-3.5" : "gap-4")}>
      <div className="grid grid-cols-2 gap-2">
        <SwitchCard
          label="Real photos"
          hint={value.realPhoto ? "Everything comes out as a real photo, even from an illustration" : "Off: every image keeps the reference's own look, a sketch makes sketches"}
          on={value.realPhoto}
          disabled={!hasReference}
          onChange={(realPhoto) => set({ realPhoto })}
        />
        <SwitchCard
          label="Autonomous"
          hint={auto ? `We look at each photo and pick creativity and sky for ${value.auto.count} ${value.auto.count === 1 ? "variant" : "variants"}` : "We decide per photo how much to change"}
          on={auto}
          disabled={!hasReference}
          onChange={(on) => set({ auto: { ...value.auto, on } })}
        >
          {auto && (
            <div className="mt-1.5 flex rounded-md border p-0.5" role="group" aria-label="Variants per photo">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={value.auto.count === n}
                  onClick={() => set({ auto: { on: true, count: n } })}
                  className={cn(
                    "h-5 flex-1 rounded-[5px] text-[11px] font-medium tabular-nums outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
                    value.auto.count === n ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </SwitchCard>
      </div>

      <Section
        title="Creativity"
        hint={
          !hasReference
            ? "Needs a reference photo"
            : auto
              ? "Autonomous is on: we pick each photo's creativity and sky."
              : "Variants of the reference, 1 nearly the same, 5 our most beautiful take. The sky counts for every level in its row."
        }
      >
        <div className={cn("flex flex-col gap-2 transition-opacity duration-150", (auto || !hasReference) && "pointer-events-none opacity-45")}>
          {value.rows.map((row, index) => (
            <div key={index} className={cn("flex flex-col gap-1.5", index > 0 && "border-t border-dashed pt-2")}>
              <div className="grid grid-cols-5 gap-1">
                {LEVELS.map((level) => (
                  <LevelChip key={level} level={level} count={row.levels[level] ?? 0} disabled={auto || !hasReference} onChange={(n) => setLevel(index, level, n)} />
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Sky</span>
                <SkyPicker value={row.sky} onChange={(sky) => setRow(index, { ...row, sky })} />
                {index > 0 && (
                  <Button variant="ghost" size="icon-xs" className="ml-auto text-muted-foreground" aria-label="Remove this row" onClick={() => setRow(index, null)}>
                    <XIcon />
                  </Button>
                )}
              </div>
            </div>
          ))}
          {value.rows.length < ROWS_MAX && (
            <button
              type="button"
              onClick={() => set({ rows: [...value.rows, { levels: { 1: 1 }, sky: nextSky(value.rows) }] })}
              className="flex h-7 items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground outline-none transition-colors duration-150 hover:border-foreground/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <PlusIcon className="size-3.5" />
              Another row with its own sky
            </button>
          )}
        </div>
      </Section>

      <div className="grid grid-cols-2 gap-3">
        <Field label="New ideas" hint="New compositions of the place in the reference's look, from another of its signature views">
          <Stepper value={value.ideas} max={6} disabled={!hasReference} onChange={(ideas) => set({ ideas })} />
        </Field>
        <div className="flex flex-col gap-1">
          <label className="flex items-center justify-between gap-2 text-xs font-medium" title="A set that hangs together: one look, at least three different motifs of the place">
            Set of 3
            <Switch size="sm" checked={value.set.on} disabled={!hasReference} onCheckedChange={(on) => set({ set: { ...value.set, on } })} />
          </label>
          {value.set.on ? (
            <div className="flex h-7 items-center gap-2">
              <Slider
                value={[value.set.count]}
                min={SET_MIN}
                max={SET_MAX}
                step={1}
                onValueChange={(v) => set({ set: { on: true, count: Array.isArray(v) ? v[0] : v } })}
                aria-label="Images in the set"
              />
              <span className="w-4 text-right text-sm font-medium tabular-nums">{value.set.count}</span>
            </div>
          ) : (
            <p className="text-[11px] leading-tight text-pretty text-muted-foreground">Three motifs or more that capture the place</p>
          )}
        </div>
      </div>
      {(value.ideas > 0 || value.set.on) && !auto && hasReference && (
        <p className="-mt-1.5 text-[11px] text-muted-foreground">New ideas and the set take the first row&apos;s sky.</p>
      )}

      <Section title="City styles" hint="Posters of the city in a style; per style, how it uses the reference photo">
        {cityStyles.length === 0 && <p className="text-xs text-muted-foreground">No city style yet: make one under Citys → Styles.</p>}
        <div className="flex flex-col gap-1">
          {cityStyles.map((s) => (
            <StyleRow key={s.id} style={s} value={styleOf(s.id)} hasReference={hasReference} onChange={(next) => setStyle(s.id, next)} />
          ))}
        </div>
        {normalStyles.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="group/more flex items-center gap-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:underline">
              <ChevronRightIcon className="size-3.5 transition-transform duration-150 ease-out group-data-panel-open/more:rotate-90" />
              Normal styles · their art, with the city added
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1 flex flex-col gap-1">
                {normalStyles.map((s) => (
                  <StyleRow key={s.id} style={s} value={styleOf(s.id)} hasReference={hasReference} onChange={(next) => setStyle(s.id, next)} />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </Section>

      <Field label="Notes for every image" hint="Optional: what should be different">
        <Textarea
          value={value.notes ?? ""}
          onChange={(e) => set({ notes: e.target.value || undefined })}
          placeholder="e.g. keep the river in the foreground, no cars"
          className="min-h-9 resize-none py-1.5 text-sm"
          rows={1}
        />
      </Field>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Paint</span>
        <div className="flex rounded-lg border p-0.5">
          <DeliveryButton on={value.delivery === "batch"} onClick={() => set({ delivery: "batch" })} icon={<ClockIcon />} label="In batch" hint="Half the price, back in minutes to hours" />
          <DeliveryButton on={value.delivery === "now"} onClick={() => set({ delivery: "now" })} icon={<ZapIcon />} label="Now" hint="Full price, one after another right away" />
        </div>
      </div>
    </div>
  )
}

/** A sky for a new row: the first one the other rows don't have yet. */
function nextSky(rows: CreativityRow[]): SkyId {
  const used = new Set(rows.map((r) => r.sky))
  return SKIES.find((s) => !used.has(s.id))?.id ?? "auto"
}

function SwitchCard({
  label,
  hint,
  on,
  disabled,
  onChange,
  children,
}: {
  label: string
  hint: string
  on: boolean
  disabled?: boolean
  onChange: (on: boolean) => void
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border px-2.5 py-2 transition-[border-color,background-color] duration-150 ease-out",
        on ? "border-brand/50 bg-brand/5" : "border-border",
        disabled && "opacity-50"
      )}
    >
      <label className="flex items-center justify-between gap-2 text-xs font-medium">
        {label}
        <Switch size="sm" checked={on} disabled={disabled} onCheckedChange={onChange} />
      </label>
      <p className="mt-0.5 text-[11px] leading-tight text-pretty text-muted-foreground">{hint}</p>
      {children}
    </div>
  )
}

export function SkySwatch({ sky, className }: { sky: SkyId; className?: string }) {
  const own = useCustomSkies()
  const found = skyById(sky, own ?? [])
  return (
    <span
      aria-hidden
      className={cn("grid size-4 shrink-0 place-items-center rounded-full ring-1 ring-foreground/10", className)}
      style={{ background: found ? `linear-gradient(to top, ${found.swatch.join(", ")})` : "conic-gradient(from 200deg, #f3c9cf, #f2c38f, #a9e3e2, #b4d7f3, #d9c6e8, #f3c9cf)" }}
    />
  )
}

export function SkyPicker({ value, onChange }: { value: SkyId; onChange: (sky: SkyId) => void }) {
  const [open, setOpen] = React.useState(false)
  const own = useCustomSkies()
  const current = skyById(value, own ?? [])
  const pick = (sky: SkyId) => {
    onChange(sky)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="xs" className="gap-1.5 pl-1.5" />}>
        <SkySwatch sky={value} />
        {current?.name ?? "Open"}
        <ChevronDownIcon className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-0 p-1">
        <SkyOption sky="auto" name="Open" hint="We choose what makes the picture most beautiful" on={value === "auto"} onPick={pick} />
        <div className="my-1 h-px bg-border" />
        <div className="grid grid-cols-2 gap-0.5">
          {SKIES.map((s) => (
            <SkyOption key={s.id} sky={s.id} name={s.name} hint={s.hint} on={value === s.id} onPick={pick} />
          ))}
        </div>
        {own && own.length > 0 && (
          <>
            <div className="mt-1 px-2 pt-1.5 pb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Your skies</div>
            <div className="grid grid-cols-2 gap-0.5">
              {own.map((s) => (
                <SkyOption key={s.id} sky={s.id} name={s.name} hint={s.hint} on={value === s.id} onPick={pick} />
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

function SkyOption({ sky, name, hint, on, onPick }: { sky: SkyId; name: string; hint: string; on: boolean; onPick: (sky: SkyId) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(sky)}
      aria-pressed={on}
      title={hint}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:bg-accent [@media(hover:hover)]:hover:bg-accent",
        on && "bg-accent"
      )}
    >
      <SkySwatch sky={sky} className="size-5" />
      <span className="min-w-0">
        <span className="flex items-center gap-1 truncate text-xs font-medium">
          {name}
          {on && <CheckIcon className="size-3 text-brand" />}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">{hint}</span>
      </span>
    </button>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div>
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
        {hint && <p className="text-[11px] text-pretty text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium" title={hint}>
        {label}
      </span>
      {children}
    </div>
  )
}

function LevelChip({ level, count, disabled, onChange }: { level: Level; count: number; disabled: boolean; onChange: (count: number) => void }) {
  const on = count > 0
  const meta = LEVEL_LABEL[level]
  return (
    <div
      className={cn(
        "group/level relative flex flex-col items-center rounded-lg border px-1 pt-1.5 pb-1 text-center transition-[border-color,background-color] duration-150 ease-out",
        on ? "border-brand/60 bg-brand/5" : "border-border",
        disabled && "opacity-50"
      )}
      title={meta.hint}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(on ? 0 : 1)}
        className="flex w-full flex-col items-center gap-0.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97]"
        aria-pressed={on}
      >
        <span className={cn("text-base leading-none font-semibold tabular-nums", on ? "text-brand" : "text-muted-foreground")}>{level}</span>
        <span className="text-[10px] leading-tight text-muted-foreground">{meta.label}</span>
      </button>
      <div className={cn("mt-1 flex items-center gap-0.5 transition-opacity duration-150", on ? "opacity-100" : "pointer-events-none opacity-0")}>
        <MiniButton label="Fewer" onClick={() => onChange(Math.max(0, count - 1))} icon={<MinusIcon />} />
        <span className="w-3 text-[11px] font-medium tabular-nums">{count}</span>
        <MiniButton label="More" onClick={() => onChange(Math.min(6, count + 1))} icon={<PlusIcon />} />
      </div>
    </div>
  )
}

function MiniButton({ label, onClick, icon }: { label: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-4 place-items-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3"
    >
      {icon}
    </button>
  )
}

export function Chip({
  on,
  onClick,
  disabled,
  title,
  children,
}: {
  on: boolean
  onClick: () => void
  disabled?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      title={title}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs outline-none transition-[border-color,background-color,color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        on ? "border-brand/60 bg-brand/10 text-foreground" : "border-border text-muted-foreground [@media(hover:hover)]:hover:text-foreground"
      )}
    >
      {on && <CheckIcon className="size-3 text-brand" />}
      {children}
    </button>
  )
}

export function Stepper({ value, max, disabled, onChange }: { value: number; max: number; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <div className={cn("flex w-fit items-center rounded-lg border", disabled && "pointer-events-none opacity-50")}>
      <button type="button" aria-label="Fewer" onClick={() => onChange(Math.max(0, value - 1))} className="grid size-7 place-items-center rounded-l-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        <MinusIcon className="size-3.5" />
      </button>
      <span className="w-6 text-center text-sm font-medium tabular-nums">{value}</span>
      <button type="button" aria-label="More" onClick={() => onChange(Math.min(max, value + 1))} className="grid size-7 place-items-center rounded-r-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        <PlusIcon className="size-3.5" />
      </button>
    </div>
  )
}

function StyleRow({ style, value, hasReference, onChange }: { style: StyleSummary; value: StyleRequest | undefined; hasReference: boolean; onChange: (next: StyleRequest | null) => void }) {
  const on = !!value
  const modes = value?.modes ?? []
  const toggleMode = (mode: RefMode) => {
    if (!value) return
    const next = modes.includes(mode) ? modes.filter((m) => m !== mode) : [...modes, mode]
    onChange({ ...value, modes: next.length ? next : [mode] })
  }
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-lg border px-2 py-1.5 transition-[border-color,background-color] duration-150 ease-out", on ? "border-brand/50 bg-brand/5" : "border-border")}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(on ? null : { styleId: style.id, modes: hasReference ? ["photo"] : ["city"], count: 1 })}
          aria-pressed={on}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className={cn("grid size-4 shrink-0 place-items-center rounded-[4px] border", on ? "border-brand bg-brand text-white" : "border-input")}>{on && <CheckIcon className="size-3" />}</span>
          {style.covers[0] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${style.covers[0]}?w=160`} alt="" className="size-6 shrink-0 rounded object-cover" />
          )}
          <span className="truncate text-sm">{style.name}</span>
        </button>
        {on && <Stepper value={value!.count} max={4} onChange={(count) => onChange({ ...value!, count: Math.max(1, count) })} />}
      </div>
      {on && (
        <div className="flex flex-wrap gap-1 pl-6">
          {REF_MODES.map((m) => (
            <Chip key={m.value} on={modes.includes(m.value)} disabled={m.value !== "city" && !hasReference} onClick={() => toggleMode(m.value)} title={m.hint}>
              {m.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  )
}

function DeliveryButton({ on, onClick, icon, label, hint }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={hint}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5",
        on ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  )
}

// --- Templates ---

/** The template a request matches, if it matches one exactly. */
export function matchTemplate(templates: CityTemplate[] | null, request: CityRequest) {
  const key = JSON.stringify(normal(request))
  return templates?.find((t) => JSON.stringify(normal(t.request)) === key) ?? null
}

function normal(r: CityRequest) {
  return {
    rows: r.rows.map((row) => ({ sky: row.sky, levels: LEVELS.map((l) => row.levels[l] ?? 0) })),
    auto: r.auto.on ? r.auto.count : 0,
    ideas: r.ideas,
    set: r.set.on ? r.set.count : 0,
    realPhoto: r.realPhoto,
    styles: [...r.styles].sort((a, b) => a.styleId.localeCompare(b.styleId)).map((s) => ({ ...s, modes: [...s.modes].sort() })),
    notes: r.notes ?? "",
    delivery: r.delivery,
  }
}

export function TemplatePicker({ value, onPick }: { value: CityRequest; onPick: (request: CityRequest) => void }) {
  const { templates } = useCityShared()
  const current = matchTemplate(templates, value)
  const [naming, setNaming] = React.useState(false)
  const [name, setName] = React.useState("")
  const [open, setOpen] = React.useState(false)

  async function save() {
    if (!name.trim() || !templates) return
    const template: CityTemplate = { id: `t-${Date.now().toString(36)}`, name: name.trim(), request: value, createdAt: new Date().toISOString() }
    try {
      await saveTemplates([...templates, template])
      toast.success(`Saved “${template.name}”`)
      setNaming(false)
      setName("")
    } catch (error) {
      toast.error(`Couldn't save it: ${(error as Error).message}`)
    }
  }

  async function remove(id: string) {
    if (!templates) return
    await saveTemplates(templates.filter((t) => t.id !== id)).catch((e: Error) => toast.error(e.message))
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button variant="outline" size="sm" className="min-w-0 justify-between" />}>
          <span className="truncate">{current?.name ?? "Custom"}</span>
          <ChevronDownIcon className="text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 gap-0 p-1">
          {(templates ?? []).map((t) => (
            <div key={t.id} className="group/t flex items-center">
              <button
                type="button"
                onClick={() => {
                  onPick(t.request)
                  setOpen(false)
                }}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:bg-accent [@media(hover:hover)]:hover:bg-accent"
              >
                <span className="truncate">{t.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{requestSize(t.request)} img</span>
              </button>
              <button
                type="button"
                aria-label={`Delete template ${t.name}`}
                onClick={() => remove(t.id)}
                className="grid size-6 place-items-center rounded text-muted-foreground opacity-0 outline-none group-hover/t:opacity-100 hover:text-destructive focus-visible:opacity-100"
              >
                <MinusIcon className="size-3.5" />
              </button>
            </div>
          ))}
        </PopoverContent>
      </Popover>
      {!current &&
        (naming ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" className="h-8 w-36" onKeyDown={(e) => e.key === "Escape" && setNaming(false)} />
            <Button type="submit" size="icon-sm" disabled={!name.trim()} aria-label="Save template">
              <CheckIcon />
            </Button>
          </form>
        ) : (
          <Button variant="ghost" size="icon-sm" aria-label="Save as template" title="Save as template" onClick={() => setNaming(true)}>
            <BookmarkPlusIcon />
          </Button>
        ))}
    </div>
  )
}
