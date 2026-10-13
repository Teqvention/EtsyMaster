"use client"

import { LoaderCircleIcon, PlayIcon, SquareIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"
import type { GooglePause } from "@/lib/google/pause"
import { cn } from "@/lib/utils"

// The switch that stops every call to Google (Vertex, Gemini, Cloud Storage)
// on every server, always in reach above the batch jobs. Resuming asks once
// more, so a stray click doesn't send everything waiting off at once.

const POLL = 15_000
const CONFIRM_FOR = 4_000

const listeners = new Set<() => void>()
let current: GooglePause | null = null
let timer: ReturnType<typeof setInterval> | null = null

function publish(next: GooglePause) {
  current = next
  listeners.forEach((notify) => notify())
}

async function refresh() {
  try {
    const response = await fetch("/api/google/pause", { cache: "no-store" })
    if (response.ok) publish(await response.json())
  } catch {
    // Keep what's there; the next poll tries again.
  }
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  if (!timer) {
    void refresh()
    timer = setInterval(() => void refresh(), POLL)
  }
  return () => {
    listeners.delete(notify)
    if (!listeners.size && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

/** Null until loaded; re-read every few seconds while shown, as another server may switch it. */
function useGooglePause() {
  return React.useSyncExternalStore(subscribe, () => current, () => null)
}

export function NavGoogle(props: React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const state = useGooglePause()
  const [busy, setBusy] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)

  React.useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), CONFIRM_FOR)
    return () => clearTimeout(timer)
  }, [confirming])

  async function set(paused: boolean) {
    setBusy(true)
    try {
      const response = await fetch("/api/google/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? response.statusText)
      publish(result)
      toast.success(paused ? "Google paused" : "Google resumed", {
        description: paused
          ? "Nothing goes to Google on any server. Generation and batch jobs wait until you resume."
          : "Waiting generation and batch jobs go out again.",
      })
    } catch (error) {
      toast.error(`Couldn't switch: ${(error as Error).message}`)
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  if (state === null) return null
  const { paused, at } = state

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border p-2.5 text-sm shadow-xs",
              paused ? "border-destructive/30 bg-destructive/[0.06]" : "bg-card text-card-foreground dark:bg-muted/50"
            )}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", paused ? "bg-destructive" : "bg-emerald-500")}
              />
              <span className="truncate">{paused ? "Google paused" : "Google"}</span>
              {paused ? (
                <Button
                  variant={confirming ? "default" : "outline"}
                  size="xs"
                  className="-my-1 ml-auto"
                  onClick={() => (confirming ? void set(false) : setConfirming(true))}
                  disabled={busy}
                  title="Lets calls to Google go out again, on every server"
                >
                  {busy ? <LoaderCircleIcon className="animate-spin" /> : <PlayIcon />}
                  {confirming ? "Sure?" : "Resume"}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="xs"
                  className="-my-1 ml-auto"
                  onClick={() => void set(true)}
                  disabled={busy}
                  title="Stops every call to Google (Vertex, Gemini, Cloud Storage) on every server"
                >
                  {busy ? <LoaderCircleIcon className="animate-spin" /> : <SquareIcon className="fill-current" />}
                  Stop
                </Button>
              )}
            </div>
            {paused && (
              <p className="text-[11px] text-muted-foreground">
                {state.reason
                  ? state.until
                    ? "Paused by itself for a while"
                    : "Paused by itself: needs a look before resuming"
                  : "Nothing goes to Google; generation waits"}
                {at && <> · since {new Date(at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</>}
                {state.until && <> · resumes by itself at {new Date(state.until).toLocaleTimeString([], { timeStyle: "short" })}</>}
              </p>
            )}
            {paused && state.reason && (
              <p className="line-clamp-3 text-[11px] break-words text-destructive" title={state.reason}>
                {state.reason}
              </p>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
