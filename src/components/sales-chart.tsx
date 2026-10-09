"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatCurrency, formatDate, formatNumber } from "@/lib/etsy/format"
import type { DailyStat } from "@/lib/etsy/types"

type MetricKey = "revenueCents" | "orders" | "visits"

const metrics: Record<
  MetricKey,
  { label: string; format: (value: number, currency: string) => string }
> = {
  revenueCents: {
    label: "Revenue",
    format: (value, currency) =>
      formatCurrency(value, currency, { maximumFractionDigits: 0 }),
  },
  orders: { label: "Orders", format: (value) => formatNumber(value) },
  visits: { label: "Visits", format: (value) => formatNumber(value) },
}

const ranges = [
  { value: "90", label: "Last 3 months" },
  { value: "30", label: "Last 30 days" },
  { value: "7", label: "Last 7 days" },
]

// One series at a time: the three metrics have different units, so they are
// never plotted on shared (or dual) axes.
const chartConfig = {
  value: { label: "Value", color: "var(--chart-1)" },
} satisfies ChartConfig

export function SalesChart({
  stats,
  currency,
}: {
  stats: DailyStat[]
  currency: string
}) {
  const isMobile = useIsMobile()
  // Until the user picks a range, default to a shorter one on small screens.
  const [selectedRange, setRange] = React.useState<string | null>(null)
  const range = selectedRange ?? (isMobile ? "7" : "90")
  const [metric, setMetric] = React.useState<MetricKey>("revenueCents")

  const visible = stats.slice(-Number(range))
  const total = visible.reduce((sum, day) => sum + day[metric], 0)
  const { label, format } = metrics[metric]
  const rangeLabel = ranges.find((r) => r.value === range)?.label

  const data = visible.map((day) => ({ date: day.date, value: day[metric] }))

  return (
    <Card className="@container/card">
      {/* On narrow cards the controls drop below the title instead of squeezing it. */}
      <CardHeader className="@max-[540px]/card:grid-cols-1!">
        <CardTitle>
          {label} · {format(total, currency)}
        </CardTitle>
        <CardDescription>{rangeLabel}</CardDescription>
        <CardAction className="flex flex-wrap justify-end gap-2 @max-[540px]/card:col-start-1 @max-[540px]/card:row-span-1 @max-[540px]/card:row-start-3 @max-[540px]/card:mt-2 @max-[540px]/card:justify-self-start @max-[540px]/card:justify-start">
          <ToggleGroup
            multiple={false}
            value={[metric]}
            onValueChange={(value) => {
              if (value[0]) setMetric(value[0] as MetricKey)
            }}
            variant="outline"
            size="sm"
            aria-label="Metric"
          >
            {Object.entries(metrics).map(([key, { label }]) => (
              <ToggleGroupItem key={key} value={key} className="px-3!">
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select
            value={range}
            onValueChange={(value) => {
              if (value !== null) setRange(value)
            }}
            items={ranges}
          >
            <SelectTrigger className="w-36" size="sm" aria-label="Time range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl" align="end">
              {ranges.map((r) => (
                <SelectItem key={r.value} value={r.value} className="rounded-lg">
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[250px] w-full"
        >
          <AreaChart data={data} margin={{ left: 0, right: 8 }}>
            <defs>
              <linearGradient id="fillValue" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-value)"
                  stopOpacity={0.5}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-value)"
                  stopOpacity={0.05}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => formatDate(value)}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={56}
              tickCount={4}
              tickFormatter={(value) => format(value, currency)}
            />
            <ChartTooltip
              cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) =>
                    formatDate(value, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })
                  }
                  formatter={(value) => (
                    <div className="flex w-full items-center justify-between gap-4">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono font-medium text-foreground tabular-nums">
                        {format(Number(value), currency)}
                      </span>
                    </div>
                  )}
                  indicator="line"
                />
              }
            />
            <Area
              dataKey="value"
              type="monotone"
              fill="url(#fillValue)"
              stroke="var(--color-value)"
              strokeWidth={2}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
