"use client"

import * as React from "react"
import { CheckIcon, FolderInputIcon, ImagesIcon } from "lucide-react"

import { StealDialog } from "@/components/steal/steal-dialog"
import { StealMockupsDialog } from "@/components/steal/steal-mockups-dialog"
import { Button } from "@/components/ui/button"
import { useSavedFolder } from "@/hooks/use-saved"
import type { Listing } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// The listing panel's toolbar buttons next to Like: file the listing into a
// category, and turn its photos into mockups.

const press = "transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100"

/** A dialog opened from a button, mounted afresh each time it opens. */
function useOpening() {
  const [state, setState] = React.useState({ open: false, key: 0 })
  return {
    open: state.open,
    key: state.key,
    show: () => setState((s) => ({ open: true, key: s.key + 1 })),
    setOpen: (open: boolean) => setState((s) => ({ ...s, open })),
  }
}

export function StealButton({ listing, className }: { listing: Listing; className?: string }) {
  const folder = useSavedFolder(listing.id)
  const dialog = useOpening()

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={dialog.show}
        aria-label={folder ? `Stolen into ${folder}, change` : "Steal into a category"}
        className={cn("max-w-28 min-w-0 @[30rem]/toolbar:max-w-40", press, className)}
      >
        {folder ? <CheckIcon className="text-brand" /> : <FolderInputIcon />}
        <span className="truncate">{folder ?? "Steal"}</span>
      </Button>
      {dialog.key > 0 && (
        <StealDialog key={dialog.key} listings={[listing]} open={dialog.open} onOpenChange={dialog.setOpen} />
      )}
    </>
  )
}

export function StealMockupsButton({
  listing,
  photo,
  className,
}: {
  listing: Listing
  /** The photo on screen, the dialog's default. */
  photo: number
  className?: string
}) {
  const dialog = useOpening()

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={dialog.show}
        disabled={!listing.images.length}
        className={cn(press, className)}
      >
        <ImagesIcon />
        <span className="@[28rem]/toolbar:hidden">Mockups</span>
        <span className="hidden @[28rem]/toolbar:inline">Steal mockups</span>
      </Button>
      {dialog.key > 0 && (
        <StealMockupsDialog
          key={dialog.key}
          listing={listing}
          photo={photo}
          open={dialog.open}
          onOpenChange={dialog.setOpen}
        />
      )}
    </>
  )
}
