"use client"

import { GaugeIcon, RotateCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useEtsyUsage } from "@/hooks/use-etsy-usage"
import { formatNumber } from "@/lib/etsy/format"
import { cn } from "@/lib/utils"

// Below this share of the daily quota left, the meter turns red.
const LOW = 0.1

// Etsy API quota left in the rolling 24-hour window, as reported by Etsy.
export function NavUsage(props: React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const { usage, refresh, refreshing } = useEtsyUsage()
  const left = usage ? usage.remainingToday / usage.limitPerDay : 1
  const low = usage !== null && left < LOW

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem
            // Dark --card matches --sidebar, so lift it a half step there,
            // short of the full --sidebar-accent that marks a hovered item.
            className="flex flex-col gap-2 rounded-lg border bg-card p-2.5 text-sm text-card-foreground shadow-xs dark:bg-muted/50"
            title={
              usage
                ? `${formatNumber(usage.remainingToday)} of ${formatNumber(usage.limitPerDay)} Etsy API requests left. Quota frees up gradually over a rolling 24 hours; cached results cost nothing.`
                : undefined
            }
          >
            <div className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
              <GaugeIcon />
              <span className="truncate">API quota</span>
              <span
                className={cn(
                  "ml-auto text-xs tabular-nums",
                  low ? "font-medium text-destructive" : "text-muted-foreground"
                )}
              >
                {usage ? `${formatNumber(usage.remainingToday)} left` : "—"}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="-my-1 -mr-1 text-muted-foreground [&_svg]:size-3"
                onClick={refresh}
                disabled={refreshing}
                aria-label="Refresh API quota"
                title="Ask Etsy now (uses one request)"
              >
                <RotateCwIcon className={cn(refreshing && "animate-spin")} />
              </Button>
            </div>
            <div
              role="meter"
              aria-label="Etsy API requests left today"
              aria-valuemin={0}
              aria-valuemax={usage?.limitPerDay ?? 0}
              aria-valuenow={usage?.remainingToday ?? 0}
              className="h-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300 ease-out-strong",
                  low ? "bg-destructive" : "bg-foreground/60",
                  !usage && "opacity-0"
                )}
                style={{ width: `${Math.max(left, 0) * 100}%` }}
              />
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
