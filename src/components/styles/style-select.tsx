"use client"

import Link from "next/link"
import * as React from "react"
import { LoaderCircleIcon, Settings2Icon } from "lucide-react"

import { Thumb } from "@/components/styles/add-to-style"
import { Swatches } from "@/components/styles/style-cover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { refreshStyles, useStyles } from "@/hooks/use-styles"
import type { StyleSummary } from "@/lib/styles/types"

// Picks the style posters are generated in. Only styles with a guide can be
// picked; the rest are listed, dimmed, with why — so a style that's still
// being read shows up and becomes pickable once it's done.

const NONE = "none"

export function StyleSelect({
  value,
  onChange,
}: {
  value: string | null
  onChange: (id: string | null) => void
}) {
  const styles = useStyles()
  const byId = React.useMemo(() => new Map((styles ?? []).map((s) => [s.id, s])), [styles])
  const current = value ? byId.get(value) : undefined

  return (
    <Select
      value={value ?? NONE}
      onValueChange={(next) => onChange(!next || next === NONE ? null : (next as string))}
      onOpenChange={(open) => open && refreshStyles()}
    >
      <SelectTrigger className="w-full min-w-0" aria-label="Style">
        <SelectValue>
          {() =>
            current ? (
              <>
                <Thumb url={current.covers[0]} className="size-5" />
                <span className="truncate">{current.name}</span>
              </>
            ) : value && styles === null ? (
              <span className="text-muted-foreground">Loading…</span>
            ) : (
              <span className="text-muted-foreground">No style</span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-64" alignItemWithTrigger={false} align="start">
        <SelectItem value={NONE}>
          <span className="grid size-6 shrink-0 place-items-center rounded-sm border border-dashed" />
          <span className="text-muted-foreground">No style</span>
        </SelectItem>
        {styles === null ? (
          <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
            <LoaderCircleIcon className="size-3.5 animate-spin" />
            Loading styles…
          </p>
        ) : (
          styles.map((style) => <StyleItem key={style.id} style={style} />)
        )}
        <SelectSeparator />
        <Link
          href="/styles"
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent [&>svg]:size-4"
        >
          <Settings2Icon />
          Manage styles
        </Link>
      </SelectContent>
    </Select>
  )
}

function StyleItem({ style }: { style: StyleSummary }) {
  const hint =
    style.guideStatus === "running"
      ? "Reading…"
      : style.count === 0
        ? "No images"
        : style.guideStatus === "error" && !style.guide
          ? "Couldn't read"
          : "Not read yet"
  return (
    <SelectItem value={style.id} disabled={!style.guide}>
      <Thumb url={style.covers[0]} />
      <span className="min-w-0 truncate">{style.name}</span>
      <span className="ml-auto flex items-center pl-3 text-xs text-muted-foreground">
        {style.guide ? <Swatches palette={style.guide.palette} max={4} /> : hint}
      </span>
    </SelectItem>
  )
}
