"use client"

import { useSearchParams } from "next/navigation"
import * as React from "react"

import { ListingDetail } from "@/components/listings/listing-detail"
import type { Listing } from "@/lib/etsy/types"

// A page of listings that splits in two when one is opened: the grid keeps
// scrolling on the left, the open listing sits in a sticky panel on the right.
// The open listing lives in the URL (`?listing=`), so it survives reloads and
// can be shared.

type Selection = {
  selectedId: number | null
  select: (listing: Listing | null) => void
}

const SelectionContext = React.createContext<Selection>({
  selectedId: null,
  select: () => {},
})

export function useListingSelection() {
  return React.useContext(SelectionContext)
}

export function SplitView({
  listings,
  children,
}: {
  /** The grid's listings, in order, for ←/→ navigation. */
  listings: Listing[]
  children: React.ReactNode
}) {
  const searchParams = useSearchParams()
  const selectedId = Number(searchParams.get("listing")) || null

  // The listing object that was clicked, so the panel renders instantly even
  // when it came from somewhere other than `listings` (e.g. the shop's grid).
  const [picked, setPicked] = React.useState<Listing | null>(null)
  const initial =
    (picked?.id === selectedId ? picked : null) ??
    listings.find((l) => l.id === selectedId) ??
    null

  const gridRef = React.useRef<HTMLDivElement>(null)
  const panelRef = React.useRef<HTMLElement>(null)

  const select = React.useCallback((listing: Listing | null) => {
    setPicked(listing)
    const params = new URLSearchParams(window.location.search)
    if (listing) params.set("listing", String(listing.id))
    else params.delete("listing")
    const query = params.toString()
    // Replace, not push: Back should leave the page, not replay every listing
    // that was glanced at.
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
  }, [])

  React.useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 })
  }, [selectedId])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!selectedId || event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement
      if (target.closest("input, textarea, select, [contenteditable], [role=listbox], [role=menu]")) {
        return
      }

      if (event.key === "Escape") {
        select(null)
        return
      }

      const step =
        event.key === "ArrowRight" || event.key === "j" ? 1
        : event.key === "ArrowLeft" || event.key === "k" ? -1
        : 0
      const index = listings.findIndex((l) => l.id === selectedId)
      const next = step && index !== -1 ? listings[index + step] : undefined
      if (!next) return

      event.preventDefault()
      select(next)
      gridRef.current
        ?.querySelector(`[data-listing-id="${next.id}"]`)
        ?.scrollIntoView({ block: "nearest" })
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [listings, selectedId, select])

  const value = React.useMemo(() => ({ selectedId, select }), [selectedId, select])

  return (
    <SelectionContext.Provider value={value}>
      <div className="flex items-start gap-3 px-4 lg:px-6">
        <div
          ref={gridRef}
          className="min-w-0 flex-1"
          style={{ "--card-min": selectedId ? "150px" : "172px" } as React.CSSProperties}
        >
          {children}
        </div>

        {selectedId && (
          <aside
            ref={panelRef}
            aria-label="Listing details"
            // Sticky inside the shell's scroll area: its height is the viewport
            // minus the header, the inset margins (1rem) and the area's padding.
            className="sticky top-6 z-30 h-[calc(100svh-var(--header-height)-4rem)] w-[clamp(380px,46%,720px)] shrink-0 no-scrollbar overflow-y-auto overscroll-contain rounded-xl border bg-background shadow-sm transition-[opacity,transform] duration-200 ease-out-strong starting:translate-x-3 starting:opacity-0 max-md:fixed max-md:inset-0 max-md:z-50 max-md:h-auto max-md:w-auto max-md:rounded-none max-md:border-0 motion-reduce:starting:translate-x-0"
          >
            <ListingDetail
              listingId={selectedId}
              initial={initial}
              onClose={() => select(null)}
            />
          </aside>
        )}
      </div>
    </SelectionContext.Provider>
  )
}
