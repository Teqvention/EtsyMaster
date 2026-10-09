"use client"

import * as React from "react"
import { LoaderCircleIcon, ReplaceIcon, WandSparklesIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import type { AnyLayer } from "@/lib/mockups/edit"
import {
  BLEND_MODES,
  type BlendMode,
  type ImageLayer,
  type LayerRole,
  type PosterLayer,
  type Quad,
  type Scene,
} from "@/lib/mockups/types"

const BLENDS = BLEND_MODES.map((value) => ({
  value,
  label: value.replace("-", " ").replace(/^./, (c) => c.toUpperCase()),
}))

const ROLES: { value: LayerRole | "none"; label: string }[] = [
  { value: "none", label: "—" },
  { value: "background", label: "Background" },
  { value: "light", label: "Light" },
  { value: "shine", label: "Glass reflection" },
  { value: "front", label: "In front of poster" },
  { value: "lift", label: "Paper lift" },
  { value: "overlay", label: "Overlay" },
]

const CORNERS = ["Top left", "Top right", "Bottom right", "Bottom left"]

export type Patch = (patch: Partial<AnyLayer>, merge?: string) => void

export function PropertiesPanel({
  scene,
  layer,
  stale,
  generating,
  onScene,
  onPatch,
  onReplace,
  onGenerate,
}: {
  scene: Scene
  layer: AnyLayer | null
  /** The poster's light map was made for other corners. */
  stale: boolean
  generating: boolean
  onScene: (patch: Partial<Pick<Scene, "name" | "order">>, merge?: string) => void
  onPatch: Patch
  onReplace: (file: File) => void
  onGenerate: () => void
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-4 p-3">
        {layer ? (
          <>
            <Field label="Name">
              <Input
                value={layer.name}
                onChange={(e) => onPatch({ name: e.target.value }, `name:${layer.id}`)}
              />
            </Field>
            <BlendFields layer={layer} onPatch={onPatch} />
            {layer.kind === "poster" ? (
              <PosterFields
                scene={scene}
                layer={layer}
                stale={stale}
                generating={generating}
                onPatch={onPatch}
                onGenerate={onGenerate}
              />
            ) : (
              <ImageFields layer={layer} onPatch={onPatch} onReplace={onReplace} />
            )}
          </>
        ) : (
          <>
            <Field label="Mockup name">
              <Input value={scene.name} onChange={(e) => onScene({ name: e.target.value }, "scene-name")} />
            </Field>
            <NumberField
              label="Place in listing"
              value={scene.order}
              step={1}
              onChange={(order) => onScene({ order: Math.max(1, Math.round(order)) }, "scene-order")}
            />
            <p className="text-xs text-muted-foreground">
              {scene.width} × {scene.height} px
              {scene.source && <> · from {scene.source}</>}
            </p>
            <p className="text-xs text-muted-foreground">Select a layer to edit it.</p>
          </>
        )}
      </div>
    </ScrollArea>
  )
}

function BlendFields({ layer, onPatch }: { layer: AnyLayer; onPatch: Patch }) {
  return (
    <>
      <Field label="Blend">
        <Select
          value={layer.blend}
          items={BLENDS}
          onValueChange={(value) => value && onPatch({ blend: value as BlendMode })}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BLENDS.map((b) => (
              <SelectItem key={b.value} value={b.value}>
                {b.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <PercentSlider
        label="Opacity"
        value={layer.opacity}
        onChange={(opacity) => onPatch({ opacity }, `opacity:${layer.id}`)}
      />
    </>
  )
}

function ImageFields({
  layer,
  onPatch,
  onReplace,
}: {
  layer: AnyLayer & { kind: "image" }
  onPatch: Patch
  onReplace: (file: File) => void
}) {
  const input = React.useRef<HTMLInputElement>(null)
  const placed = "x" in layer ? (layer as ImageLayer) : null
  return (
    <>
      {placed && (
        <div className="grid grid-cols-2 gap-2">
          {(["x", "y", "width", "height"] as const).map((key) => (
            <NumberField
              key={key}
              label={key === "x" ? "X" : key === "y" ? "Y" : key === "width" ? "Width" : "Height"}
              value={placed[key]}
              step={1}
              onChange={(v) => onPatch({ [key]: v }, `${key}:${layer.id}`)}
            />
          ))}
        </div>
      )}
      <Field label="Role">
        <Select
          value={layer.role ?? "none"}
          items={ROLES}
          onValueChange={(value) =>
            onPatch({ role: value === "none" ? undefined : (value as LayerRole) })
          }
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {layer.role === "front" && (
        <p className="text-xs text-muted-foreground">
          Paint with <b>Reveal</b> (B) where something stands in front of the poster,{" "}
          <b>Hide</b> (E) to take it away. Reveal copies the room as it is under the poster.
        </p>
      )}
      <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
        <ReplaceIcon /> Replace image…
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onReplace(file)
          e.target.value = ""
        }}
      />
      <p className="truncate text-xs text-muted-foreground">{layer.src}</p>
    </>
  )
}

function PosterFields({
  scene,
  layer,
  stale,
  generating,
  onPatch,
  onGenerate,
}: {
  scene: Scene
  layer: PosterLayer
  stale: boolean
  generating: boolean
  onPatch: Patch
  onGenerate: () => void
}) {
  const setCorner = (i: number, axis: 0 | 1, v: number) => {
    const quad = layer.quad.map((c, j) =>
      j === i ? (axis === 0 ? [v, c[1]] : [c[0], v]) : c
    ) as Quad
    onPatch({ quad } as Partial<PosterLayer>, `quad:${layer.id}:${i}:${axis}`)
  }
  const sources = scene.layers.filter((l): l is ImageLayer => l.kind === "image")
  const sheet = layer.sheet

  return (
    <>
      <Separator />
      <div className="flex flex-col gap-2">
        <Label className="text-xs text-muted-foreground">Corners (scene px)</Label>
        {layer.quad.map((c, i) => (
          <div key={i} className="grid grid-cols-[5.5rem_1fr_1fr] items-center gap-1.5">
            <span className="text-xs">{CORNERS[i]}</span>
            <Input
              type="number"
              step={0.25}
              className="h-7 px-1.5 text-xs tabular-nums"
              value={c[0]}
              onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setCorner(i, 0, e.target.valueAsNumber)}
            />
            <Input
              type="number"
              step={0.25}
              className="h-7 px-1.5 text-xs tabular-nums"
              value={c[1]}
              onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setCorner(i, 1, e.target.valueAsNumber)}
            />
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Drag the corners on the canvas; arrow keys nudge the last one (Shift = 2 px).
        </p>
      </div>
      <Field label="Fit">
        <Select
          value={layer.fit}
          items={[
            { value: "stretch", label: "Stretch to corners" },
            { value: "cover", label: "Crop to aspect" },
          ]}
          onValueChange={(fit) =>
            fit && onPatch({ fit, aspect: layer.aspect ?? 1.4 } as Partial<PosterLayer>)
          }
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stretch">Stretch to corners</SelectItem>
            <SelectItem value="cover">Crop to aspect</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {layer.fit === "cover" && (
        <NumberField
          label="Aspect (height ÷ width)"
          value={Math.round((layer.aspect ?? 1.4) * 10000) / 10000}
          step={0.01}
          onChange={(aspect) => aspect > 0 && onPatch({ aspect } as Partial<PosterLayer>, `aspect:${layer.id}`)}
        />
      )}
      <NumberField
        label="Overscan (%)"
        value={Math.round(layer.overscan * 1000) / 10}
        step={0.1}
        onChange={(v) => onPatch({ overscan: Math.max(0, v) / 100 } as Partial<PosterLayer>, `overscan:${layer.id}`)}
      />
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`tone-${layer.id}`}>Paper tone</Label>
        <Switch
          id={`tone-${layer.id}`}
          checked={layer.tone}
          onCheckedChange={(tone) => onPatch({ tone } as Partial<PosterLayer>)}
        />
      </div>

      <Separator />
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`sheet-${layer.id}`}>Light from empty sheet</Label>
        <Switch
          id={`sheet-${layer.id}`}
          checked={!!sheet}
          onCheckedChange={(on) =>
            onPatch({
              sheet: on
                ? { source: sources.find((s) => s.role === "background")?.id ?? sources[0]?.id ?? "", shine: 0.45, flat: 0.7 }
                : undefined,
            } as Partial<PosterLayer>)
          }
        />
      </div>
      {sheet ? (
        <>
          <p className="text-xs text-muted-foreground">
            For rooms with a blank white sheet in the frame: its light and glass reflection
            become layers on the poster.
          </p>
          <Field label="Sheet is in">
            <Select
              value={sheet.source}
              items={sources.map((s) => ({ value: s.id, label: s.name }))}
              onValueChange={(source) =>
                source && onPatch({ sheet: { ...sheet, source } } as Partial<PosterLayer>)
              }
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <PercentSlider
            label="Flatten light gradient"
            value={sheet.flat}
            onChange={(flat) => onPatch({ sheet: { ...sheet, flat } } as Partial<PosterLayer>, `flat:${layer.id}`)}
          />
          <PercentSlider
            label="Glass reflection"
            value={sheet.shine}
            onChange={(shine) =>
              onPatch(
                {
                  sheet: { ...sheet, shine },
                  children: layer.children.map((c) => (c.role === "shine" ? { ...c, opacity: shine } : c)),
                } as Partial<PosterLayer>,
                `shine:${layer.id}`
              )
            }
          />
          <Button onClick={onGenerate} disabled={generating || !sheet.source}>
            {generating ? <LoaderCircleIcon className="animate-spin" /> : <WandSparklesIcon />}
            {layer.children.some((c) => c.role === "light") ? "Regenerate light & shine" : "Generate light & shine"}
          </Button>
          {stale && !generating && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Corners or flattening changed since the light was made. Regenerate to match.
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Off for bought PSD templates, whose light and glare are their own layers.
        </p>
      )}
    </>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

export function NumberField({
  label,
  value,
  step,
  onChange,
}: {
  label: string
  value: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        step={step}
        className="h-7 text-xs tabular-nums"
        value={value}
        onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)}
      />
    </Field>
  )
}

/** 0..1 as a percent slider; fine steps below 10 % for faint layers like grain. */
function PercentSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  const p = value * 100
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className="text-xs tabular-nums">{p < 10 ? p.toFixed(1) : Math.round(p)} %</span>
      </div>
      <Slider
        value={p}
        min={0}
        max={100}
        step={0.1}
        onValueChange={(v) => onChange((Array.isArray(v) ? v[0] : v) / 100)}
      />
    </div>
  )
}
