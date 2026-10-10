"use client"

import * as React from "react"
import { HeartIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { toggleShopLike, useIsShopLiked } from "@/hooks/use-shop-history"
import type { ListingShop } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// A heart for a shop. Liking pops it and sends a ring and a few sparks out of
// it; taking the like back is quiet. Reduced motion keeps only the colour.

const SPARKS = [0, 60, 120, 180, 240, 300]

export function ShopLikeButton({
  shop,
  size = "icon-xs",
  className,
}: {
  shop: ListingShop
  size?: "icon-xs" | "icon-sm"
  className?: string
}) {
  const liked = useIsShopLiked(shop.id)
  // Likes made with this button: each one replays the burst, and a shop that
  // was liked before it showed up doesn't burst at all.
  const [bursts, setBursts] = React.useState(0)
  const burst = liked && bursts > 0

  function toggle() {
    if (!liked) setBursts((n) => n + 1)
    toggleShopLike(shop)
  }

  return (
    <Button
      variant="ghost"
      size={size}
      aria-pressed={liked}
      aria-label={`${liked ? "Unlike" : "Like"} ${shop.name}`}
      onClick={toggle}
      className={cn(
        "text-muted-foreground active:scale-[0.9]",
        liked && "text-like hover:text-like",
        className
      )}
    >
      <span className="relative grid place-items-center">
        <HeartIcon
          key={bursts}
          className={cn(
            "transition-[fill,color] duration-150 ease-out",
            liked && "fill-current",
            burst && "animate-like-pop motion-reduce:animate-none"
          )}
        />
        {burst && (
          <span key={bursts} aria-hidden className="pointer-events-none absolute inset-0 motion-reduce:hidden">
            <span className="absolute -inset-[70%] animate-like-ring rounded-full border-[1.5px] border-like" />
            {SPARKS.map((angle) => (
              <span
                key={angle}
                style={{ "--angle": `${angle}deg` } as React.CSSProperties}
                className="absolute top-1/2 left-1/2 -mt-[1.5px] -ml-[1.5px] size-[3px] animate-like-spark rounded-full bg-like"
              />
            ))}
          </span>
        )}
      </span>
    </Button>
  )
}
