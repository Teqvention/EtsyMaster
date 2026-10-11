"use client"

import Image from "next/image"
import * as React from "react"
import { CheckIcon, ChevronRightIcon, MinusIcon, PlusIcon, SearchIcon, StoreIcon, TagIcon, XIcon } from "lucide-react"

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
  hasPrimaryTag,
  hasSecondaryTag,
  setPrimaryTag,
  setSecondaryTag,
  tagName,
  useShopHistory,
  useShopTags,
  type ShopTag,
} from "@/hooks/use-shop-history"
import type { ListingShop } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// Tags file shops in two steps: one primary tag says what kind of shop it is
// ("City"), secondary tags under it tell them apart ("Cartoon", "Real",
// "Funky"). The picker lists the primary tags in use as a single choice (a
// search field finds one or creates it), then the secondary tags known under
// the one picked, to switch on and off or add to. For many shops at once a
// row shows a dash when only some carry it.

type State = "all" | "some" | "none"

const stateOf = (carrying: number, total: number): State =>
  carrying === 0 ? "none" : carrying === total ? "all" : "some"

/** Primary tag first, then its secondary ones, for the shops given. */
export function TagPicker({ shops, autoFocus = true }: { shops: ListingShop[]; autoFocus?: boolean }) {
  const tags = useShopTags()
  const history = useShopHistory()
  const visits = shops.map((s) => history[s.id])
  const tagged = visits.filter((v) => v?.tag).length
  // The primary tag every shop shares: only then can secondary ones go on all of them.
  const first = visits[0]?.tag?.primary
  const shared = first && visits.every((v) => hasPrimaryTag(v, first)) ? first : null
  const primaryOf = (name: string) => stateOf(visits.filter((v) => hasPrimaryTag(v, name)).length, shops.length)

  return (
    <div className="flex flex-col">
      <PrimaryList
        tags={tags}
        stateOf={primaryOf}
        autoFocus={autoFocus}
        onPick={(name) => setPrimaryTag(shops, name)}
        onClear={tagged > 0 ? () => setPrimaryTag(shops, null) : undefined}
      />
      <div className="border-t">
        {shared ? (
          <SecondaryTags
            primary={shared}
            known={tags.find((t) => t.name.toLowerCase() === shared.toLowerCase())?.secondary ?? []}
            stateOf={(name) => stateOf(visits.filter((v) => hasSecondaryTag(v, name)).length, shops.length)}
            onToggle={(name, on) => setSecondaryTag(shops, shared, name, on)}
          />
        ) : (
          <p className="px-3 py-2.5 text-xs text-pretty text-muted-foreground">
            {tagged > 0
              ? "These shops have different primary tags: give them one to add secondary tags."
              : "Pick a primary tag first, e.g. City. Then narrow it down with secondary tags: Cartoon, Real, Funky."}
          </p>
        )}
      </div>
    </div>
  )
}

function PrimaryList({
  tags,
  stateOf,
  autoFocus,
  onPick,
  onClear,
}: {
  tags: { name: string; count: number }[]
  stateOf: (name: string) => State
  autoFocus: boolean
  onPick: (name: string) => void
  onClear?: () => void
}) {
  const [query, setQuery] = React.useState("")
  const input = React.useRef<HTMLInputElement>(null)
  const list = React.useRef<HTMLUListElement>(null)

  const name = tagName(query)
  const needle = name.toLowerCase()
  const matches = needle
    ? tags
        .filter((t) => t.name.toLowerCase().includes(needle))
        .toSorted(
          (a, b) => Number(b.name.toLowerCase().startsWith(needle)) - Number(a.name.toLowerCase().startsWith(needle))
        )
    : tags
  const exact = matches.some((t) => t.name.toLowerCase() === needle)

  function pick(tag: string) {
    onPick(tag)
    setQuery("")
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
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1">
        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Primary tag</span>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="-mr-1 inline-flex items-center gap-0.5 rounded-sm px-1 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:text-destructive [&_svg]:size-3"
          >
            <XIcon />
            Remove tags
          </button>
        )}
      </div>
      <div className="mx-1.5 flex items-center gap-2 rounded-md border px-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            const top = matches.find((t) => t.name.toLowerCase() === needle) ?? (needle ? matches[0] : undefined)
            if (top) pick(top.name)
            else if (name) pick(name)
          }}
          placeholder={tags.length ? "Find or create a tag" : "Name a tag, e.g. City"}
          aria-label="Find or create a primary tag"
          maxLength={32}
          autoComplete="off"
          spellCheck={false}
          className="h-8 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <ul ref={list} className="max-h-56 overflow-y-auto p-1.5" aria-label="Primary tags">
        {matches.map((tag) => {
          const state = stateOf(tag.name)
          return (
            <li key={tag.name}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={state === "all"}
                onClick={() => pick(tag.name)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:bg-accent [@media(hover:hover)]:hover:bg-accent"
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border transition-colors duration-100 ease-out",
                    state === "none" ? "border-input" : "border-primary bg-primary text-primary-foreground"
                  )}
                >
                  {state === "all" && <span className="size-1.5 rounded-full bg-current" />}
                  {state === "some" && <MinusIcon className="size-3" strokeWidth={3} />}
                </span>
                <span className={cn("min-w-0 flex-1 truncate", state === "all" && "font-medium")}>{tag.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{tag.count}</span>
              </button>
            </li>
          )
        })}

        {name && !exact && (
          <li>
            <button
              type="button"
              onClick={() => pick(name)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:bg-accent [@media(hover:hover)]:hover:bg-accent"
            >
              <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">
                Create <span className="font-medium">“{name}”</span>
              </span>
            </button>
          </li>
        )}

        {!name && matches.length === 0 && (
          <li className="px-2 py-2 text-xs text-muted-foreground">No tags yet. Type a name and press Enter.</li>
        )}
      </ul>
    </div>
  )
}

/** The secondary tags known under `primary`, as toggles, and a field for a new one. */
function SecondaryTags({
  primary,
  known,
  stateOf,
  onToggle,
}: {
  primary: string
  known: { name: string; count: number }[]
  stateOf: (name: string) => State
  onToggle: (name: string, on: boolean) => void
}) {
  const [query, setQuery] = React.useState("")

  function add() {
    const name = tagName(query)
    if (!name) return
    onToggle(name, true)
    setQuery("")
  }

  return (
    <div className="flex flex-col gap-2 px-3 pt-2.5 pb-3">
      <span className="flex min-w-0 items-center gap-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        <span className="shrink-0">Secondary tags</span>
        <ChevronRightIcon className="size-3 shrink-0" aria-hidden />
        <span className="truncate normal-case tracking-normal text-foreground">{primary}</span>
      </span>
      {known.length > 0 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={`Secondary tags under ${primary}`}>
          {known.map((tag) => {
            const state = stateOf(tag.name)
            return (
              <button
                key={tag.name}
                type="button"
                aria-pressed={state === "all" ? true : state === "some" ? "mixed" : false}
                onClick={() => onToggle(tag.name, state !== "all")}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-[background-color,border-color,color,transform] duration-150 ease-out-strong outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97] motion-reduce:transition-none [&_svg]:size-3",
                  state === "all"
                    ? "border-primary bg-primary text-primary-foreground"
                    : state === "some"
                      ? "border-dashed border-primary/60 text-foreground"
                      : "text-muted-foreground [@media(hover:hover)]:hover:bg-muted [@media(hover:hover)]:hover:text-foreground"
                )}
              >
                {state === "all" ? <CheckIcon strokeWidth={3} /> : state === "some" ? <MinusIcon strokeWidth={3} /> : <PlusIcon />}
                {tag.name}
                <span className={cn("tabular-nums", state === "all" ? "opacity-70" : "text-muted-foreground")}>
                  {tag.count}
                </span>
              </button>
            )
          })}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              add()
            }
          }}
          placeholder={known.length ? "Add another, e.g. Funky" : "Add one, e.g. Cartoon"}
          aria-label={`Add a secondary tag under ${primary}`}
          maxLength={32}
          autoComplete="off"
          spellCheck={false}
          className="h-7 w-full min-w-0 rounded-md border bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button
          variant="outline"
          size="icon-sm"
          className="size-7 shrink-0 active:scale-[0.97]"
          disabled={!tagName(query)}
          onClick={add}
          aria-label="Add the secondary tag"
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
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
                  ? "A primary tag, then the secondary tags under it."
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
          {open && <TagPicker shops={shops} />}
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
  const tag = useShopHistory()[shop.id]?.tag
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="-ml-1 h-6 gap-1 px-1 text-muted-foreground data-popup-open:bg-muted"
            aria-label={tag ? `Tags: ${describeTag(tag)}` : "Add a tag"}
          />
        }
      >
        <TagIcon />
        {tag ? <TagBadge tag={tag} /> : "Tag"}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-0 p-0">
        <TagPicker shops={[shop]} />
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
        <TagPicker shops={[shop]} />
      </PopoverContent>
    </Popover>
  )
}

const describeTag = (tag: ShopTag) =>
  tag.secondary.length ? `${tag.primary} › ${tag.secondary.join(", ")}` : tag.primary

/** Small and quiet, next to a shop's name: "City › Cartoon, Funky". */
export function TagBadge({ tag, className }: { tag: ShopTag; className?: string }) {
  return (
    <span
      title={describeTag(tag)}
      className={cn(
        "inline-flex h-4 max-w-56 min-w-0 items-center gap-0.5 rounded-full border px-1.5 text-[10px] leading-none font-normal text-muted-foreground",
        className
      )}
    >
      <span className="shrink-0 font-medium text-foreground">{tag.primary}</span>
      {tag.secondary.length > 0 && (
        <>
          <ChevronRightIcon className="size-2.5 shrink-0 opacity-60" aria-hidden />
          <span className="truncate">{tag.secondary.join(", ")}</span>
        </>
      )}
    </span>
  )
}
