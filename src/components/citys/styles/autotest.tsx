"use client"

import * as React from "react"
import { BotIcon, CrownIcon, LoaderCircleIcon, SquareIcon } from "lucide-react"

import { LabTile } from "@/components/citys/styles/lab-rounds"
import { Button } from "@/components/ui/button"
import type { Round } from "@/hooks/use-city-style"
import type { AutoRun, AutoTest, LabImage, RoundVerdict, TestSize } from "@/lib/citys/studio-types"
import { cn } from "@/lib/utils"

// Autonomous testing: the lab paints the style on a few places, its judge
// scores the posters against the board, the guide is rewritten two ways
// from the judge's notes, painted and judged again, and the best guide
// wins, a few passes over. Small paints two posters per guide, middle three.

export function AutoTestPanel({
  test,
  rounds,
  disabled,
  onStart,
  onStop,
  onOpen,
}: {
  test: AutoTest | undefined
  rounds: Round[]
  disabled?: boolean
  onStart: (size: TestSize, passes: number) => Promise<void>
  onStop: () => Promise<void>
  onOpen: (set: string, image: LabImage) => void
}) {
  const [size, setSize] = React.useState<TestSize>("small")
  const [passes, setPasses] = React.useState(3)
  const [busy, setBusy] = React.useState(false)
  const runningNow = test?.status === "running"
  const perGuide = size === "small" ? 2 : 3
  // The style once, then two versions a pass.
  const total = perGuide * (1 + passes * 2)

  async function go(work: () => Promise<void>) {
    setBusy(true)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-3" aria-label="Autonomous testing">
      <header className="flex flex-wrap items-center gap-2">
        <BotIcon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Autonomous testing</h3>
        <p className="text-xs text-muted-foreground">Paints, compares with the board, rewrites the guide and keeps the best, by itself.</p>
        <div className="ml-auto flex items-center gap-2">
          {!runningNow && (
            <>
              <Segmented value={size} onChange={setSize} options={[["small", "Small · 2"], ["middle", "Middle · 3"]]} label="Posters per version" />
              <Segmented value={String(passes)} onChange={(v) => setPasses(Number(v))} options={[["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]]} label="Passes" prefix="Passes" />
            </>
          )}
          {runningNow ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => go(onStop)}>
              <SquareIcon />
              Stop
            </Button>
          ) : (
            <Button size="sm" disabled={disabled || busy} onClick={() => go(() => onStart(size, passes))} className="active:scale-[0.97]" title={`About ${total} posters, painted now`}>
              {busy ? <LoaderCircleIcon className="animate-spin" /> : <BotIcon />}
              Test it · {total}
            </Button>
          )}
        </div>
      </header>

      {test && (
        <div className="flex flex-col gap-2">
          <p className={cn("flex items-center gap-2 text-xs", test.status === "error" ? "text-destructive" : "text-muted-foreground")}>
            {runningNow && <LoaderCircleIcon className="size-3.5 animate-spin" />}
            {test.status === "done" ? test.outcome : test.status === "error" ? `Stopped: ${test.error}` : test.step}
          </p>
          {test.runs.map((run) => (
            <RunRow key={run.id} run={run} best={test.best === run.id} round={rounds.find((r) => r.id === run.round)} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  )
}

function RunRow({ run, best, round, onOpen }: { run: AutoRun; best: boolean; round: Round | undefined; onOpen: (set: string, image: LabImage) => void }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-md border p-2.5", best ? "border-brand/60 bg-brand/5" : "border-border")}>
      <div className="flex flex-wrap items-center gap-2">
        {best && <CrownIcon className="size-3.5 text-brand" aria-label="Best so far" />}
        <span className="text-xs font-medium">{run.label}</span>
        {run.verdict ? <Scores verdict={run.verdict} /> : <span className="text-[11px] text-muted-foreground">{round?.status === "done" ? "Being judged…" : "Being painted…"}</span>}
      </div>
      {run.verdict?.misses.length ? (
        <p className="text-[11px] text-pretty text-muted-foreground">
          <span className="font-medium text-foreground">Still misses: </span>
          {run.verdict.misses.slice(0, 3).join(" · ")}
        </p>
      ) : null}
      {round && round.status !== "preparing" && (
        <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {round.images.map((image) => (
            <li key={image.id} className="w-28 shrink-0">
              <LabTile set={round.set} image={image} onRate={() => {}} onOpen={() => onOpen(round.set, image)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Scores({ verdict }: { verdict: RoundVerdict }) {
  const items: [string, number][] = [
    ["Style", verdict.style],
    ["Composition", verdict.composition],
    ["Place", verdict.place],
  ]
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background tabular-nums">{verdict.overall.toFixed(1)}</span>
      {items.map(([label, value]) => (
        <span key={label} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground tabular-nums">
          {label} {value.toFixed(1)}
        </span>
      ))}
    </span>
  )
}

function Segmented<T extends string>({ value, onChange, options, label, prefix }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string; prefix?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {prefix && <span className="text-[11px] text-muted-foreground">{prefix}</span>}
      <div className="flex rounded-md border p-0.5" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "h-6 rounded px-2 text-[11px] font-medium tabular-nums outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
              value === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
