import type { SizeKey } from "@/lib/catalog/sizes"
import { formatCurrency } from "@/lib/etsy/format"
import { cn } from "@/lib/utils"

// Small pieces the Prices page's parts share.

/** Cents as euros: €17.90. */
export const eur = (cents: number) => formatCurrency(cents, "EUR")

/** A size as short as it goes, for axes and tight columns: 13×18, A4. */
export const shortSize = (key: SizeKey) => (key.startsWith("a") ? key.toUpperCase() : key.replace("x", "×"))

/** Green above zero, red below: what a sale leaves over. */
export function Profit({ cents, className }: { cents: number; className?: string }) {
  return (
    <span
      className={cn(
        "tabular-nums",
        cents > 0 ? "text-emerald-600 dark:text-emerald-400" : cents < 0 ? "text-destructive" : "text-muted-foreground",
        className
      )}
    >
      {eur(cents)}
    </span>
  )
}

export function Panel({
  title,
  aside,
  finding,
  className,
  children,
}: {
  title: string
  aside?: React.ReactNode
  finding?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-2 rounded-lg border p-3", className)}>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h2>
        {aside}
      </div>
      {finding && <p className="text-sm leading-snug text-pretty">{finding}</p>}
      {children}
    </section>
  )
}

/** The number a finding hinges on. */
export function Em({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold tabular-nums">{children}</strong>
}
