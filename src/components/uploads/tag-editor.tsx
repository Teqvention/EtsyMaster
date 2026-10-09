"use client"

import * as React from "react"
import { PlusIcon, XIcon } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cleanTag } from "@/lib/uploads/text"
import { TAG_COUNT, TAG_MAX, type DraftView } from "@/lib/uploads/types"
import { cn } from "@/lib/utils"

// A draft's 13 tags as chips, each dotted by how well listings using it sell
// in the keyword library, plus an input for more and the library's strong
// keywords that fit and aren't used yet.

const STRENGTHS = [
  { min: 60, label: "Strong", dot: "bg-emerald-500" },
  { min: 25, label: "Good", dot: "bg-sky-500" },
  { min: 0, label: "Weak", dot: "bg-amber-500" },
] as const

const strengthOf = (score: number | undefined) =>
  score === undefined ? null : STRENGTHS.find((s) => score >= s.min)!

export function TagEditor({
  draft,
  disabled,
  onChange,
}: {
  draft: DraftView
  disabled?: boolean
  onChange: (tags: string[]) => void
}) {
  const tags = draft.tags ?? []
  const [value, setValue] = React.useState("")
  const [warning, setWarning] = React.useState<string | null>(null)
  const full = tags.length >= TAG_COUNT
  const typed = cleanTag(value)

  function add(raw: string) {
    const tag = cleanTag(raw)
    if (!tag) return false
    if (tag.length > TAG_MAX) return setWarning(`Etsy allows ${TAG_MAX} characters`), false
    if (tags.includes(tag)) return setWarning("Already a tag"), false
    if (full) return setWarning(`Etsy allows ${TAG_COUNT} tags — remove one first`), false
    onChange([...tags, tag])
    return true
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if ((event.key === "Enter" || event.key === ",") && value.trim()) {
      event.preventDefault()
      if (add(value)) setValue("")
    } else if (event.key === "Backspace" && !value && tags.length) {
      onChange(tags.slice(0, -1))
    }
  }

  const missing = TAG_COUNT - tags.length

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">Tags</span>
        <span className={cn("tabular-nums", missing > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
          {tags.length}/{TAG_COUNT}
        </span>
        {missing > 0 && (
          <span className="text-amber-700 dark:text-amber-400">
            {missing} unused — each tag is another search to be found in
          </span>
        )}
        <Legend />
      </div>

      <div
        className={cn(
          "flex flex-wrap items-center gap-1 rounded-lg border border-input p-1 transition-colors duration-150 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
          disabled && "pointer-events-none opacity-60"
        )}
      >
        {tags.map((tag) => {
          const strength = strengthOf(draft.strength[tag])
          return (
            <span
              key={tag}
              className="group/tag inline-flex h-6 items-center gap-1.5 rounded-md bg-muted pr-0.5 pl-2 text-xs"
            >
              <Tooltip>
                <TooltipTrigger
                  render={<span className="inline-flex items-center gap-1.5" />}
                  aria-label={`${tag}: ${strength ? `${strength.label.toLowerCase()} in the library` : "not in the library"}`}
                >
                  <span
                    aria-hidden
                    className={cn("size-1.5 shrink-0 rounded-full", strength ? strength.dot : "ring-1 ring-muted-foreground/50 ring-inset")}
                  />
                  {tag}
                </TooltipTrigger>
                <TooltipContent>
                  {strength
                    ? `${strength.label} · library score ${draft.strength[tag]}`
                    : "Not in the keyword library yet"}
                  {" · "}
                  {tag.length}/{TAG_MAX}
                </TooltipContent>
              </Tooltip>
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                disabled={disabled}
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97] [@media(hover:hover)]:hover:bg-background [@media(hover:hover)]:hover:text-foreground [&_svg]:size-3"
              >
                <XIcon />
              </button>
            </span>
          )
        })}
        <span className="relative flex min-w-36 flex-1 items-center">
          <input
            value={value}
            disabled={disabled || full}
            onChange={(event) => {
              setValue(event.target.value)
              setWarning(null)
            }}
            onKeyDown={onKeyDown}
            onBlur={() => value.trim() && add(value) && setValue("")}
            maxLength={TAG_MAX + 5}
            placeholder={full ? `${TAG_COUNT} of ${TAG_COUNT} — remove one to add` : "Add a tag…"}
            aria-label="Add a tag"
            aria-invalid={typed.length > TAG_MAX || !!warning}
            className="h-6 w-full bg-transparent px-1.5 pr-10 text-xs outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          {value && (
            <span
              className={cn(
                "pointer-events-none absolute right-1.5 text-[11px] tabular-nums",
                typed.length > TAG_MAX ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {typed.length}/{TAG_MAX}
            </span>
          )}
        </span>
      </div>
      {warning && <p className="text-xs text-destructive">{warning}</p>}

      {draft.suggestions.length > 0 && !disabled && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-0.5 text-xs text-muted-foreground">Strong in the library:</span>
          {draft.suggestions.map((s) => (
            <Tooltip key={s.keyword}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => add(s.keyword)}
                    className="inline-flex h-6 items-center gap-1 rounded-md border border-dashed px-1.5 text-xs text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out-strong outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97] motion-reduce:transition-none [@media(hover:hover)]:hover:bg-muted [@media(hover:hover)]:hover:text-foreground [&_svg]:size-3"
                  />
                }
              >
                <PlusIcon />
                {s.keyword}
              </TooltipTrigger>
              <TooltipContent>
                Score {Math.round(s.score)} · {s.shops} shop{s.shops === 1 ? "" : "s"} · {s.avgSalesPerMonth.toFixed(1)} sales/mo
                avg
                {full && " · remove a tag first"}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  )
}

function Legend() {
  return (
    <span className="ml-auto hidden items-center gap-2 text-muted-foreground sm:flex">
      {STRENGTHS.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1">
          <span aria-hidden className={cn("size-1.5 rounded-full", s.dot)} />
          {s.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="size-1.5 rounded-full ring-1 ring-muted-foreground/50 ring-inset" />
        Unknown
      </span>
    </span>
  )
}
