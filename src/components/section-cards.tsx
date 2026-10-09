import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/etsy/format"
import type { Metric, ShopSummary } from "@/lib/etsy/types"
import { TrendingUpIcon, TrendingDownIcon } from "lucide-react"

function KpiCard({
  label,
  value,
  metric,
  footnote,
}: {
  label: string
  value: string
  metric: Metric
  footnote: string
}) {
  const up = metric.change >= 0
  const TrendIcon = up ? TrendingUpIcon : TrendingDownIcon
  const change = formatPercent(metric.change, true)

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          {value}
        </CardTitle>
        <CardAction>
          <Badge variant="outline">
            <TrendIcon />
            {change}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5 text-sm">
        <div className="line-clamp-1 flex gap-2 font-medium">
          {up ? "Up" : "Down"} {change.replace(/^[+-]/, "")} vs. prior period{" "}
          <TrendIcon className="size-4" />
        </div>
        <div className="text-muted-foreground">{footnote}</div>
      </CardFooter>
    </Card>
  )
}

export function SectionCards({
  summary,
  currency,
}: {
  summary: ShopSummary
  currency: string
}) {
  const period = `Last ${summary.periodDays} days`

  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      <KpiCard
        label="Revenue"
        value={formatCurrency(summary.revenueCents.value, currency)}
        metric={summary.revenueCents}
        footnote={`${period}, before Etsy fees`}
      />
      <KpiCard
        label="Orders"
        value={formatNumber(summary.orders.value)}
        metric={summary.orders}
        footnote={period}
      />
      <KpiCard
        label="Visits"
        value={formatNumber(summary.visits.value)}
        metric={summary.visits}
        footnote={`${period}, all traffic sources`}
      />
      <KpiCard
        label="Conversion rate"
        value={formatPercent(summary.conversionRate.value)}
        metric={summary.conversionRate}
        footnote="Orders ÷ visits"
      />
    </div>
  )
}
