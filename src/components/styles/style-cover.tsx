import { PaletteIcon } from "lucide-react"

import { sized } from "@/hooks/use-styles"
import type { StyleGuide } from "@/lib/styles/types"
import { cn } from "@/lib/utils"

// How a style looks at a glance: its first images as a collage, and the
// palette Gemini read from them.

/** Up to four images: one fills, two split, three lead with a tall first, four tile. */
export function StyleCover({
  covers,
  width = 320,
  className,
}: {
  covers: string[]
  /** Size to request per image, in px. */
  width?: number
  className?: string
}) {
  const shown = covers.slice(0, 4)
  if (shown.length === 0) {
    return (
      <div className={cn("grid place-items-center bg-muted text-muted-foreground", className)}>
        <PaletteIcon className="size-6" />
      </div>
    )
  }
  return (
    <div
      className={cn(
        "grid gap-px bg-border",
        shown.length > 1 && "grid-cols-2",
        shown.length > 2 && "grid-rows-2",
        className
      )}
    >
      {shown.map((url, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={url}
          src={sized(url, shown.length === 1 || (shown.length === 3 && i === 0) ? width : width / 2)}
          alt=""
          loading="lazy"
          className={cn(
            "size-full min-h-0 bg-muted object-cover",
            (shown.length === 2 || (shown.length === 3 && i === 0)) && "row-span-2"
          )}
        />
      ))}
    </div>
  )
}

/** The guide's colours as a row of dots, dominant first. */
export function Swatches({
  palette,
  max = 6,
  className,
}: {
  palette: StyleGuide["palette"]
  max?: number
  className?: string
}) {
  return (
    <span className={cn("flex items-center", className)} aria-label="Palette">
      {palette.slice(0, max).map((c, i) => (
        <span
          key={`${c.hex}-${i}`}
          title={c.role ? `${c.hex} · ${c.role}` : c.hex}
          className="-ml-1 size-3.5 rounded-full ring-2 ring-background first:ml-0"
          style={{ backgroundColor: c.hex }}
        />
      ))}
    </span>
  )
}
