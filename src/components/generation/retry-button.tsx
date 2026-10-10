"use client"

import * as React from "react"
import { ChevronDownIcon, ClockIcon, LoaderCircleIcon, RotateCwIcon, ZapIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { retryGeneration } from "@/hooks/use-generations"
import type { Delivery } from "@/lib/generation/types"

// "Retry failed" for one set or many: asks whether the failed images are
// painted now or handed to a batch job (half the price, back later).

export function RetryButton({
  sets,
  count,
  label,
  size = "sm",
}: {
  /** Ids of the sets to run again. */
  sets: string[]
  /** Failed images (and steps) among them. */
  count: number
  label: string
  size?: "sm" | "xs"
}) {
  const [busy, setBusy] = React.useState(false)

  async function retry(delivery: Delivery) {
    setBusy(true)
    try {
      const results = await Promise.allSettled(sets.map((id) => retryGeneration(id, delivery)))
      const failed = results.filter((r) => r.status === "rejected").length
      if (failed) toast.error(`Couldn't retry ${failed} of ${sets.length} ${sets.length === 1 ? "set" : "sets"}`)
      else
        toast.success(`Retrying ${count} failed`, {
          description: delivery === "batch" ? "In a batch job: back in minutes to a few hours." : "Drawing now.",
        })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size={size} disabled={busy || !sets.length} />}>
        {busy ? <LoaderCircleIcon className="animate-spin" /> : <RotateCwIcon />}
        {label}
        <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Run the {count} failed again</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => retry("now")}>
            <ZapIcon />
            <span className="flex flex-col">
              Now
              <span className="text-xs text-muted-foreground">Drawn straight away, up to 20 at a time</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => retry("batch")}>
            <ClockIcon />
            <span className="flex flex-col">
              Batch
              <span className="text-xs text-muted-foreground">Half the price; minutes to a few hours</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
