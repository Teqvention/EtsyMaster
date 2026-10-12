import type { Tier } from "@/lib/citys/types"
import { cn } from "@/lib/utils"

// A place's tier as a small letter, in the brand hue fading with each step
// down; F, the one tier not worth making, in the destructive hue. The letter
// carries the meaning, the colour only supports it.

export const TIER_META: Record<Tier, { hint: string; className: string }> = {
  A: { hint: "Tier A: the strongest demand, make it first", className: "bg-brand text-white" },
  B: { hint: "Tier B: strong demand", className: "bg-brand/70 text-white" },
  C: { hint: "Tier C: solid demand", className: "bg-brand/25 text-brand dark:text-orange-300" },
  D: { hint: "Tier D: some demand", className: "bg-brand/10 text-brand dark:text-orange-300" },
  E: { hint: "Tier E: little demand so far, or too new to tell", className: "bg-muted text-muted-foreground" },
  F: { hint: "Tier F: listed for months without a sign of demand, not worth making", className: "bg-destructive/10 text-destructive" },
}

export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  const meta = TIER_META[tier]
  return (
    <span
      title={meta.hint}
      className={cn("inline-grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-bold tabular-nums", meta.className, className)}
    >
      {tier}
    </span>
  )
}
