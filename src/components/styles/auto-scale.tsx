"use client"

import { useRouter } from "next/navigation"
import * as React from "react"
import { LoaderCircleIcon, WandSparklesIcon } from "lucide-react"
import { toast } from "sonner"

import { CountField, CreativityField, DeliveryField, useDelivery } from "@/components/generation/generate-dialog"
import { CreativityMeter } from "@/components/generation/parts"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CREATIVITIES, CREATIVITY_LABEL, type Creativity } from "@/lib/generation/types"
import { MAX_AUTO } from "@/lib/styles/types"

// Autonomous scale: as many new posters in a style as asked for, spread over
// the creativity levels picked. The server studies the board, plans each
// poster from one of its images and paints them into the style's own set
// (see styles/auto.ts); the toast opens it.

/** What each level means here: how far the picture moves from the board, never the look or the feeling. */
const MEANING: Record<Creativity, string> = {
  minimal: "A sibling of one board poster, small details changed",
  subtle: "A board poster's scene with one real change",
  low: "Two board posters remixed into a new picture",
  medium: "A new scene from the style's world",
  high: "The boldest new idea or viewpoint",
}

export function AutoScaleDialog({
  open,
  onOpenChange,
  styleId,
  name,
  count: boardSize,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  styleId: string
  name: string
  /** Images on the board. */
  count: number
}) {
  const router = useRouter()
  const [levels, setLevels] = React.useState<Creativity[]>([...CREATIVITIES])
  const [count, setCount] = React.useState(20)
  // Percent of the posters that start from a board picture; the rest are own compositions.
  const [ref, setRef] = React.useState(60)
  const [delivery, setDelivery] = useDelivery()
  const [busy, setBusy] = React.useState(false)

  async function start(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const response = await fetch(`/api/styles/${styleId}/auto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levels, count, delivery, ref: ref / 100 }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? response.statusText)
      onOpenChange(false)
      toast.success(`Scaling ${name}: ${count} new ${count === 1 ? "poster" : "posters"}`, {
        description: "The board is studied first; the posters appear in the style's set as they're painted.",
        action: { label: "Open", onClick: () => router.push(`/generation/${body.id}`) },
      })
    } catch (error) {
      toast.error(`Couldn't start: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <form onSubmit={start}>
          <DialogHeader className="gap-1 p-4 pb-3">
            <DialogTitle>Autonomous scale</DialogTitle>
            <DialogDescription className="text-pretty">
              New posters in {name}, each a picture of its own, all in the board&apos;s look and feeling. All{" "}
              {boardSize === 1 ? "image" : `${boardSize} images`} on the board are studied first.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 border-t px-4 py-4">
            <CountField label="Posters" value={count} min={1} max={MAX_AUTO} onChange={setCount} />
            <CreativityField group={{ count, creativity: levels }} onChange={setLevels} />
            <RefField value={ref} count={count} onChange={setRef} />
            <ul className="grid gap-1 text-xs text-muted-foreground sm:pl-[6.25rem]">
              {CREATIVITIES.map((level) => (
                <li key={level} className={levels.includes(level) ? "text-foreground" : "opacity-60"}>
                  <span className="inline-flex w-[4.75rem] items-center gap-1.5 font-medium">
                    <CreativityMeter level={level} />
                    {CREATIVITY_LABEL[level]}
                  </span>
                  {MEANING[level]}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t px-4 py-3">
            <DeliveryField value={delivery} onChange={setDelivery} />
          </div>

          <DialogFooter className="m-0 flex-row items-center gap-2 rounded-b-xl border-t bg-muted/40 p-3 sm:justify-end">
            <Button type="submit" disabled={busy || !levels.length} className="active:scale-[0.97]">
              {busy ? <LoaderCircleIcon className="animate-spin" /> : <WandSparklesIcon />}
              Scale {count} {count === 1 ? "poster" : "posters"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** How many posters start from a board picture; the others are compositions of our own in the board's hand. */
function RefField({ value, count, onChange }: { value: number; count: number; onChange: (value: number) => void }) {
  // The same split the server makes (styles/auto.ts `expandAuto`).
  const own = Array.from({ length: count }, (_, i) => i).filter(
    (i) => Math.floor((i + 1) * (1 - value / 100)) > Math.floor(i * (1 - value / 100))
  ).length
  return (
    <div className="grid gap-1.5 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:items-start">
      <span className="pt-0.5 text-xs font-medium text-muted-foreground">From the board</span>
      <div className="flex flex-col gap-1.5">
        <Slider
          value={[value]}
          min={0}
          max={100}
          step={10}
          onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
          aria-label="Share of posters that start from a board picture"
        />
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {count - own} after a board picture · {own} own {own === 1 ? "composition" : "compositions"} in the
          board&apos;s hand
        </p>
      </div>
    </div>
  )
}
