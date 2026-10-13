"use client"

import Image from "next/image"
import * as React from "react"
import { StoreIcon, TagIcon } from "lucide-react"

import { TagBadges, TagPicker } from "@/components/tags/tag-picker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { clearShopTags, setPrimaryTag, setSecondaryTag, tagsOf, useShopHistory, useShopTags } from "@/hooks/use-shop-history"
import type { ListingShop } from "@/lib/etsy/types"
import { describeTags } from "@/lib/tags"
import { cn } from "@/lib/utils"

// Tags file shops in two steps: primary tags say what kind of shop it is
// ("City", "Kitchen"; a shop can carry several), secondary tags under each
// tell them apart ("Cartoon", "Real", "Funky"). The picker is the shared one
// (components/tags/tag-picker.tsx), on the shops given.

/** Primary tags first, then the secondary ones under each, for the shops given. */
export function ShopTagPicker({ shops, autoFocus = true }: { shops: ListingShop[]; autoFocus?: boolean }) {
  const known = useShopTags()
  const history = useShopHistory()
  const items = shops.map((s) => tagsOf(history[s.id]))
  return (
    <TagPicker
      known={known}
      items={items}
      noun="shops"
      autoFocus={autoFocus}
      onPrimary={(primary, on) => setPrimaryTag(shops, primary, on)}
      onSecondary={(primary, secondary, on) => setSecondaryTag(shops, primary, secondary, on)}
      onClear={() => clearShopTags(shops)}
    />
  )
}

/** Centred: tags for the shops picked on the Shops page. */
export function TagDialog({
  shops,
  open,
  onOpenChange,
}: {
  shops: ListingShop[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md" showCloseButton={false}>
        <DialogHeader className="gap-3 p-4 pb-3">
          <div className="flex items-center gap-3">
            <ShopStack shops={shops} />
            <div className="min-w-0">
              <DialogTitle>Tag {shops.length === 1 ? shops[0].name : `${shops.length} shops`}</DialogTitle>
              <DialogDescription className="truncate text-xs">
                {shops.length === 1
                  ? "Primary tags, then the secondary tags under each."
                  : shops
                      .slice(0, 4)
                      .map((s) => s.name)
                      .join(", ") + (shops.length > 4 ? ` and ${shops.length - 4} more` : "")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="border-t">
          {/* Remounted per opening, so the search starts empty. */}
          {open && <ShopTagPicker shops={shops} />}
        </div>
        <DialogFooter className="m-0 rounded-b-xl border-t bg-muted/40 p-3">
          <Button size="sm" className="active:scale-[0.97]" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Up to four shop icons, overlapping.
function ShopStack({ shops }: { shops: ListingShop[] }) {
  return (
    <span className="flex shrink-0 -space-x-2.5" aria-hidden>
      {shops.slice(0, 4).map((shop) => (
        <span
          key={shop.id}
          className="relative grid size-9 place-items-center overflow-hidden rounded-lg border-2 border-background bg-muted"
        >
          {shop.iconUrl ? (
            <Image src={shop.iconUrl} alt="" fill unoptimized sizes="36px" className="object-cover" />
          ) : (
            <StoreIcon className="size-4 text-muted-foreground" />
          )}
        </span>
      ))}
    </span>
  )
}

/** In an open shop's header: its tags, and a popover to change them. */
export function ShopTagButton({ shop }: { shop: ListingShop }) {
  const tags = tagsOf(useShopHistory()[shop.id])
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="-ml-1 h-6 max-w-full min-w-0 gap-1 px-1 text-muted-foreground data-popup-open:bg-muted"
            aria-label={tags.length ? `Tags: ${describeTags(tags)}` : "Add a tag"}
          />
        }
      >
        <TagIcon />
        {tags.length ? <TagBadges tags={tags} max={3} /> : "Tag"}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-0 p-0">
        <ShopTagPicker shops={[shop]} />
      </PopoverContent>
    </Popover>
  )
}

/** In a shop's row on the Shops page: a tag icon that opens the same picker. */
export function ShopTagIconButton({ shop, className }: { shop: ListingShop; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Tag ${shop.name}`}
            className={cn("text-muted-foreground data-popup-open:bg-muted", className)}
          />
        }
      >
        <TagIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-0 p-0">
        <ShopTagPicker shops={[shop]} />
      </PopoverContent>
    </Popover>
  )
}
