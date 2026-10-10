"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon, ImageUpIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { chooseGenerationPoster, generationPosterKey, outputName, shortTitle } from "@/components/generation/parts"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { generationFileUrl, refreshGenerations, useGenerations } from "@/hooks/use-generations"
import type { GenerationSet, Output } from "@/lib/generation/types"
import { choosePoster, getPoster, resetPoster, subscribePoster } from "@/lib/mockups/poster-store"
import { cn } from "@/lib/utils"

export function usePoster() {
  return React.useSyncExternalStore(subscribePoster, getPoster, () => null)
}

/**
 * Which design the mockups show — the test poster, an upload or a generated
 * poster; shared by the list and every editor.
 */
export function PosterPicker() {
  const poster = usePoster()
  const [open, setOpen] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) refreshGenerations()
        }}
      >
        <PopoverTrigger
          render={<Button variant="outline" size="sm" className="max-w-64 min-w-0 active:scale-[0.97]" />}
        >
          <ImageUpIcon />
          <span className="truncate">{poster ? poster.name : "Loading…"}</span>
          <ChevronDownIcon className="text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 gap-0 p-0">
          <div className="flex flex-col p-1">
            <Choice
              thumb={<TestThumb />}
              checked={!!poster?.test}
              onClick={() => {
                if (!poster?.test) resetPoster()
                setOpen(false)
              }}
            >
              Test poster
            </Choice>
            <Choice
              thumb={
                <span className="grid aspect-5/7 h-6 shrink-0 place-items-center rounded-[3px] border border-dashed border-foreground/25 text-muted-foreground [&_svg]:size-3">
                  <ImageUpIcon />
                </span>
              }
              checked={!!poster && !poster.test && !poster.from}
              onClick={() => {
                input.current?.click()
                setOpen(false)
              }}
            >
              Upload an image…
            </Choice>
          </div>
          <Generated current={poster?.from} onPicked={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) choosePoster(file).catch((error) => toast.error(`Can't read ${file.name}: ${error.message}`))
          e.target.value = ""
        }}
      />
    </>
  )
}

function Choice({
  thumb,
  checked,
  onClick,
  children,
}: {
  thumb: React.ReactNode
  checked: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onClick}
      className="flex h-9 items-center gap-2.5 rounded-md px-2 text-left outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-muted focus-visible:bg-muted active:scale-[0.99]"
    >
      {thumb}
      <span className="flex-1 truncate">{children}</span>
      {checked && <CheckIcon className="size-4 text-brand" />}
    </button>
  )
}

/** The test poster in miniature: its gradient and centre disc. */
function TestThumb() {
  return (
    <span className="grid aspect-5/7 h-6 shrink-0 place-items-center rounded-[3px] bg-linear-135 from-[#2f4858] via-[#86bbd8] to-[#f6ae2d] ring-1 ring-foreground/10">
      <span className="size-2 rounded-full bg-[#f26419]" />
    </span>
  )
}

/** Generated posters by set, newest first; approved ones only, unless asked for all. */
function Generated({ current, onPicked }: { current?: string; onPicked: () => void }) {
  const sets = useGenerations()
  const [only, setOnly] = React.useState<"approved" | "all" | null>(null)
  const [picking, setPicking] = React.useState<string | null>(null)

  // Rejected ones never; approved first within a set.
  const groups = React.useMemo(
    () =>
      (sets ?? []).flatMap((set) => {
        const outputs = set.outputs
          .filter((o) => o.status === "done" && o.file && o.review !== "rejected")
          .toSorted((a, b) => Number(b.review === "approved") - Number(a.review === "approved"))
        return outputs.length ? [{ set, outputs }] : []
      }),
    [sets]
  )
  const all = groups.reduce((n, g) => n + g.outputs.length, 0)
  const approved = groups.reduce((n, g) => n + g.outputs.filter((o) => o.review === "approved").length, 0)
  // Only a choice when approved is a real subset.
  const choice = approved > 0 && approved < all
  const filter = only ?? (approved ? "approved" : "all")
  const shown =
    filter === "approved"
      ? groups.flatMap((g) => {
          const outputs = g.outputs.filter((o) => o.review === "approved")
          return outputs.length ? [{ ...g, outputs }] : []
        })
      : groups

  async function pick(set: GenerationSet, output: Output) {
    const key = generationPosterKey(set, output.file!)
    if (picking) return
    if (key === current) return onPicked()
    setPicking(key)
    try {
      await chooseGenerationPoster(set, output.file!, outputName(output))
      onPicked()
    } catch (error) {
      toast.error(`Couldn't use it: ${(error as Error).message}`)
    } finally {
      setPicking(null)
    }
  }

  return (
    <section className="flex flex-col border-t">
      <div className="flex items-baseline justify-between gap-2 px-3 pt-2.5 pb-2">
        <span className="text-xs font-medium text-muted-foreground">Generated</span>
        {choice && (
          <div className="flex items-center gap-3 text-xs">
            {(
              [
                ["approved", `Approved ${approved}`],
                ["all", `All ${all}`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setOnly(value)}
                className="text-muted-foreground tabular-nums underline-offset-4 hover:text-foreground hover:underline aria-pressed:text-foreground"
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex max-h-80 flex-col gap-3 overflow-y-auto overscroll-contain px-3 pb-3">
        {sets === null ? (
          <div className="grid grid-cols-4 gap-1.5">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-3/4 rounded-md" />
            ))}
          </div>
        ) : !shown.length ? (
          <p className="text-xs text-muted-foreground">No generated posters yet.</p>
        ) : (
          shown.map(({ set, outputs }) => (
            <div key={set.id} className="flex flex-col gap-1.5">
              <p className="truncate text-[11px] text-muted-foreground" title={set.source.title}>
                {shortTitle(set.source.title)}
              </p>
              <div className="grid grid-cols-4 gap-1.5">
                {outputs.map((output) => {
                  const key = generationPosterKey(set, output.file!)
                  const on = key === current
                  const name = outputName(output)
                  return (
                    <button
                      key={output.id}
                      type="button"
                      aria-pressed={on}
                      aria-busy={picking === key}
                      aria-label={name}
                      onClick={() => pick(set, output)}
                      title={name}
                      className={cn(
                        "relative aspect-3/4 overflow-hidden rounded-md bg-muted ring-offset-2 ring-offset-popover outline-none transition-[transform,box-shadow] duration-150 ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring",
                        on ? "ring-2 ring-brand" : "ring-1 ring-foreground/10 [@media(hover:hover)]:hover:ring-foreground/30"
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={generationFileUrl(set.id, output.file!)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover"
                      />
                      {on && (
                        <span className="absolute top-1 left-1 grid size-4 place-items-center rounded-full bg-brand text-white [&_svg]:size-3">
                          <CheckIcon strokeWidth={3} />
                        </span>
                      )}
                      {filter === "all" && choice && output.review === "approved" && (
                        <span
                          aria-label="Approved"
                          className="absolute right-1 bottom-1 size-2 rounded-full bg-emerald-500 ring-2 ring-popover"
                        />
                      )}
                      {picking === key && (
                        <span className="absolute inset-0 grid place-items-center bg-background/60">
                          <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
