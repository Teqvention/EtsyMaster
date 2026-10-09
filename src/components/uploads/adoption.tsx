"use client"

import { ArrowRightLeftIcon } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cleanTag, keptFromSource, words } from "@/lib/uploads/text"
import type { DraftView } from "@/lib/uploads/types"
import { cn } from "@/lib/utils"

// How much of the stolen listing's wording the draft carries over, and the
// two side by side: source words kept, dropped, and what's new.

/** The share the copywriter aims for, by kind of poster. */
export const ADOPTION_RANGE = { variant: [0.5, 0.85], idea: [0.3, 0.6] } as const

export function AdoptionBadge({ draft }: { draft: DraftView }) {
  if (draft.adoption === undefined || !draft.title || !draft.tags) return null
  const [low, high] = ADOPTION_RANGE[draft.design.mode]
  const off = draft.adoption < low - 0.05 || draft.adoption > high + 0.05
  const percent = Math.round(draft.adoption * 100)

  const sourceWords = new Set([...words(draft.source.title), ...draft.source.tags.flatMap(words)])
  const kept = keptFromSource(draft.source, draft.tags)
  const ownWords = new Set([...words(draft.title), ...draft.tags.flatMap(words)])
  const ownTags = new Set(draft.tags.map(cleanTag))
  const dropped = draft.source.tags.filter((t) => !ownTags.has(cleanTag(t)) && !words(t).some((w) => ownWords.has(w)))

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex h-5 items-center gap-1 rounded-4xl border px-2 text-xs font-medium tabular-nums transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:bg-muted [&_svg]:size-3",
          off ? "border-amber-500/40 text-amber-700 dark:text-amber-400" : "text-muted-foreground"
        )}
      >
        <ArrowRightLeftIcon />
        {percent} % from source
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(30rem,calc(100vw-2rem))] gap-3 p-3">
        <div className="flex flex-col gap-0.5">
          <p className="font-medium">{percent} % of the wording comes from the source</p>
          <p className="text-xs text-muted-foreground">
            The copywriter aims for {Math.round(low * 100)}–{Math.round(high * 100)} % on{" "}
            {draft.design.mode === "idea" ? "new ideas" : "variants"}: enough proven keywords to be found, enough of
            its own to not be a copy.
          </p>
        </div>

        <Section label="Source title">
          <Marked text={draft.source.title} has={(w) => ownWords.has(w)} kept="text-foreground" other="text-muted-foreground line-through decoration-muted-foreground/50" />
        </Section>
        <Section label="New title">
          <Marked text={draft.title} has={(w) => sourceWords.has(w)} kept="text-muted-foreground" other="font-medium text-brand" />
        </Section>

        <div className="grid grid-cols-2 gap-3">
          <Section label={`Kept · ${kept.size}`}>
            <Chips tags={draft.tags.filter((t) => kept.has(t))} className="bg-muted text-muted-foreground" />
          </Section>
          <Section label={`New · ${draft.tags.length - kept.size}`}>
            <Chips tags={draft.tags.filter((t) => !kept.has(t))} className="bg-brand/10 text-brand" />
          </Section>
        </div>
        {dropped.length > 0 && (
          <Section label={`Dropped from source · ${dropped.length}`}>
            <Chips tags={dropped} className="text-muted-foreground line-through decoration-muted-foreground/50 ring-1 ring-border" />
          </Section>
        )}

        {draft.reasoning && <p className="border-t pt-2.5 text-xs text-muted-foreground">{draft.reasoning}</p>}
      </PopoverContent>
    </Popover>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      {children}
    </div>
  )
}

/** `text` with each word styled by whether the other side has it. */
function Marked({ text, has, kept, other }: { text: string; has: (word: string) => boolean; kept: string; other: string }) {
  return (
    <p className="text-sm leading-relaxed">
      {text.split(/(\s+)/).map((token, i) => {
        const own = words(token)
        // Separators and small words ("|", "for", "art") take no side.
        if (!own.length) return <span key={i} className={kept}>{token}</span>
        return (
          <span key={i} className={own.every(has) ? kept : other}>
            {token}
          </span>
        )
      })}
    </p>
  )
}

function Chips({ tags, className }: { tags: string[]; className: string }) {
  if (!tags.length) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className={cn("rounded-md px-1.5 py-0.5 text-xs", className)}>
          {t}
        </span>
      ))}
    </div>
  )
}
