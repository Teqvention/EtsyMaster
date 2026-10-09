"use client"

import { useRouter } from "next/navigation"
import * as React from "react"
import { ChevronRightIcon, LayoutGridIcon } from "lucide-react"
import { toast } from "sonner"

import { CategoryGrid } from "@/components/steal/category-grid"
import { SortView } from "@/components/steal/sort-view"
import { steal } from "@/components/steal/steal"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { removeFromSaved, useSaved } from "@/hooks/use-saved"
import type { Listing } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// Stealing listings: first a compact list of categories, where one click
// files everything into one. Several listings can instead be sorted into
// categories by hand ("Sort into categories…"), and the dialog grows into the
// sorting view. Sorting is written when the dialog closes, however it closes.
// Mount it afresh (`key`) for each opening.

export function StealDialog({
  listings,
  open,
  onOpenChange,
  onStolen,
}: {
  /** What to steal, in the order to show it. */
  listings: Listing[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The listings filed, e.g. to drop them from a selection. */
  onStolen?: (ids: ReadonlySet<number>) => void
}) {
  const router = useRouter()
  const saved = useSaved()
  const [mode, setMode] = React.useState<"pick" | "sort">("pick")
  const search = React.useRef<HTMLInputElement>(null)
  const sorted = React.useRef(new Map<number, string>())

  const stealable = React.useMemo(() => listings.filter((l) => l.images[0]), [listings])

  // Listings saved per category (lower-cased), and where each is.
  const { counts, folderOf } = React.useMemo(() => {
    const counts = new Map<string, number>()
    const folderOf = new Map<number, string>()
    for (const s of saved ?? []) {
      counts.set(s.folder.toLowerCase(), (counts.get(s.folder.toLowerCase()) ?? 0) + 1)
      folderOf.set(s.listingId, s.folder)
    }
    return { counts, folderOf }
  }, [saved])

  const folders = new Set(stealable.map((l) => folderOf.get(l.id) ?? null))
  const current = folders.size === 1 ? [...folders][0] : null
  const single = stealable.length === 1

  function pick(folder: string) {
    onOpenChange(false)
    if (current?.toLowerCase() === folder.toLowerCase()) {
      toast(single ? `Already in ${current}` : `All already in ${current}`)
      return
    }
    onStolen?.(new Set(stealable.map((l) => l.id)))
    steal([{ folder, listings: stealable }], router.push)
  }

  /** Writes what sorting filed, once. */
  function fileSorted() {
    const assigned = sorted.current
    sorted.current = new Map()
    if (!assigned.size) return
    const groups = new Map<string, Listing[]>()
    for (const listing of stealable) {
      const folder = assigned.get(listing.id)
      if (folder) groups.set(folder, [...(groups.get(folder) ?? []), listing])
    }
    onStolen?.(new Set(assigned.keys()))
    steal([...groups].map(([folder, listings]) => ({ folder, listings })), router.push)
  }

  const fileOnUnmount = React.useEffectEvent(fileSorted)
  React.useEffect(() => () => fileOnUnmount(), [])

  function close() {
    fileSorted()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      // A stray click beside a long sort shouldn't end it.
      disablePointerDismissal={mode === "sort"}
      onOpenChange={(next) => {
        if (next) onOpenChange(true)
        else close()
      }}
    >
      <DialogContent
        showCloseButton={mode === "pick"}
        initialFocus={search}
        // The page behind has shortcuts of its own (arrows, Esc, ⌘A).
        onKeyDown={(event) => event.stopPropagation()}
        className={cn(
          // The size follows the mode (height to and from auto too, where supported).
          "flex flex-col gap-0 overflow-hidden p-0 transition-[max-width,height] duration-300 ease-out-strong [interpolate-size:allow-keywords] animation-duration-150 motion-reduce:transition-none",
          mode === "pick" ? "sm:max-w-lg" : "h-[85svh] sm:max-w-6xl"
        )}
      >
        {mode === "pick" ? (
          <div className="flex flex-col gap-4 p-5 transition-opacity duration-200 ease-out starting:opacity-0">
            <DialogHeader className="gap-1 pr-8">
              <DialogTitle className="text-base">
                {single ? "Steal listing" : `Steal ${stealable.length} listings`}
              </DialogTitle>
              <DialogDescription className="truncate">
                {single ? stealable[0].title : "Pick the category they go into on the Saved page."}
              </DialogDescription>
            </DialogHeader>

            <CategoryGrid onPick={pick} counts={counts} current={current} inputRef={search} />

            {!single && stealable.length > 0 && (
              <div className="flex flex-col gap-3 border-t pt-4">
                <button
                  type="button"
                  onClick={() => setMode("sort")}
                  className="group/sort flex items-center gap-3 rounded-lg px-1 py-1 text-left outline-none transition-[background-color,scale] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:active:scale-100 [@media(hover:hover)]:hover:bg-accent"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground">
                    <LayoutGridIcon className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium">Sort into categories…</span>
                    <span className="truncate text-xs text-muted-foreground">
                      See all {stealable.length} and file each where it belongs
                    </span>
                  </span>
                  <ChevronRightIcon className="size-4 text-muted-foreground transition-transform duration-150 ease-out [@media(hover:hover)]:group-hover/sort:translate-x-0.5" />
                </button>
              </div>
            )}

            {single && current && (
              <div className="-mt-1 flex justify-end border-t pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => {
                    onOpenChange(false)
                    const listing = stealable[0]
                    removeFromSaved([listing.id]).then(
                      () =>
                        toast(`Removed from ${current}`, {
                          action: { label: "Undo", onClick: () => steal([{ folder: current, listings: [listing] }], router.push) },
                        }),
                      (error: Error) => toast.error(`Couldn't remove: ${error.message}`)
                    )
                  }}
                >
                  Remove from {current}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <SortView
            listings={stealable}
            folderOf={folderOf}
            pendingRef={sorted}
            onBack={() => {
              setMode("pick")
              requestAnimationFrame(() => search.current?.focus())
            }}
            onDone={close}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
