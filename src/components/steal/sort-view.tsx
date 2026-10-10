"use client"

import Image from "next/image"
import * as React from "react"
import { ArrowLeftIcon, CircleCheckIcon, FolderIcon, PlusIcon, Undo2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { Progress } from "@/components/ui/progress"
import { createCategory, useCategories } from "@/hooks/use-categories"
import { formatRate } from "@/lib/etsy/format"
import type { Listing } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// Sorting a pick of listings into categories, one category at a time: choose
// one on the left (or press its number), then click listings to file them
// there. Filed listings fly to their category and leave the grid, so what's
// left keeps shrinking. Shift-click files a run, dragging lassoes several,
// ⌘Z steps back. Nothing is written here: the dialog writes `pendingRef` when
// it closes, however it closes.

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)"
const FLIGHT = "cubic-bezier(0.55, 0, 0.2, 1)"
/** Pointer travel (px) before a press becomes a lasso. */
const DRAG = 6
/** Lassoing this close (px) to the top or bottom edge scrolls. */
const EDGE = 56
/** At most this many tiles fly at once; the rest just leave. */
const MAX_FLIGHTS = 40

type Sorting = {
  /** Listing → category. */
  assigned: ReadonlyMap<number, string>
  /** Each step's listings, for ⌘Z. */
  history: number[][]
}

type Box = { left: number; top: number; width: number; height: number }

const NONE: ReadonlySet<number> = new Set()
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
const sameSet = (a: ReadonlySet<number>, b: ReadonlySet<number>) =>
  a.size === b.size && [...a].every((id) => b.has(id))

export function SortView({
  listings,
  folderOf,
  pendingRef,
  onBack,
  onDone,
}: {
  /** In the order to show them. */
  listings: Listing[]
  /** Where listings are saved already. */
  folderOf: ReadonlyMap<number, string>
  /** Kept current with every step, for the dialog to write. */
  pendingRef: React.RefObject<Map<number, string>>
  onBack: () => void
  onDone: () => void
}) {
  const categories = useCategories("saved")
  // Numbers stay put while sorting: categories made meanwhile go to the end.
  const [order] = React.useState(() => categories.map((c) => c.name))
  const rail = React.useMemo(() => {
    const names = new Map(categories.map((c) => [c.name.toLowerCase(), c.name]))
    const first = order.filter((name) => names.has(name.toLowerCase()))
    const known = new Set(first.map((name) => name.toLowerCase()))
    return [...first, ...categories.map((c) => c.name).filter((name) => !known.has(name.toLowerCase()))]
  }, [categories, order])

  const [chosen, setChosen] = React.useState<string | null>(null)
  const active = chosen && rail.includes(chosen) ? chosen : (rail[0] ?? null)

  const [sorting, setSorting] = React.useState<Sorting>({ assigned: new Map(), history: [] })
  const remaining = React.useMemo(
    () => listings.filter((l) => !sorting.assigned.has(l.id)),
    [listings, sorting.assigned]
  )
  const tally = React.useMemo(() => {
    const tally = new Map<string, number>()
    for (const folder of sorting.assigned.values()) tally.set(folder, (tally.get(folder) ?? 0) + 1)
    return tally
  }, [sorting.assigned])

  const scroller = React.useRef<HTMLDivElement>(null)
  const grid = React.useRef<HTMLOListElement>(null)
  const railList = React.useRef<HTMLDivElement>(null)
  const newCategory = React.useRef<HTMLInputElement>(null)

  // Shift-click runs from the last listing clicked; holding Shift previews it.
  const [anchor, setAnchor] = React.useState<number | null>(null)
  const [preview, setPreview] = React.useState<number | null>(null)
  const [shift, setShift] = React.useState(false)

  const [box, setBox] = React.useState<Box | null>(null)
  const [lassoed, setLassoed] = React.useState<ReadonlySet<number>>(NONE)
  const drag = React.useRef<{
    x: number
    y: number
    clientX: number
    clientY: number
    pointerId: number
    lasso: boolean
    tiles: { id: number; left: number; top: number; right: number; bottom: number }[]
    hit: ReadonlySet<number>
    frame: number
  } | null>(null)

  // For the move animation: where tiles were before a step, and which tile
  // had keyboard focus (focus moves on to the one taking its place).
  const before = React.useRef<Map<number, DOMRect> | null>(null)
  const refocus = React.useRef<number | null>(null)

  const run = React.useMemo(() => {
    if (!shift || anchor === null || preview === null) return NONE
    return new Set(between(listings, anchor, preview).filter((id) => !sorting.assigned.has(id)))
  }, [shift, anchor, preview, listings, sorting.assigned])

  const left = remaining.length
  const done = listings.length - left

  React.useEffect(() => {
    scroller.current?.focus({ preventScroll: true })
  }, [])

  // Closing the tab mid-sort would lose it: ask first.
  const dirty = sorting.history.length > 0
  React.useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  // Tiles slide from where they were into their new places.
  React.useLayoutEffect(() => {
    const rects = before.current
    before.current = null
    const tiles = grid.current?.querySelectorAll<HTMLElement>("[data-sort-id]") ?? []
    if (rects) {
      for (const tile of tiles) {
        const old = rects.get(Number(tile.dataset.sortId))
        if (!old) continue
        const now = tile.getBoundingClientRect()
        const dx = old.left - now.left
        const dy = old.top - now.top
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
        tile.getAnimations().forEach((a) => a.cancel())
        // Wrapping to another row would sweep across the grid: appear in place instead.
        const wraps = Math.abs(dy) >= 1 && Math.abs(dx) > now.width * 1.5
        tile.animate(
          wraps
            ? [{ opacity: 0, scale: "0.9" }, { opacity: 1, scale: "1" }]
            : [{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }],
          { duration: wraps ? 200 : 260, easing: EASE }
        )
      }
    }
    if (refocus.current !== null) {
      const index = Math.min(refocus.current, tiles.length - 1)
      refocus.current = null
      const next = index >= 0 ? tiles[index]?.querySelector("button") : null
      ;(next ?? scroller.current)?.focus({ preventScroll: index < 0 })
    }
  }, [sorting])

  function update(next: Sorting) {
    pendingRef.current = new Map(next.assigned)
    setSorting(next)
  }

  /** Where the visible tiles are now, to animate from. */
  function measure() {
    if (!grid.current || !scroller.current || reducedMotion()) return
    const view = scroller.current.getBoundingClientRect()
    const rects = new Map<number, DOMRect>()
    for (const tile of grid.current.querySelectorAll<HTMLElement>("[data-sort-id]")) {
      const rect = tile.getBoundingClientRect()
      if (rect.bottom < view.top - rect.height * 2 || rect.top > view.bottom + rect.height * 2) continue
      rects.set(Number(tile.dataset.sortId), rect)
    }
    before.current = rects
  }

  function assign(ids: number[], into = active) {
    if (!into) {
      newCategory.current?.focus()
      return
    }
    const fresh = ids.filter((id) => !sorting.assigned.has(id))
    if (!fresh.length) return
    const focused = document.activeElement?.closest<HTMLElement>("[data-sort-id]")
    if (focused && fresh.includes(Number(focused.dataset.sortId))) {
      refocus.current = remaining.findIndex((l) => l.id === Number(focused.dataset.sortId))
    }
    measure()
    fly(fresh, into)
    const assigned = new Map(sorting.assigned)
    for (const id of fresh) assigned.set(id, into)
    update({ assigned, history: [...sorting.history, fresh] })
  }

  function undo() {
    const last = sorting.history.at(-1)
    if (!last) return
    measure()
    const assigned = new Map(sorting.assigned)
    for (const id of last) assigned.delete(id)
    update({ assigned, history: sorting.history.slice(0, -1) })
  }

  /** Copies of the leaving tiles fly into their category on the left. */
  function fly(ids: number[], into: string) {
    if (!grid.current || !scroller.current || reducedMotion()) return
    const target = railList.current
      ?.querySelector(`[data-category="${CSS.escape(into)}"]`)
      ?.getBoundingClientRect()
    const view = scroller.current.getBoundingClientRect()
    let flights = 0
    for (const id of ids) {
      const tile = grid.current.querySelector<HTMLElement>(`[data-sort-id="${id}"]`)
      const image = tile?.querySelector("img")
      if (!tile || !image?.complete) continue
      const from = tile.getBoundingClientRect()
      if (from.bottom < view.top || from.top > view.bottom) continue
      if (++flights > MAX_FLIGHTS) break
      const ghost = document.createElement("img")
      ghost.src = image.currentSrc || image.src
      ghost.alt = ""
      Object.assign(ghost.style, {
        position: "fixed",
        left: `${from.left}px`,
        top: `${from.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
        objectFit: "cover",
        borderRadius: "8px",
        boxShadow: "0 8px 24px rgb(0 0 0 / 0.18)",
        pointerEvents: "none",
        zIndex: "60",
      })
      document.body.append(ghost)
      const end = target
        ? `translate(${target.left + 24 - (from.left + from.width / 2)}px, ${target.top + target.height / 2 - (from.top + from.height / 2)}px) scale(${20 / from.width})`
        : "scale(0.6)"
      const flight = ghost.animate(
        [
          { transform: "none", opacity: 1 },
          { opacity: 1, offset: 0.7 },
          { transform: end, opacity: 0 },
        ],
        { duration: target ? 420 : 200, easing: target ? FLIGHT : EASE }
      )
      flight.finished.finally(() => ghost.remove())
    }
  }

  function tileAt(target: EventTarget) {
    const tile = (target as HTMLElement).closest<HTMLElement>("[data-sort-id]")
    return tile ? Number(tile.dataset.sortId) : null
  }

  function onClick(event: React.MouseEvent) {
    const id = tileAt(event.target)
    if (id === null) return
    if (event.shiftKey && anchor !== null) {
      assign(between(listings, anchor, id))
    } else {
      assign([id])
    }
    setAnchor(id)
  }

  // Lasso: press anywhere in the grid and drag. Presses don't move focus, so
  // the shortcuts keep working however the grid changes.
  function onPointerDown(event: React.PointerEvent<HTMLOListElement>) {
    if (event.button !== 0 || event.pointerType === "touch") return
    event.preventDefault()
    const origin = event.currentTarget.getBoundingClientRect()
    drag.current = {
      x: event.clientX - origin.left,
      y: event.clientY - origin.top,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      lasso: false,
      tiles: [],
      hit: NONE,
      frame: 0,
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLOListElement>) {
    if (event.shiftKey !== shift) setShift(event.shiftKey)
    if (event.shiftKey) setPreview(tileAt(event.target))
    const d = drag.current
    if (!d) return
    d.clientX = event.clientX
    d.clientY = event.clientY
    if (!d.lasso) {
      const origin = event.currentTarget.getBoundingClientRect()
      if (Math.hypot(event.clientX - origin.left - d.x, event.clientY - origin.top - d.y) < DRAG) return
      d.lasso = true
      event.currentTarget.setPointerCapture(d.pointerId)
      d.tiles = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-sort-id]")].map((tile) => ({
        id: Number(tile.dataset.sortId),
        left: tile.offsetLeft,
        top: tile.offsetTop,
        right: tile.offsetLeft + tile.offsetWidth,
        bottom: tile.offsetTop + tile.offsetHeight,
      }))
      const scroll = () => {
        const view = scroller.current?.getBoundingClientRect()
        if (!drag.current?.lasso || !view || !scroller.current) return
        const y = drag.current.clientY
        const speed =
          y < view.top + EDGE ? -(view.top + EDGE - y) / 3 : y > view.bottom - EDGE ? (y - view.bottom + EDGE) / 3 : 0
        if (speed) {
          scroller.current.scrollTop += speed
          lasso()
        }
        drag.current.frame = requestAnimationFrame(scroll)
      }
      d.frame = requestAnimationFrame(scroll)
    }
    lasso()
  }

  function lasso() {
    const d = drag.current
    const origin = grid.current?.getBoundingClientRect()
    if (!d?.lasso || !origin) return
    const x = d.clientX - origin.left
    const y = d.clientY - origin.top
    const next: Box = {
      left: Math.min(d.x, x),
      top: Math.min(d.y, y),
      width: Math.abs(x - d.x),
      height: Math.abs(y - d.y),
    }
    setBox(next)
    const hit = new Set(
      d.tiles
        .filter(
          (t) =>
            t.left < next.left + next.width &&
            t.right > next.left &&
            t.top < next.top + next.height &&
            t.bottom > next.top
        )
        .map((t) => t.id)
    )
    if (sameSet(d.hit, hit)) return
    d.hit = hit
    setLassoed(hit)
  }

  function onPointerUp() {
    const d = drag.current
    drag.current = null
    if (!d?.lasso) return
    cancelAnimationFrame(d.frame)
    setBox(null)
    setLassoed(NONE)
    if (d.hit.size) assign(remaining.filter((l) => d.hit.has(l.id)).map((l) => l.id))
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Shift") setShift(true)
    const typing = (event.target as HTMLElement).closest("input, textarea, [contenteditable]")
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.key === "Enter") {
      event.preventDefault()
      onDone()
    } else if (typing || event.altKey) {
      return
    } else if (mod && !event.shiftKey && event.key.toLowerCase() === "z") {
      event.preventDefault()
      undo()
    } else if (!mod && /^[1-9]$/.test(event.key) && rail[Number(event.key) - 1]) {
      event.preventDefault()
      setChosen(rail[Number(event.key) - 1])
    }
  }

  function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = newCategory.current
    if (!input?.value.trim()) return
    setChosen(createCategory("saved", input.value))
    input.value = ""
    scroller.current?.focus({ preventScroll: true })
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col transition-opacity duration-200 ease-out starting:opacity-0"
      onKeyDown={onKeyDown}
      onKeyUp={(event) => event.key === "Shift" && setShift(false)}
    >
      <header className="flex shrink-0 items-center gap-3 border-b py-3 pr-4 pl-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          disabled={dirty}
          aria-label="Back to categories"
          title={dirty ? "Undo every step to go back" : "Back"}
        >
          <ArrowLeftIcon />
        </Button>
        <div className="flex min-w-0 flex-col gap-0.5">
          <DialogTitle>Sort into categories</DialogTitle>
          <DialogDescription className="text-xs tabular-nums">
            {left === 0 ? `All ${listings.length} sorted` : `${left} of ${listings.length} left`}
          </DialogDescription>
        </div>
        <Progress
          value={listings.length ? (done / listings.length) * 100 : 0}
          aria-label="Sorted"
          className="mx-4 hidden max-w-56 flex-1 sm:flex"
        />
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={undo}
            disabled={!dirty}
            className="active:scale-[0.97] motion-reduce:active:scale-100"
          >
            <Undo2Icon />
            Undo
            <Kbd className="ml-0.5 hidden sm:inline-flex">⌘Z</Kbd>
          </Button>
          <Button size="sm" onClick={onDone} className="active:scale-[0.97] motion-reduce:active:scale-100">
            Done
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[13.5rem_minmax(0,1fr)]">
        <nav aria-label="Categories" className="flex min-h-0 flex-col border-r bg-muted/30">
          <p className="px-4 pt-3 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            File into
          </p>
          <div ref={railList} className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
            {rail.map((name, i) => (
              <RailItem
                key={name}
                name={name}
                shortcut={i < 9 ? i + 1 : null}
                count={tally.get(name) ?? 0}
                active={name === active}
                onPick={() => setChosen(name)}
              />
            ))}
            <form onSubmit={create} className="mt-1">
              <label
                className={cn(
                  "flex h-9 items-center gap-2 rounded-lg border border-dashed px-2 text-muted-foreground transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
                  !rail.length && "border-brand/50 text-foreground"
                )}
              >
                <PlusIcon className="size-4 shrink-0" />
                <input
                  ref={newCategory}
                  placeholder={rail.length ? "New category" : "Name your first category"}
                  aria-label="New category"
                  maxLength={40}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </label>
            </form>
          </div>
        </nav>

        <div className="flex min-h-0 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-3 border-b px-4 text-xs text-muted-foreground">
            <p className="min-w-0 truncate">
              {left === 0 ? (
                "Everything has a category. Undo to change any, or Done to file them."
              ) : active ? (
                <>
                  Click to file into <span className="font-medium text-foreground">{active}</span>
                  <span className="hidden lg:inline"> · Shift-click for a run · Drag to lasso</span>
                </>
              ) : (
                "Make a category on the left to start"
              )}
            </p>
            {left > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto max-w-72 min-w-0 active:scale-[0.97] motion-reduce:active:scale-100"
                disabled={!active}
                onClick={() => assign(remaining.map((l) => l.id))}
              >
                <span className="truncate">
                  All {left} to {active ?? "…"}
                </span>
              </Button>
            )}
          </div>

          <div
            ref={scroller}
            tabIndex={-1}
            className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none"
          >
            {left === 0 ? (
              <Finished total={listings.length} tally={tally} onDone={onDone} />
            ) : (
              <ol
                ref={grid}
                aria-label="Listings left to sort"
                onClick={onClick}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerLeave={() => setPreview(null)}
                className="relative grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] content-start gap-2 p-4 select-none"
                style={{ "--sort-into": JSON.stringify(active ?? "") } as React.CSSProperties}
              >
                {remaining.map((listing) => (
                  <Tile
                    key={listing.id}
                    listing={listing}
                    folder={folderOf.get(listing.id) ?? null}
                    marked={lassoed.has(listing.id) || run.has(listing.id)}
                  />
                ))}
                {box && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute z-10 rounded-sm border border-brand bg-brand/10"
                    style={box}
                  />
                )}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Ids from `a` to `b` (either way round) in `listings` order. */
function between(listings: Listing[], a: number, b: number) {
  const i = listings.findIndex((l) => l.id === a)
  const j = listings.findIndex((l) => l.id === b)
  if (i < 0 || j < 0) return [b]
  return listings.slice(Math.min(i, j), Math.max(i, j) + 1).map((l) => l.id)
}

function RailItem({
  name,
  shortcut,
  count,
  active,
  onPick,
}: {
  name: string
  shortcut: number | null
  count: number
  active: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      data-category={name}
      aria-pressed={active}
      onClick={onPick}
      className={cn(
        "flex h-9 w-full shrink-0 items-center gap-2 rounded-lg px-2 text-left text-sm outline-none transition-[background-color,color,box-shadow,scale] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:active:scale-100",
        active
          ? "bg-background font-medium text-foreground shadow-xs ring-1 ring-brand/40"
          : "text-muted-foreground [@media(hover:hover)]:hover:bg-background/70 [@media(hover:hover)]:hover:text-foreground"
      )}
    >
      {shortcut ? (
        <Kbd className={cn("transition-colors duration-150", active && "bg-brand text-white")}>{shortcut}</Kbd>
      ) : (
        <FolderIcon className="mx-0.5 size-4 shrink-0 opacity-60" />
      )}
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {count > 0 && (
        <span
          key={count}
          className="text-xs font-medium text-brand tabular-nums animate-in fade-in-0 zoom-in-75 duration-200 motion-reduce:animate-none"
        >
          {count}
        </span>
      )}
    </button>
  )
}

const Tile = React.memo(function Tile({
  listing,
  folder,
  marked,
}: {
  listing: Listing
  folder: string | null
  marked: boolean
}) {
  const image = listing.images[0]
  return (
    <li
      data-sort-id={listing.id}
      className="transition-[opacity,scale] duration-200 ease-out-strong [contain-intrinsic-size:auto_6rem] [content-visibility:auto] starting:scale-90 starting:opacity-0 motion-reduce:transition-none"
    >
      <button
        type="button"
        aria-label={`${listing.title}${folder ? `, in ${folder}` : ""}`}
        className="group/sort relative block aspect-[5/4] w-full overflow-hidden rounded-lg bg-muted outline-none transition-[scale] duration-150 ease-out active:scale-[0.96] motion-reduce:active:scale-100"
        style={listing.color ? { backgroundColor: listing.color } : undefined}
      >
        {image && (
          <Image
            src={image.medium}
            alt=""
            fill
            unoptimized
            sizes="160px"
            draggable={false}
            className="object-cover"
          />
        )}
        <span className="absolute top-1 left-1 rounded-sm bg-background/85 px-1 py-px text-[10px] font-medium tabular-nums backdrop-blur-sm">
          {formatRate(listing.estimate.salesPerMonth)}
          <span className="font-normal text-muted-foreground">/mo</span>
        </span>
        {folder && (
          <span className="absolute right-1 bottom-1 flex max-w-[calc(100%-0.5rem)] items-center gap-0.5 rounded-sm bg-background/85 px-1 py-px text-[10px] backdrop-blur-sm transition-opacity duration-150 [@media(hover:hover)]:group-hover/sort:opacity-0">
            <FolderIcon className="size-2.5 shrink-0" />
            <span className="truncate">{folder}</span>
          </span>
        )}
        {/* Hover: where a click files it, and the title. */}
        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between bg-linear-to-t from-black/75 via-black/10 to-transparent p-1.5 opacity-0 transition-opacity duration-150 ease-out [@media(hover:hover)]:group-hover/sort:opacity-100">
          <span />
          <span className="max-w-full truncate rounded-full bg-brand px-2 py-0.5 text-[10px] font-medium text-white shadow-sm before:content-['→_'] after:content-(--sort-into)" />
          <span className="line-clamp-2 w-full text-left text-[10px] leading-tight text-white">{listing.title}</span>
        </span>
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-lg ring-1 ring-foreground/10 ring-inset transition-[box-shadow,background-color] duration-100 group-focus-visible/sort:ring-3 group-focus-visible/sort:ring-ring",
            marked && "bg-brand/20 ring-2 ring-brand"
          )}
        />
      </button>
    </li>
  )
})

function Finished({
  total,
  tally,
  onDone,
}: {
  total: number
  tally: ReadonlyMap<string, number>
  onDone: () => void
}) {
  return (
    <div className="grid h-full place-items-center p-6 transition-[opacity,scale] duration-300 ease-out-strong starting:scale-95 starting:opacity-0 motion-reduce:starting:scale-100">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <CircleCheckIcon className="size-10 text-brand" strokeWidth={1.5} />
        <div className="flex flex-col gap-1">
          <p className="text-base font-medium">All {total} sorted</p>
          <p className="text-sm text-muted-foreground">
            Done files them into {tally.size === 1 ? "their category" : `${tally.size} categories`}.
          </p>
        </div>
        <ul className="flex flex-wrap justify-center gap-1.5">
          {[...tally].map(([folder, count]) => (
            <li key={folder} className="flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs">
              <FolderIcon className="size-3 text-muted-foreground" />
              {folder}
              <span className="text-muted-foreground tabular-nums">{count}</span>
            </li>
          ))}
        </ul>
        <Button onClick={onDone} className="active:scale-[0.97] motion-reduce:active:scale-100">
          Done
        </Button>
      </div>
    </div>
  )
}
