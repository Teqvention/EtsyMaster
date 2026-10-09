"use client"

import Image from "next/image"
import * as React from "react"
import { CheckIcon, MinusIcon, PlusIcon, SearchIcon, StoreIcon, TagIcon, TagsIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
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
import {
  hasLabel,
  setShopLabel,
  useShopHistory,
  useShopLabels,
  type ShopVisit,
} from "@/hooks/use-shop-history"
import type { ListingShop } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// Labels file shops into groups of your own ("Wall art", "Competitors",
// "Steal next"…). The list below a search field toggles a label on every shop
// it's opened for; typing a name that doesn't exist yet creates it.

/**
 * Search-or-create over the labels in use, each row a toggle for all `shops`
 * at once: checked when every one carries it, a dash when some do.
 */
export function LabelList({ shops, autoFocus = true }: { shops: ListingShop[]; autoFocus?: boolean }) {
  const labels = useShopLabels()
  const history = useShopHistory()
  const [query, setQuery] = React.useState("")
  const input = React.useRef<HTMLInputElement>(null)
  const list = React.useRef<HTMLUListElement>(null)

  const name = query.trim().replace(/\s+/g, " ")
  const needle = name.toLowerCase()
  const matches = needle
    ? labels
        .filter((l) => l.name.toLowerCase().includes(needle))
        .toSorted(
          (a, b) =>
            Number(b.name.toLowerCase().startsWith(needle)) - Number(a.name.toLowerCase().startsWith(needle))
        )
    : labels
  const exact = matches.some((l) => l.name.toLowerCase() === needle)

  const stateOf = (label: string): "all" | "some" | "none" => {
    const carrying = shops.filter((s) => {
      const visit: ShopVisit | undefined = history[s.id]
      return visit ? hasLabel(visit, label) : false
    }).length
    return carrying === 0 ? "none" : carrying === shops.length ? "all" : "some"
  }

  function toggle(label: string) {
    setShopLabel(shops, label, stateOf(label) !== "all")
  }

  function create() {
    if (!name) return
    setShopLabel(shops, name, true)
    setQuery("")
    input.current?.focus()
  }

  // ↑/↓ walk the field and the rows, like a menu.
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    const items = [input.current, ...(list.current?.querySelectorAll<HTMLElement>("button") ?? [])].filter(
      (el): el is HTMLElement => !!el
    )
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = items[Math.min(Math.max(at + (event.key === "ArrowDown" ? 1 : -1), 0), items.length - 1)]
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  return (
    <div className="flex flex-col" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 border-b px-2.5">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            const top = matches.find((l) => l.name.toLowerCase() === needle) ?? (needle ? matches[0] : undefined)
            if (top) {
              toggle(top.name)
              setQuery("")
            } else create()
          }}
          placeholder={labels.length ? "Find or create a label" : "Name a label, e.g. Competitors"}
          aria-label="Find or create a label"
          maxLength={32}
          autoComplete="off"
          spellCheck={false}
          className="h-10 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <ul ref={list} className="max-h-72 overflow-y-auto p-1" aria-label="Labels">
        {matches.map((label) => {
          const state = stateOf(label.name)
          return (
            <li key={label.name}>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
                onClick={() => toggle(label.name)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:bg-accent [@media(hover:hover)]:hover:bg-accent"
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors duration-100 ease-out",
                    state === "none" ? "border-input" : "border-primary bg-primary text-primary-foreground"
                  )}
                >
                  {state === "all" && <CheckIcon className="size-3" strokeWidth={3} />}
                  {state === "some" && <MinusIcon className="size-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{label.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{label.count}</span>
              </button>
            </li>
          )
        })}

        {name && !exact && (
          <li>
            <button
              type="button"
              onClick={create}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:bg-accent [@media(hover:hover)]:hover:bg-accent",
                matches.length > 0 && "mt-1"
              )}
            >
              <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">
                Create <span className="font-medium">“{name}”</span>
              </span>
            </button>
          </li>
        )}

        {!name && matches.length === 0 && (
          <li className="px-2 py-3 text-xs text-muted-foreground">
            No labels yet. Type a name and press Enter to create one.
          </li>
        )}
      </ul>
    </div>
  )
}

/** Centred: labels for the shops picked on the Shops page. */
export function LabelDialog({
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
              <DialogTitle>
                Label {shops.length === 1 ? shops[0].name : `${shops.length} shops`}
              </DialogTitle>
              <DialogDescription className="truncate text-xs">
                {shops.length === 1
                  ? "Click a label to add or remove it."
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
          {open && <LabelList shops={shops} />}
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

/** In an open shop's header: its labels, and a popover to change them. */
export function ShopLabelButton({ shop }: { shop: ListingShop }) {
  const history = useShopHistory()
  const labels = history[shop.id]?.labels ?? []
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="-ml-1 h-6 gap-1 px-1 text-muted-foreground data-popup-open:bg-muted"
            aria-label={labels.length ? `Labels: ${labels.join(", ")}` : "Add a label"}
          />
        }
      >
        {labels.length ? (
          <>
            <TagsIcon />
            <LabelBadges labels={labels} />
          </>
        ) : (
          <>
            <TagIcon />
            Label
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-0 p-0">
        <LabelList shops={[shop]} />
      </PopoverContent>
    </Popover>
  )
}

/** Small and quiet, next to a shop's name. */
export function LabelBadges({ labels, max = 3 }: { labels: string[]; max?: number }) {
  if (labels.length === 0) return null
  const shown = labels.slice(0, max)
  return (
    <span className="flex min-w-0 items-center gap-1">
      {shown.map((label) => (
        <Badge
          key={label}
          variant="outline"
          className="h-4 max-w-28 truncate px-1.5 text-[10px] font-normal text-muted-foreground"
        >
          {label}
        </Badge>
      ))}
      {labels.length > max && (
        <span className="text-[10px] text-muted-foreground">+{labels.length - max}</span>
      )}
    </span>
  )
}
