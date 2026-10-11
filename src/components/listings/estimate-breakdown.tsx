import { formatCompact, formatNumber, formatPercent } from "@/lib/etsy/format"
import type { Listing, SignalSource } from "@/lib/etsy/types"

// Shows the fuzzy math: what each public counter implies on its own (gray
// bars), the rate it's turned into sales with and how much it counts, and
// where the blended estimate lands (the brand-coloured rule). A log scale,
// because the signals routinely disagree by 10×. In a shop analysis the rates
// are the shop's own.

const SOURCES: Record<
  SignalSource,
  { label: string; input: (l: Listing) => string; ratio: (per: number | undefined) => string }
> = {
  reviews: {
    label: "Reviews",
    input: (l) => formatNumber(l.rank?.reviews.all ?? l.reviewCount ?? 0),
    ratio: (per) => (per ? `÷ ${formatPercent(per)} who review` : "÷ review rate"),
  },
  favorites: {
    label: "Favorites",
    input: (l) => formatNumber(l.favorites),
    ratio: (per) => (per ? `÷ ${per.toFixed(1)} per sale` : "÷ favorites per sale"),
  },
  views: {
    label: "Views",
    input: (l) => formatNumber(l.views),
    ratio: (per) => (per ? `÷ ${formatCompact(per)} per sale` : "÷ views per sale"),
  },
}

export function EstimateBreakdown({
  listing,
  reviewsPending,
}: {
  listing: Listing
  reviewsPending: boolean
}) {
  const { estimate } = listing
  const max = Math.max(estimate.sales, ...estimate.signals.map((s) => s.sales), 1)
  const position = (value: number) => (Math.log10(1 + value) / Math.log10(1 + max)) * 100
  const rows = estimate.signals.map((s) => ({ ...s, ...SOURCES[s.source] }))

  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
      {rows.map((row) => (
        <Row
          key={row.source}
          label={row.label}
          detail={`${row.input(listing)} ${row.ratio(row.per)}${row.weight === undefined ? "" : ` · counts ${Math.round(row.weight * 100)}%`}`}
        >
          <Bar value={row.sales} position={position(row.sales)} estimate={position(estimate.sales)} />
        </Row>
      ))}

      {reviewsPending && (
        <Row label="Reviews" detail="Loading…">
          <div className="h-4 animate-pulse rounded-sm bg-muted" />
        </Row>
      )}

      <div />
      <div className="relative h-4 text-[10px] text-muted-foreground">
        <span
          className="absolute top-0 -translate-x-1/2 font-medium whitespace-nowrap text-foreground"
          style={{ left: `clamp(2.5rem, ${position(estimate.sales)}%, calc(100% - 2.5rem))` }}
        >
          ≈ {formatNumber(estimate.sales)} sales
        </span>
      </div>
    </div>
  )
}

function Row({
  label,
  detail,
  children,
}: {
  label: string
  detail: string
  children: React.ReactNode
}) {
  return (
    <>
      <div className="flex flex-col leading-tight">
        <span className="font-medium">{label}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">{detail}</span>
      </div>
      {children}
    </>
  )
}

function Bar({
  value,
  position,
  estimate,
}: {
  value: number
  position: number
  estimate: number
}) {
  // Label inside the bar when there's room, otherwise just past its end.
  const inside = position > 30
  return (
    <div className="relative h-4" title={`${formatNumber(value)} sales implied`}>
      <div
        className="absolute inset-y-0 left-0 rounded-r-sm bg-muted-foreground/25"
        style={{ width: `${Math.max(position, 0.5)}%` }}
      />
      <span
        className="absolute top-1/2 -translate-y-1/2 px-1 font-medium tabular-nums"
        style={inside ? { right: `${100 - position}%` } : { left: `${position}%` }}
      >
        {formatCompact(value)}
      </span>
      <div
        className="absolute -inset-y-0.75 w-0.5 -translate-x-1/2 rounded-full bg-brand"
        style={{ left: `${estimate}%` }}
      />
    </div>
  )
}
