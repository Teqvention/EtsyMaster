"use client"

import { ChevronDownIcon, GaugeIcon, RotateCwIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"
import { useEtsyUsage } from "@/hooks/use-etsy-usage"
import type { AccountUsage } from "@/lib/accounts/usage"
import { formatNumber } from "@/lib/etsy/format"
import { cn } from "@/lib/utils"

// Etsy API quota left per account in the rolling 24-hour window, as Etsy
// reports it: the upload accounts always, the analysis accounts on demand.
// While an upload runs, each upload account's row gets a green bar of how
// much of its share is live.

// Below this share of the daily quota left, the meter turns red.
const LOW = 0.1
const SHOW_ALL_KEY = "nav-usage:all"

export function NavUsage(props: React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const { state, refresh, refreshing } = useEtsyUsage()
  const [all, setAll] = useShowAll()
  const upload = state?.accounts.filter((a) => a.role === "upload") ?? []
  const analysis = state?.accounts.filter((a) => a.role === "analysis") ?? []

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem
            // Dark --card matches --sidebar, so lift it a half step there,
            // short of the full --sidebar-accent that marks a hovered item.
            className="flex flex-col gap-2.5 rounded-lg border bg-card p-2.5 text-sm text-card-foreground shadow-xs dark:bg-muted/50"
          >
            <div className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
              <GaugeIcon />
              <span className="truncate">API quota</span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="-my-1 -mr-1 ml-auto text-muted-foreground [&_svg]:size-3"
                onClick={refresh}
                disabled={refreshing}
                aria-label="Refresh API quota"
                title="Ask Etsy now (one request per account)"
              >
                <RotateCwIcon className={cn(refreshing && "animate-spin")} />
              </Button>
            </div>

            {state === null ? (
              <Rows>
                <Placeholder />
                <Placeholder />
                <Placeholder />
              </Rows>
            ) : upload.length === 0 && analysis.length === 0 ? (
              <p className="text-xs text-muted-foreground">No accounts yet. Add them in Settings.</p>
            ) : (
              <>
                {upload.length > 0 && (
                  <Rows>
                    {upload.map((a) => (
                      <AccountRow key={a.id} account={a} />
                    ))}
                  </Rows>
                )}
                {analysis.length > 0 && (
                  <>
                    {/* Rows fold open by their own height: a grid row going from 0fr to 1fr. */}
                    <div
                      className={cn(
                        "grid transition-[grid-template-rows,opacity] duration-200 ease-out-strong motion-reduce:transition-none",
                        all || upload.length === 0 ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                      )}
                      inert={!(all || upload.length === 0)}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <Rows label="Analysis" className={cn(upload.length > 0 && "border-t pt-2.5")}>
                          {analysis.map((a) => (
                            <AccountRow key={a.id} account={a} />
                          ))}
                        </Rows>
                      </div>
                    </div>
                    {upload.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setAll(!all)}
                        aria-expanded={all}
                        className="-mx-1 -mb-1 flex items-center gap-1 self-start rounded-md px-1 py-0.5 text-[11px] text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:text-foreground"
                      >
                        {all ? "Show less" : `Show all ${upload.length + analysis.length}`}
                        <ChevronDownIcon
                          className={cn(
                            "size-3 transition-transform duration-200 ease-out-strong motion-reduce:transition-none",
                            all && "rotate-180"
                          )}
                        />
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function Rows({ label, className, children }: { label?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label && <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>}
      {children}
    </div>
  )
}

function AccountRow({ account }: { account: AccountUsage }) {
  const { usage, progress } = account
  const left = usage ? usage.remainingToday / usage.limitPerDay : 1
  const low = usage !== null && left < LOW
  const name = account.shopName ?? account.label
  const needsConnect = account.role === "upload" && !account.connected
  const blocked = usage?.blockedUntil

  return (
    <div
      className="flex flex-col gap-1"
      title={[
        name,
        usage
          ? `${formatNumber(usage.remainingToday)} of ${formatNumber(usage.limitPerDay)} requests left${usage.estimated ? " (counted since Etsy's last reading)" : ""}`
          : "No reading yet",
        blocked && `Out of quota until ${new Date(blocked).toLocaleTimeString()}`,
        needsConnect && "Not connected to Etsy yet: connect it in Settings",
      ]
        .filter(Boolean)
        .join("\n")}
    >
      <div className="flex items-center gap-1.5 text-xs">
        {needsConnect && (
          <span aria-label="Not connected" className="size-1.5 shrink-0 rounded-full bg-amber-500" />
        )}
        <span className="min-w-0 truncate">{name}</span>
        <span
          className={cn(
            "ml-auto shrink-0 tabular-nums",
            low ? "font-medium text-destructive" : "text-muted-foreground"
          )}
        >
          {usage ? formatNumber(usage.remainingToday) : "—"}
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${name}: Etsy API requests left today`}
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
      {progress && progress.target > 0 && <UploadBar name={name} progress={progress} />}
    </div>
  )
}

// The account's share of the running uploads: green, filling as listings go
// live, with a faint light sweeping over the filled part while it works. A
// test run fills it the same way but says so, since nothing goes live.
function UploadBar({ name, progress }: { name: string; progress: NonNullable<AccountUsage["progress"]> }) {
  const { done, target, failed, running, active, dryRun } = progress
  const share = Math.min(1, done / target)
  const outcome = dryRun ? "tested" : "live"
  return (
    <div className="flex flex-col gap-1 pt-0.5 animate-in fade-in-0 slide-in-from-top-1 duration-300 motion-reduce:animate-none">
      <div
        role="progressbar"
        aria-label={`${name}: uploads ${outcome}`}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={done}
        className="h-1.5 overflow-hidden rounded-full bg-emerald-500/15"
      >
        <div
          className="relative h-full overflow-hidden rounded-full bg-emerald-500 transition-[width] duration-700 ease-out-strong motion-reduce:transition-none"
          style={{ width: `${Math.max(share * 100, done > 0 ? 4 : 0)}%` }}
        >
          {active && running > 0 && (
            <span
              aria-hidden
              className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-white/45 to-transparent motion-reduce:hidden"
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
        <span>
          <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatNumber(done)}</span> of{" "}
          {formatNumber(target)} {outcome}
        </span>
        {failed > 0 && <span className="ml-auto text-destructive">{failed} failed</span>}
        {!active && failed === 0 && <span className="ml-auto">Done</span>}
      </div>
    </div>
  )
}

function Placeholder() {
  return (
    <div className="flex flex-col gap-1" aria-hidden>
      <div className="h-4 w-2/3 rounded bg-muted" />
      <div className="h-1 rounded-full bg-muted" />
    </div>
  )
}

const showAllListeners = new Set<() => void>()

function subscribeShowAll(notify: () => void) {
  showAllListeners.add(notify)
  return () => {
    showAllListeners.delete(notify)
  }
}

/** Whether the analysis accounts show too; remembered on this device. */
function useShowAll() {
  const all = React.useSyncExternalStore(
    subscribeShowAll,
    () => localStorage.getItem(SHOW_ALL_KEY) === "1",
    () => false
  )
  const setAll = React.useCallback((next: boolean) => {
    localStorage.setItem(SHOW_ALL_KEY, next ? "1" : "0")
    showAllListeners.forEach((notify) => notify())
  }, [])
  return [all, setAll] as const
}
