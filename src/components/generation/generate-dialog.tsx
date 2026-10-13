"use client"

import * as React from "react"
import { ClockIcon, LightbulbIcon, LoaderCircleIcon, PlusIcon, RepeatIcon, SparklesIcon, XIcon, ZapIcon } from "lucide-react"

import { ImagePicker, ThumbStack, type ImagePick } from "@/components/generation/image-picker"
import { CreativityMeter } from "@/components/generation/parts"
import { StyleSelect } from "@/components/styles/style-select"
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
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  CREATIVITIES,
  CREATIVITY_LABEL,
  DEFAULT_OPTIONS,
  MAX_IDEAS,
  MAX_INSPIRATION,
  MAX_VARIANTS,
  spread,
  type Creativity,
  type Delivery,
  type GenerateGroup,
  type GenerateOptions,
} from "@/lib/generation/types"
import { applyPresetOps, type PresetOp } from "@/lib/generation/preset-ops"
import { createSyncedStore } from "@/lib/synced-store"
import { cn } from "@/lib/utils"

// What to make from the posters of one or many steals: variants (redraws at a
// creativity, spread evenly over any of five levels, optionally in a saved
// style) and, as an add-on, new ideas on the same selling concept. Given
// `inspiration`, it asks for new ideas only, after the images picked of it.

/** An image a batch of new ideas can take after; approved ones start picked. */
export type InspirationPick = ImagePick

export function GenerateDialog({
  open,
  onOpenChange,
  title,
  description,
  thumbs = [],
  references,
  notes = true,
  notesFirst = false,
  initial,
  submitLabel = "Generate",
  inspiration,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  /** A few of the steals' photos, stacked in the header. */
  thumbs?: string[]
  /** Posters (or steals) the options apply to; the total is counted from it. */
  references: { count: number; noun: string }
  notes?: boolean
  /** Notes on top and focused: for "more like this", where they're the point. */
  notesFirst?: boolean
  initial?: GenerateOptions
  submitLabel?: string
  /** New ideas only, after the ones picked of these (approved picked to start). */
  inspiration?: InspirationPick[]
  /** Throw to keep the dialog open. */
  onSubmit: (options: GenerateOptions) => Promise<void> | void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-xl">
        {open && (
          <Form
            title={title}
            description={description}
            thumbs={thumbs}
            references={references}
            notes={notes}
            notesFirst={notesFirst}
            initial={initial ?? DEFAULT_OPTIONS}
            submitLabel={submitLabel}
            inspiration={inspiration}
            onSubmit={async (options) => {
              await onSubmit(options)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Form({
  title,
  description,
  thumbs,
  references,
  notes,
  notesFirst,
  initial,
  submitLabel,
  inspiration,
  onSubmit,
}: {
  title: string
  description?: React.ReactNode
  thumbs: string[]
  references: { count: number; noun: string }
  notes: boolean
  notesFirst: boolean
  initial: GenerateOptions
  submitLabel: string
  inspiration?: InspirationPick[]
  onSubmit: (options: GenerateOptions) => Promise<void>
}) {
  const inspired = inspiration !== undefined
  const [picked, setPicked] = React.useState(
    () => new Set(inspiration?.filter((i) => i.approved).slice(0, MAX_INSPIRATION).map((i) => i.id))
  )
  const [variantsOn, setVariantsOn] = React.useState(!inspired && initial.variants.count > 0)
  const [variants, setVariants] = React.useState<GenerateGroup>({
    count: initial.variants.count || 3,
    creativity: initial.variants.creativity,
  })
  const [styleId, setStyleId] = React.useState(initial.variants.styleId)
  const [ideasOn, setIdeasOn] = React.useState(inspired || initial.ideas.count > 0)
  const [ideas, setIdeas] = React.useState<GenerateGroup>({
    count: initial.ideas.count || 6,
    creativity: initial.ideas.creativity,
  })
  const [feedback, setFeedback] = React.useState(initial.feedback ?? "")
  const [delivery, setDelivery] = useDelivery()
  const [busy, setBusy] = React.useState(false)

  const perReference = (variantsOn ? variants.count : 0) + (ideasOn ? ideas.count : 0)
  const total = perReference * references.count
  const empty = perReference === 0 || (inspired && picked.size === 0)

  const current: PresetSettings = {
    variants: { on: variantsOn, ...variants, styleId },
    ideas: { on: ideasOn, ...ideas },
    delivery,
  }

  /** Runs with what's on screen, or straight away with a preset's settings (shown as it runs). */
  async function submit(settings: PresetSettings = current) {
    const { variants: v, ideas: i } = settings
    if (busy || (v.on ? v.count : 0) + (i.on ? i.count : 0) === 0 || (inspired && picked.size === 0)) return
    if (settings !== current) {
      setVariantsOn(v.on)
      setVariants({ count: v.count, creativity: v.creativity })
      setStyleId(v.styleId)
      setIdeasOn(i.on)
      setIdeas({ count: i.count, creativity: i.creativity })
      setDelivery(settings.delivery)
    }
    setBusy(true)
    try {
      await onSubmit({
        variants: {
          count: v.on ? v.count : 0,
          creativity: v.creativity,
          styleId: v.on ? v.styleId : null,
        },
        ideas: { count: i.on ? i.count : 0, creativity: i.creativity },
        ...(feedback.trim() && { feedback: feedback.trim() }),
        ...(initial.posters && { posters: initial.posters }),
        ...(inspired && {
          inspiration: inspiration.filter((i) => picked.has(i.id)).map((i) => i.id),
        }),
        ...(settings.delivery === "batch" && { delivery: "batch" as const }),
      })
    } catch {
      // Whoever submitted said what went wrong; the dialog stays for another go.
    } finally {
      setBusy(false)
    }
  }

  const notesField = notes && (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        {notesFirst ? "What should be different?" : "Notes for the AI"} <span className="font-normal">· optional</span>
      </span>
      <Textarea
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            submit()
          }
        }}
        rows={2}
        autoFocus={notesFirst}
        placeholder={
          notesFirst
            ? "What should be different? e.g. darker background, swap the dog for a fox, no text…"
            : "e.g. warmer colours, no text, more minimal, make the dog a cat…"
        }
        className="min-h-0 resize-none"
      />
    </label>
  )

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      // min-w-0: a long truncated description must not size the dialog's grid column.
      className="flex max-h-[min(88svh,52rem)] min-w-0 flex-col"
    >
      <DialogHeader className="flex-row items-center gap-3 border-b p-4 pr-12">
        {thumbs.length > 0 && <ThumbStack thumbs={thumbs} />}
        <div className="flex min-w-0 flex-col gap-0.5">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription className="truncate">{description}</DialogDescription>}
        </div>
      </DialogHeader>

      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-4">
        {notesFirst && notesField}
        {inspired ? (
          <>
            <ImagePicker
              label="Inspiration"
              items={inspiration}
              picked={picked}
              max={MAX_INSPIRATION}
              onChange={setPicked}
            />
            <div className="flex flex-col gap-3">
              <CountField
                label="Ideas"
                value={ideas.count}
                min={1}
                max={MAX_IDEAS}
                onChange={(count) => setIdeas((v) => ({ ...v, count }))}
              />
              <CreativityField group={ideas} onChange={(creativity) => setIdeas((v) => ({ ...v, creativity }))} />
            </div>
            {notesField}
          </>
        ) : (
          <>
            <Section
              icon={<RepeatIcon />}
              title="Variants"
              hint="New posters drawn after the reference, close to far."
              on={variantsOn}
              onToggle={setVariantsOn}
            >
              <CountField
                label="Variants"
                value={variants.count}
                min={1}
                max={MAX_VARIANTS}
                onChange={(count) => setVariants((v) => ({ ...v, count }))}
              />
              <CreativityField group={variants} onChange={(creativity) => setVariants((v) => ({ ...v, creativity }))} />
              <div className="grid gap-1.5 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:items-center">
                <span className="text-xs font-medium text-muted-foreground">Style</span>
                <StyleSelect value={styleId} onChange={setStyleId} />
              </div>
            </Section>

            <Separator className="bg-border/60" />

            <Section
              icon={<LightbulbIcon />}
              title="New ideas"
              hint="Same selling concept and art style, new scenes: another animal, place or prop."
              on={ideasOn}
              onToggle={setIdeasOn}
            >
              <CountField
                label="Ideas"
                value={ideas.count}
                min={1}
                max={MAX_IDEAS}
                onChange={(count) => setIdeas((v) => ({ ...v, count }))}
              />
              <CreativityField group={ideas} onChange={(creativity) => setIdeas((v) => ({ ...v, creativity }))} />
            </Section>
          </>
        )}
      </div>

      {!inspired && <PresetBar current={current} busy={busy} onRun={submit} />}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t px-4 py-3">
        <DeliveryField value={delivery} onChange={setDelivery} />
      </div>

      <DialogFooter className="m-0 flex-row items-center gap-2 rounded-b-xl border-t bg-muted/40 p-3 sm:justify-between">
        <p className="text-xs text-muted-foreground tabular-nums">
          {inspired && picked.size === 0 ? (
            "Pick at least one image"
          ) : empty ? (
            "Turn on variants or ideas"
          ) : inspired ? (
            <>
              After <span className="font-medium text-foreground">{picked.size}</span>{" "}
              {picked.size === 1 ? "image" : "images"}
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{perReference}</span> per {references.noun}
              {references.count > 1 && (
                <>
                  {" "}
                  × {references.count} = <span className="font-medium text-foreground">{total}</span> images
                </>
              )}
            </>
          )}
        </p>
        <Button type="submit" disabled={empty || busy} className="active:scale-[0.97]">
          {busy ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
          {submitLabel} {!empty && `${total} ${total === 1 ? "image" : "images"}`}
        </Button>
      </DialogFooter>
    </form>
  )
}

function Section({
  icon,
  title,
  hint,
  on,
  onToggle,
  children,
}: {
  icon: React.ReactNode
  title: string
  hint: string
  on: boolean
  onToggle: (on: boolean) => void
  children: React.ReactNode
}) {
  const id = React.useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 id={id} className="text-sm font-medium">
            {title}
          </h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Switch checked={on} onCheckedChange={onToggle} aria-label={`${title} on`} />
      </div>
      {/* Collapses without moving what's above; grid rows animate the height. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out-strong motion-reduce:transition-none",
          on ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
        inert={!on}
      >
        <div className="flex min-h-0 flex-col gap-3 overflow-hidden pl-11">{children}</div>
      </div>
    </section>
  )
}

export function CountField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = React.useState<string | null>(null)
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)))
  return (
    <div className="grid gap-1.5 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:items-center">
      <span className="text-xs font-medium text-muted-foreground">How many</span>
      <div className="flex items-center gap-3">
        <Slider
          value={[value]}
          min={min}
          max={max}
          step={1}
          onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
          aria-label={label}
          className="flex-1"
        />
        <Input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft ?? String(value)}
          onChange={(event) => {
            setDraft(event.target.value)
            const n = Number(event.target.value)
            if (event.target.value !== "" && Number.isFinite(n)) onChange(clamp(n))
          }}
          onBlur={() => setDraft(null)}
          aria-label={`${label}, number`}
          className="h-8 w-16 [appearance:textfield] text-center tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </div>
    </div>
  )
}

export function CreativityField({ group, onChange }: { group: GenerateGroup; onChange: (creativity: Creativity[]) => void }) {
  const mix = group.count > 1 && group.creativity.length > 1
  const counts = CREATIVITIES.map((level) => ({
    level,
    n: spread(group.count, group.creativity).filter((l) => l === level).length,
  })).filter((c) => c.n > 0)

  return (
    <div className="grid gap-1.5 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:items-start">
      <span className="pt-1.5 text-xs font-medium text-muted-foreground">Creativity</span>
      <div className="flex flex-col gap-1.5">
        <ToggleGroup
          multiple
          variant="outline"
          size="sm"
          spacing={0}
          value={group.creativity}
          onValueChange={(value) => {
            // Order follows the scale, and one level always stays on.
            const next = CREATIVITIES.filter((c) => (value as string[]).includes(c))
            if (next.length) onChange(next)
          }}
          aria-label="Creativity"
          className="w-full"
        >
          {CREATIVITIES.map((level) => (
            <ToggleGroupItem
              key={level}
              value={level}
              className="flex-1 gap-1 text-muted-foreground aria-pressed:bg-brand/12 aria-pressed:text-foreground dark:aria-pressed:bg-brand/20"
            >
              <CreativityMeter level={level} />
              {CREATIVITY_LABEL[level]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {mix
            ? `Mixed evenly: ${counts.map((c) => `${c.n} ${CREATIVITY_LABEL[c.level].toLowerCase()}`).join(" · ")}`
            : group.creativity.length > 1
              ? "Pick more than one image to mix levels"
              : "Select several levels to mix them evenly"}
        </p>
      </div>
    </div>
  )
}

// --- How it's painted, remembered on this device ---

/** Now or Batch, with what each means; laid out by the row around it. */
export function DeliveryField({ value, onChange }: { value: Delivery; onChange: (value: Delivery) => void }) {
  return (
    <>
      <span className="text-xs font-medium text-muted-foreground">Delivery</span>
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={0}
        value={[value]}
        onValueChange={(next) => next[0] && onChange(next[0] as Delivery)}
        aria-label="Delivery"
      >
        <ToggleGroupItem value="now">
          <ZapIcon />
          Now
        </ToggleGroupItem>
        <ToggleGroupItem value="batch">
          <ClockIcon />
          Batch
        </ToggleGroupItem>
      </ToggleGroup>
      <span className="text-xs text-pretty text-muted-foreground">
        {value === "batch"
          ? "Half the price; back in minutes to an hour or two. What fails runs again by itself."
          : "Online right away. Google draws about one a minute, so a bigger order sends the rest to a batch job."}
      </span>
    </>
  )
}

const DELIVERY_KEY = "etsy-research:generate-delivery"
const deliveryListeners = new Set<() => void>()

export function useDelivery() {
  const delivery = React.useSyncExternalStore(
    (notify) => {
      deliveryListeners.add(notify)
      return () => {
        deliveryListeners.delete(notify)
      }
    },
    (): Delivery => (localStorage.getItem(DELIVERY_KEY) === "batch" ? "batch" : "now"),
    (): Delivery => "now"
  )
  const set = React.useCallback((next: Delivery) => {
    localStorage.setItem(DELIVERY_KEY, next)
    deliveryListeners.forEach((notify) => notify())
  }, [])
  return [delivery, set] as const
}

// --- Presets: saved settings, run in one click ---

type PresetSettings = {
  variants: GenerateGroup & { on: boolean; styleId: string | null }
  ideas: GenerateGroup & { on: boolean }
  delivery: Delivery
}

type Preset = PresetSettings & { id: string; name: string }

const NO_PRESETS: Preset[] = []

// Kept in the database, every change sent as a step; presets an older
// version kept in the browser alone are folded in once.
const presetStore = createSyncedStore<Preset[], PresetOp<Preset>>({
  api: "/api/generation-presets",
  key: "etsy-research:generate-presets",
  legacyKey: "etsy-research:generate-presets",
  empty: NO_PRESETS,
  apply: applyPresetOps,
  what: "the presets",
})

function usePresets() {
  return React.useSyncExternalStore(presetStore.subscribe, presetStore.read, () => NO_PRESETS)
}

/** "5 var · 3 ideas" — what a preset makes per poster. */
function presetSummary(p: PresetSettings) {
  return [p.variants.on && `${p.variants.count} var`, p.ideas.on && `${p.ideas.count} ideas`].filter(Boolean).join(" · ")
}

function presetTitle(p: PresetSettings) {
  const levels = (g: GenerateGroup) => g.creativity.map((c) => CREATIVITY_LABEL[c]).join(", ")
  return [
    p.variants.on && `${p.variants.count} variants (${levels(p.variants)})`,
    p.ideas.on && `${p.ideas.count} new ideas (${levels(p.ideas)})`,
    p.delivery === "batch" ? "in a batch job" : "now",
  ]
    .filter(Boolean)
    .join(" · ")
}

function PresetBar({
  current,
  busy,
  onRun,
}: {
  current: PresetSettings
  busy: boolean
  onRun: (settings: PresetSettings) => void
}) {
  const presets = usePresets()
  const [naming, setNaming] = React.useState(false)
  const [name, setName] = React.useState("")
  const empty = (current.variants.on ? current.variants.count : 0) + (current.ideas.on ? current.ideas.count : 0) === 0

  function save() {
    const clean = name.trim()
    setNaming(false)
    setName("")
    if (!clean) return
    const settings = structuredClone(current)
    const preset: Preset = { ...settings, id: Math.random().toString(36).slice(2, 10), name: clean.slice(0, 32) }
    presetStore.change({ type: "add", preset })
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t px-4 py-3">
      <span className="mr-1.5 text-xs font-medium text-muted-foreground">Presets</span>
      {presets.map((preset) => (
        <span
          key={preset.id}
          className="group/preset relative flex items-center transition-transform duration-150 ease-out starting:scale-95 starting:opacity-0"
        >
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={() => onRun(preset)}
            title={`Run now: ${presetTitle(preset)}`}
            className="gap-1.5 pr-2.5 active:scale-[0.97]"
          >
            {preset.delivery === "batch" ? <ClockIcon /> : <ZapIcon />}
            <span className="font-medium">{preset.name}</span>
            <span className="text-muted-foreground tabular-nums">{presetSummary(preset)}</span>
          </Button>
          <button
            type="button"
            aria-label={`Delete preset ${preset.name}`}
            title="Delete preset"
            onClick={() => presetStore.change({ type: "remove", id: preset.id })}
            className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-xs transition-opacity duration-150 group-hover/preset:opacity-100 hover:text-foreground focus-visible:opacity-100 [&_svg]:size-2.5"
          >
            <XIcon />
          </button>
        </span>
      ))}
      {naming ? (
        <Input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              save()
            }
            if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              setNaming(false)
              setName("")
            }
          }}
          onBlur={save}
          placeholder="Name, e.g. Quick 5"
          aria-label="Preset name"
          maxLength={32}
          className="h-6 w-36 px-2 text-xs"
        />
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={empty}
          onClick={() => setNaming(true)}
          title={`Save these settings as a preset: ${presetTitle(current)}`}
          className="text-muted-foreground"
        >
          <PlusIcon />
          {presets.length ? "" : "Save as preset"}
        </Button>
      )}
    </div>
  )
}
