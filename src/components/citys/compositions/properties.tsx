"use client"

import * as React from "react"
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowDownToLineIcon,
  ArrowUpToLineIcon,
  FoldVerticalIcon,
  ItalicIcon,
  UnfoldVerticalIcon,
} from "lucide-react"

import { FontPicker } from "@/components/citys/compositions/font-picker"
import { Textarea } from "@/components/ui/textarea"
import { useFontCatalog } from "@/hooks/use-fonts"
import {
  ICONS,
  PHOTO_ROLES,
  PLACEHOLDERS,
  type Color,
  type CompositionElement,
  type Hold,
  type IconName,
  type TextCase,
  type TextElement,
} from "@/lib/citys/composition/model"
import type { Palette } from "@/lib/citys/composition/render"
import { cn } from "@/lib/utils"

// The properties of what's picked on the canvas, like a design tool's:
// numbers step with ↑ and ↓ (Shift for 10), colours are a hex or one of the
// photo's own, text takes placeholders for the place. With nothing picked,
// the composition's own settings show instead.

export type ElementPatch = (patch: Partial<CompositionElement>, merge?: string) => void

export function NumberInput({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
  className,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
  className?: string
}) {
  // What's typed while the field has focus; the value itself otherwise.
  const [typed, setTyped] = React.useState<string | null>(null)
  const text = typed ?? String(round(value))
  const setText = (next: string) => setTyped(next)
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
  return (
    <label className={cn("flex h-7 min-w-0 items-center gap-1 rounded-md border bg-background px-1.5 text-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30", className)}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <input
        value={text}
        inputMode="decimal"
        onFocus={() => setTyped(String(round(value)))}
        onBlur={() => {
          const v = Number(text.replace(",", "."))
          if (Number.isFinite(v)) onChange(clamp(v))
          setTyped(null)
        }}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value.replace(",", "."))
          if (Number.isFinite(v) && e.target.value.trim() !== "") onChange(clamp(v))
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault()
            const next = clamp(round(value + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1)))
            onChange(next)
            setText(String(next))
          } else if (e.key === "Enter") (e.target as HTMLInputElement).blur()
        }}
        className="h-full w-full min-w-0 bg-transparent text-right tabular-nums outline-none"
        aria-label={label}
      />
      {suffix && <span className="shrink-0 text-muted-foreground">{suffix}</span>}
    </label>
  )
}

const round = (v: number) => Math.round(v * 100) / 100

export function ColorField({ label, value, onChange, palette }: { label: string; value: Color; onChange: (color: Color) => void; palette: Palette }) {
  const hex = value.kind === "fixed" ? value.hex : palette[value.role]
  const [text, setText] = React.useState(hex)
  const [shownHex, setShownHex] = React.useState(hex)
  if (shownHex !== hex) {
    setShownHex(hex)
    setText(hex)
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <label className="relative size-7 shrink-0 overflow-hidden rounded-md border" style={{ background: hex }}>
          <input type="color" value={hex} onChange={(e) => onChange({ kind: "fixed", hex: e.target.value.toUpperCase() })} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`${label} colour`} />
        </label>
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange({ kind: "fixed", hex: e.target.value.toUpperCase() })
          }}
          className="h-7 w-20 rounded-md border bg-background px-1.5 font-mono text-xs uppercase outline-none focus:border-ring"
          aria-label={`${label} hex`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] text-muted-foreground">From the photo</span>
        {PHOTO_ROLES.map((r) => {
          const on = value.kind === "photo" && value.role === r.value
          return (
            <button
              key={r.value}
              type="button"
              title={`${r.label}: changes with every photo`}
              aria-pressed={on}
              onClick={() => onChange(on ? { kind: "fixed", hex } : { kind: "photo", role: r.value, fallback: hex })}
              className={cn("size-5 rounded-full border-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50", on ? "border-brand" : "border-transparent")}
              style={{ background: palette[r.value] }}
            />
          )
        })}
      </div>
    </div>
  )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: React.ReactNode; title: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="flex rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-label={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("flex h-6 flex-1 items-center justify-center rounded px-1 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5", value === o.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const HOLDS: { value: Hold; label: React.ReactNode; title: string }[] = [
  { value: "start", label: <ArrowUpToLineIcon />, title: "Keeps its distance to the top" },
  { value: "center", label: <FoldVerticalIcon />, title: "Stays in the middle" },
  { value: "end", label: <ArrowDownToLineIcon />, title: "Keeps its distance to the bottom" },
  { value: "stretch", label: <UnfoldVerticalIcon />, title: "Grows with the poster (top and bottom)" },
]

export function ElementProperties({ el, onPatch, palette, sizeView }: { el: CompositionElement; onPatch: ElementPatch; palette: Palette; sizeView: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <Group title="Position">
        <div className="grid grid-cols-2 gap-1.5">
          <NumberInput label="X" value={el.x} onChange={(x) => onPatch({ x }, `x:${el.id}`)} />
          <NumberInput label="Y" value={el.y} onChange={(y) => onPatch({ y }, `y:${el.id}`)} />
          <NumberInput label="W" value={el.w} min={2} onChange={(w) => onPatch({ w }, `w:${el.id}`)} />
          <NumberInput label="H" value={el.h} min={1} onChange={(h) => onPatch({ h }, `h:${el.id}`)} />
        </div>
        {!sizeView && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">On other print sizes</span>
            <Segmented value={el.hold} options={HOLDS} onChange={(hold) => onPatch({ hold })} />
          </div>
        )}
      </Group>
      {el.type === "text" && <TextProperties el={el} onPatch={onPatch} palette={palette} sizeView={sizeView} />}
      {el.type === "rect" && !sizeView && (
        <Group title="Box">
          <ColorField label="Fill" value={el.fill} palette={palette} onChange={(fill) => onPatch({ fill })} />
          <NumberInput label="Corner radius" value={el.radius} min={0} onChange={(radius) => onPatch({ radius }, `r:${el.id}`)} />
          <NumberInput label="Opacity" value={Math.round((el.opacity ?? 1) * 100)} min={0} max={100} suffix="%" onChange={(o) => onPatch({ opacity: o / 100 }, `o:${el.id}`)} />
        </Group>
      )}
      {el.type === "line" && !sizeView && (
        <Group title="Rule">
          <ColorField label="Colour" value={el.color} palette={palette} onChange={(color) => onPatch({ color })} />
          <NumberInput label="Thickness" value={el.thickness} min={0.5} step={0.5} onChange={(thickness) => onPatch({ thickness }, `t:${el.id}`)} />
        </Group>
      )}
      {el.type === "icon" && !sizeView && (
        <Group title="Icon">
          <div className="grid grid-cols-6 gap-1">
            {ICONS.map((icon) => (
              <button
                key={icon}
                type="button"
                onClick={() => onPatch({ icon: icon as IconName })}
                aria-pressed={el.icon === icon}
                className={cn("rounded-md border px-1 py-1 text-[10px] capitalize outline-none", el.icon === icon ? "border-brand bg-brand/10" : "text-muted-foreground hover:text-foreground")}
              >
                {icon}
              </button>
            ))}
          </div>
          <ColorField label="Colour" value={el.color} palette={palette} onChange={(color) => onPatch({ color })} />
          <NumberInput label="Line" value={el.stroke} min={0.5} step={0.1} onChange={(stroke) => onPatch({ stroke }, `s:${el.id}`)} />
        </Group>
      )}
      {el.type === "photo" && !sizeView && (
        <Group title="Photo">
          <div className="grid grid-cols-2 gap-1.5">
            <NumberInput label="Focus ←→" value={Math.round(el.focusX * 100)} min={0} max={100} suffix="%" onChange={(v) => onPatch({ focusX: v / 100 }, `fx:${el.id}`)} />
            <NumberInput label="Focus ↑↓" value={Math.round(el.focusY * 100)} min={0} max={100} suffix="%" onChange={(v) => onPatch({ focusY: v / 100 }, `fy:${el.id}`)} />
          </div>
          <NumberInput label="Corner radius" value={el.radius} min={0} onChange={(radius) => onPatch({ radius }, `r:${el.id}`)} />
          <p className="text-[11px] text-muted-foreground">City photos are made in one shape; the frame crops them around the focus.</p>
        </Group>
      )}
    </div>
  )
}

function TextProperties({ el, onPatch, palette, sizeView }: { el: TextElement; onPatch: ElementPatch; palette: Palette; sizeView: boolean }) {
  const { families } = useFontCatalog()
  const family = families?.find((f) => f.family === el.font.family)
  const weights = family?.weights.length ? family.weights : [100, 200, 300, 400, 500, 600, 700, 800, 900]
  const area = React.useRef<HTMLTextAreaElement>(null)
  return (
    <Group title="Text">
      {!sizeView && (
        <>
          <Textarea ref={area} value={el.text} onChange={(e) => onPatch({ text: e.target.value }, `text:${el.id}`)} className="min-h-14 text-sm" />
          <div className="flex flex-wrap gap-1">
            {PLACEHOLDERS.map((p) => (
              <button
                key={p.token}
                type="button"
                title={`Insert ${p.label}`}
                onClick={() => {
                  const node = area.current
                  const at = node?.selectionStart ?? el.text.length
                  onPatch({ text: el.text.slice(0, at) + p.token + el.text.slice(node?.selectionEnd ?? at) })
                }}
                className="rounded border px-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
              >
                {p.token}
              </button>
            ))}
          </div>
          <FontPicker
            value={el.font.family}
            onChange={(familyName, available) => {
              const weight = available.length ? available.reduce((best, w) => (Math.abs(w - el.font.weight) < Math.abs(best - el.font.weight) ? w : best)) : el.font.weight
              onPatch({ font: { ...el.font, family: familyName, weight } })
            }}
          />
          <div className="flex items-center gap-1.5">
            <select
              value={el.font.weight}
              onChange={(e) => onPatch({ font: { ...el.font, weight: Number(e.target.value) } })}
              className="h-7 flex-1 rounded-md border bg-background px-1.5 text-xs outline-none focus:border-ring"
              aria-label="Weight"
            >
              {weights.map((w) => (
                <option key={w} value={w}>
                  {WEIGHT_NAME[w] ?? w} · {w}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-pressed={el.font.italic}
              onClick={() => onPatch({ font: { ...el.font, italic: !el.font.italic } })}
              className={cn("grid size-7 place-items-center rounded-md border", el.font.italic ? "border-brand bg-brand/10" : "text-muted-foreground")}
              aria-label="Italic"
              disabled={!!family && !family.italics.length}
            >
              <ItalicIcon className="size-3.5" />
            </button>
          </div>
        </>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <NumberInput label="Size" value={el.size} min={2} step={0.5} onChange={(size) => onPatch({ size }, `size:${el.id}`)} />
        {!sizeView && <NumberInput label="Spacing" value={el.tracking} step={5} onChange={(tracking) => onPatch({ tracking }, `tr:${el.id}`)} />}
        {!sizeView && <NumberInput label="Line" value={el.leading} min={0.6} step={0.05} onChange={(leading) => onPatch({ leading }, `ld:${el.id}`)} />}
        {!sizeView && <NumberInput label="Columns" value={el.columns} min={1} max={3} onChange={(columns) => onPatch({ columns: Math.round(columns) })} />}
      </div>
      {!sizeView && (
        <>
          <Segmented
            value={el.align}
            onChange={(align) => onPatch({ align })}
            options={[
              { value: "left", label: <AlignLeftIcon />, title: "Left" },
              { value: "center", label: <AlignCenterIcon />, title: "Centre" },
              { value: "right", label: <AlignRightIcon />, title: "Right" },
              { value: "justify", label: <AlignJustifyIcon />, title: "Justified" },
            ]}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <Segmented<TextCase>
              value={el.case}
              onChange={(c) => onPatch({ case: c })}
              options={[
                { value: "none", label: "As typed", title: "As typed" },
                { value: "upper", label: "AA", title: "Capitals" },
                { value: "title", label: "Aa", title: "Title case" },
              ]}
            />
            <Segmented
              value={el.vAlign}
              onChange={(vAlign) => onPatch({ vAlign })}
              options={[
                { value: "top", label: "Top", title: "Top of the box" },
                { value: "middle", label: "Mid", title: "Middle of the box" },
                { value: "bottom", label: "End", title: "Bottom of the box" },
              ]}
            />
          </div>
          {el.columns > 1 && <NumberInput label="Column gap" value={el.gap} min={0} onChange={(gap) => onPatch({ gap }, `gap:${el.id}`)} />}
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={el.fit === "shrink"} onChange={(e) => onPatch({ fit: e.target.checked ? "shrink" : "none" })} />
            Shrink to fit its box (long names)
          </label>
          <ColorField label="Colour" value={el.color} palette={palette} onChange={(color) => onPatch({ color })} />
        </>
      )}
    </Group>
  )
}

const WEIGHT_NAME: Record<number, string> = { 100: "Thin", 200: "Extra light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra bold", 900: "Black" }

export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h4>
      {children}
    </section>
  )
}
