"use client"

import { HeartIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { toggleLike, useIsLiked } from "@/hooks/use-likes"
import type { Listing } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

export function LikeButton({
  listing,
  variant = "overlay",
  className,
}: {
  listing: Listing
  /** `overlay` sits on a listing image; `toolbar` is a labelled button. */
  variant?: "overlay" | "toolbar"
  className?: string
}) {
  const liked = useIsLiked(listing.id)
  const label = liked ? "Unlike" : "Like"

  const icon = (
    <HeartIcon
      className={cn(
        "transition-[fill,color] duration-150 ease-out",
        liked && "fill-like text-like"
      )}
    />
  )

  if (variant === "toolbar") {
    return (
      <Button
        variant="outline"
        size="sm"
        aria-pressed={liked}
        onClick={() => toggleLike(listing)}
        className={cn("transition-transform duration-150 ease-out active:scale-[0.97]", className)}
      >
        {icon}
        {liked ? "Liked" : "Like"}
      </Button>
    )
  }

  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={`${label} ${listing.title}`}
      onClick={() => toggleLike(listing)}
      className={cn(
        "grid size-7 place-items-center rounded-full bg-background/85 text-foreground shadow-xs backdrop-blur-sm transition-[transform,opacity] duration-150 ease-out outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.94] [&_svg]:size-3.5",
        // Unliked hearts only show on hover/focus, so the grid stays quiet.
        !liked && "opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100 pointer-coarse:opacity-100",
        className
      )}
    >
      {icon}
    </button>
  )
}
