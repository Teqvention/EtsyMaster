"use client"

import * as React from "react"

import { formatSeconds } from "@/components/mockups/clips-panel"
import { Field, NumberField } from "@/components/mockups/properties-panel"
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
import { NEUTRAL } from "@/lib/mockups/motion"
import type { Clip, Ease, Shot } from "@/lib/mockups/types"

export type KeyPatch = { ease?: Ease; shot?: Partial<Shot> }

const EASE_ITEMS: { value: Ease; label: string }[] = [
  { value: "smooth", label: "Smooth" },
  { value: "out", label: "Ease out" },
  { value: "in", label: "Ease in" },
  { value: "linear", label: "Linear" },
]

const signed = (v: number, digits = 0, unit = " %", scale = 100) =>
  `${v > 0 ? "+" : ""}${(v * scale).toFixed(digits)}${unit}`
const percent = (v: number) => `${Math.round(v * 100)} %`

type ShotField = {
  key: keyof Shot
  label: string
  min: number
  max: number
  step: number
  format: (v: number) => string
}

const GROUPS: { label: string; fields: ShotField[] }[] = [
  {
    label: "Camera",
    fields: [
      {
        key: "frame",
        label: "Framing",
        min: 0,
        max: 1,
        step: 0.01,
        format: (v) => (v <= 0.005 ? "Room" : v >= 0.995 ? "Poster" : percent(v)),
      },
      { key: "zoom", label: "Zoom", min: 1, max: 3, step: 0.05, format: (v) => `${v.toFixed(2)}×` },
      { key: "x", label: "Pan X", min: -1, max: 1, step: 0.01, format: (v) => signed(v) },
      { key: "y", label: "Pan Y", min: -1, max: 1, step: 0.01, format: (v) => signed(v) },
      { key: "rotate", label: "Tilt", min: -5, max: 5, step: 0.1, format: (v) => signed(v, 1, "°", 1) },
    ],
  },
  {
    label: "Look",
    fields: [
      { key: "exposure", label: "Exposure", min: -1.5, max: 1, step: 0.05, format: (v) => signed(v, 2, " EV", 1) },
      { key: "warmth", label: "Warmth", min: -1, max: 1, step: 0.01, format: (v) => signed(v) },
      { key: "blur", label: "Blur", min: 0, max: 1, step: 0.01, format: percent },
      { key: "vignette", label: "Vignette", min: 0, max: 1, step: 0.01, format: percent },
    ],
  },
  {
    label: "Poster",
    fields: [
      { key: "design", label: "Design", min: 0, max: 1, step: 0.01, format: percent },
      {
        key: "glint",
        label: "Glint",
        min: -0.5,
        max: 1.5,
        step: 0.01,
        format: (v) => (v <= -0.5 || v >= 1.5 ? "Off" : percent(v)),
      },
    ],
  },
]

// Right column in Animate mode: the clip, then the selected keyframe.
export function MotionPanel({
  clip,
  keyIndex,
  onClip,
  onListing,
  onKey,
}: {
  clip: Clip | null
  keyIndex: number | null
  onClip: (patch: Partial<Clip>, merge?: string) => void
  onListing: (listing: boolean) => void
  onKey: (index: number, patch: KeyPatch, merge?: string) => void
}) {
  if (!clip) {
    return <p className="px-3 text-xs text-muted-foreground">Pick a template to start an animation.</p>
  }
  const key = keyIndex !== null ? clip.keys[keyIndex] : undefined
  const last = keyIndex === clip.keys.length - 1
  const outside = clip.duration < 5 || clip.duration > 15

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-4 p-3">
        <Field label="Name">
          <Input value={clip.name} onChange={(e) => onClip({ name: e.target.value }, `clip-name:${clip.id}`)} />
        </Field>
        <div className="flex flex-col gap-1">
          <NumberField
            label="Length (s)"
            value={clip.duration}
            step={0.5}
            onChange={(d) => onClip({ duration: Math.min(60, Math.max(1, d)) }, `clip-duration:${clip.id}`)}
          />
          {outside && <p className="text-xs text-amber-600 dark:text-amber-500">Etsy takes 5–15 s.</p>}
        </div>
        <label className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Listing video</span>
          <Switch checked={clip.listing} onCheckedChange={onListing} />
        </label>
        <ValueSlider
          label="Handheld"
          value={clip.shake}
          min={0}
          max={1}
          step={0.01}
          format={(v) => (v ? percent(v) : "Off")}
          onChange={(shake) => onClip({ shake }, `clip-shake:${clip.id}`)}
        />

        <Separator />

        {key && keyIndex !== null ? (
          <>
            <div className="flex items-baseline justify-between text-sm font-medium">
              Keyframe {keyIndex + 1} of {clip.keys.length}
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                at {formatSeconds(key.t * clip.duration)}
              </span>
            </div>
            <Field label="Into next keyframe">
              <Select
                value={key.ease}
                items={EASE_ITEMS}
                disabled={last}
                onValueChange={(ease) => ease && onKey(keyIndex, { ease: ease as Ease })}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EASE_ITEMS.map((e) => (
                    <SelectItem key={e.value} value={e.value}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {GROUPS.map((group) => (
              <section key={group.label} className="flex flex-col gap-3">
                <h3 className="text-xs font-medium">{group.label}</h3>
                {group.fields.map((f) => (
                  <ValueSlider
                    key={f.key}
                    label={f.label}
                    value={key.shot[f.key] ?? NEUTRAL[f.key]}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    format={f.format}
                    onChange={(v) => onKey(keyIndex, { shot: { [f.key]: v } }, `key:${clip.id}:${keyIndex}:${f.key}`)}
                  />
                ))}
              </section>
            ))}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Select a keyframe on the timeline.</p>
        )}
      </div>
    </ScrollArea>
  )
}

function ValueSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className="text-xs tabular-nums">{format(value)}</span>
      </div>
      <Slider
        value={Math.min(max, Math.max(min, value))}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
    </div>
  )
}
