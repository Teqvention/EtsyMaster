"use client"

import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// A grid of generated images to pick from, with quick picks (approved, all,
// none) and a cap. Shared by "New ideas" (what to take after) and "Create
// style" (what goes on the moodboard).

/** An image to pick; approved ones are marked when some aren't. */
export type ImagePick = { id: string; src: string; title: string; approved?: boolean }

export function ImagePicker({
  label,
  items,
  picked,
  max,
  onChange,
}: {
  label: string
  items: ImagePick[]
  picked: Set<string>
  max: number
  onChange: (picked: Set<string>) => void
}) {
  const full = picked.size >= max
  const approved = items.filter((i) => i.approved)
  // Only worth marking when some aren't.
  const mark = approved.length > 0 && approved.length < items.length
  const pick = (want: ImagePick[]) => onChange(new Set(want.slice(0, max).map((i) => i.id)))
  const is = (want: ImagePick[]) =>
    picked.size === Math.min(want.length, max) && want.slice(0, max).every((i) => picked.has(i.id))
  const toggle = (id: string) => {
    const next = new Set(picked)
    if (!next.delete(id) && next.size < max) next.add(id)
    onChange(next)
  }
  // Approved only when it's a real subset; otherwise it's the same as All.
  const quick = [
    ...(mark ? [{ label: `Approved ${approved.length}`, items: approved }] : []),
    { label: "All", items },
    { label: "None", items: [] },
  ]
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {label}{" "}
          <span className="font-normal tabular-nums">
            · {picked.size} of {items.length}
            {items.length > max && `, up to ${max}`}
          </span>
        </span>
        <div className="flex items-center gap-3 text-xs">
          {quick.map((q) => {
            const current = q.items.length ? is(q.items) : picked.size === 0
            return (
              <button
                key={q.label}
                type="button"
                aria-pressed={current}
                onClick={() => pick(q.items)}
                className="text-muted-foreground tabular-nums underline-offset-4 hover:text-foreground hover:underline aria-pressed:text-foreground"
              >
                {q.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
        {items.map((item) => {
          const on = picked.has(item.id)
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => toggle(item.id)}
              title={item.title}
              className={cn(
                "group/pick relative aspect-3/4 overflow-hidden rounded-md bg-muted ring-offset-2 ring-offset-popover outline-none transition-[transform,opacity,box-shadow] duration-150 ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                on ? "ring-2 ring-brand" : "opacity-45 ring-1 ring-foreground/10 hover:opacity-80"
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.src}
                alt={item.title}
                className={cn("size-full object-cover transition-[filter] duration-150", !on && "grayscale-[60%]")}
              />
              <span
                className={cn(
                  "absolute top-1 left-1 grid size-4 place-items-center rounded-full transition-[transform,opacity] duration-150 ease-out [&_svg]:size-3",
                  on
                    ? "scale-100 bg-brand text-white opacity-100"
                    : "scale-90 bg-background/80 opacity-0 group-hover/pick:opacity-100"
                )}
              >
                <CheckIcon strokeWidth={3} />
              </span>
              {mark && item.approved && (
                <span
                  aria-label="Approved"
                  className="absolute right-1 bottom-1 size-2 rounded-full bg-emerald-500 ring-2 ring-popover"
                />
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** A few images fanned out, for a dialog's header. */
export function ThumbStack({ thumbs }: { thumbs: string[] }) {
  const shown = thumbs.slice(0, 3)
  return (
    <span className="relative flex h-11 shrink-0" style={{ width: 32 + (shown.length - 1) * 10 }} aria-hidden>
      {shown.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          className="absolute top-0 h-11 w-8 rounded-md object-cover shadow-sm ring-2 ring-popover"
          style={{
            left: i * 10,
            zIndex: shown.length - i,
            rotate: `${(i - (shown.length - 1) / 2) * 4}deg`,
          }}
        />
      ))}
    </span>
  )
}
