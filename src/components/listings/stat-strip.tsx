import { cn } from "@/lib/utils"

// A single row of headline numbers, divided rather than boxed, so it reads as
// one instrument panel instead of a row of cards.
export function StatStrip({
  stats,
  className,
}: {
  stats: { label: string; value: React.ReactNode; hint?: string }[]
  className?: string
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-px overflow-hidden rounded-lg border bg-border",
        className
      )}
    >
      {stats.map((stat) => (
        <div key={stat.label} className="flex min-w-0 flex-col gap-0.5 bg-card px-3 py-2" title={stat.hint}>
          <dt className="truncate text-[11px] text-muted-foreground">{stat.label}</dt>
          <dd className="truncate text-lg font-semibold">{stat.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
