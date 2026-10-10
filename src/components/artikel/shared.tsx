import { formatCurrency } from "@/lib/etsy/format"
import type { InternalTag, TagColor } from "@/lib/artikel/types"
import { cn } from "@/lib/utils"

// Small pieces Artikel's parts share.

export const money = (cents: number, currency = "EUR") => formatCurrency(cents, currency)

export const plural = (n: number, word: string, many = `${word}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? word : many}`

const amount = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** A price range as short as it reads: €19.90 or €19.90–59.90. */
export function priceRange(min: number, max: number, currency: string) {
  if (min === max) return money(min, currency)
  return `${money(min, currency)}–${amount.format(max / 100)}`
}

/** Marks a number that's partly worked out rather than booked. */
export function Est({ title }: { title: string }) {
  return (
    <abbr title={title} className="ml-0.5 text-[10px] text-muted-foreground no-underline">
      est.
    </abbr>
  )
}

/** Green above zero, red below: what's left over. */
export function Signed({ cents, currency, className }: { cents: number; currency: string; className?: string }) {
  return (
    <span
      className={cn(
        "tabular-nums",
        cents > 0 ? "text-emerald-600 dark:text-emerald-400" : cents < 0 ? "text-destructive" : "text-muted-foreground",
        className
      )}
    >
      {money(cents, currency)}
    </span>
  )
}

export const TAG_CLASS: Record<TagColor, { chip: string; dot: string }> = {
  gray: { chip: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
  red: { chip: "bg-red-500/12 text-red-700 dark:text-red-300", dot: "bg-red-500" },
  orange: { chip: "bg-orange-500/12 text-orange-700 dark:text-orange-300", dot: "bg-orange-500" },
  amber: { chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
  green: { chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  teal: { chip: "bg-teal-500/12 text-teal-700 dark:text-teal-300", dot: "bg-teal-500" },
  blue: { chip: "bg-blue-500/12 text-blue-700 dark:text-blue-300", dot: "bg-blue-500" },
  violet: { chip: "bg-violet-500/12 text-violet-700 dark:text-violet-300", dot: "bg-violet-500" },
  pink: { chip: "bg-pink-500/12 text-pink-700 dark:text-pink-300", dot: "bg-pink-500" },
}

export function TagChip({ tag, className }: { tag: InternalTag; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 max-w-28 items-center rounded px-1 text-[10px] leading-none font-medium",
        TAG_CLASS[tag.color].chip,
        className
      )}
    >
      <span className="truncate">{tag.name}</span>
    </span>
  )
}

export const STATE_LABEL: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  draft: "Draft",
  sold_out: "Sold out",
  expired: "Expired",
}

const STATE_DOT: Record<string, string> = {
  active: "bg-emerald-500",
  inactive: "bg-muted-foreground/50",
  draft: "border border-muted-foreground/60",
  sold_out: "bg-amber-500",
  expired: "bg-destructive",
}

export function StateLabel({ state }: { state: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[state] ?? "bg-muted-foreground/50")} aria-hidden />
      {STATE_LABEL[state] ?? state}
    </span>
  )
}

/** "Oct 9" for a day key or epoch ms. */
export function shortDate(value: string | number) {
  const date = typeof value === "number" ? new Date(value) : new Date(`${value}T12:00:00`)
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

/** "3 hours ago" for epoch ms. */
export function ago(ms: number) {
  const minutes = Math.round((ms - Date.now()) / 60_000)
  if (Math.abs(minutes) < 1) return "just now"
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute")
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return relative.format(hours, "hour")
  return relative.format(Math.round(hours / 24), "day")
}
