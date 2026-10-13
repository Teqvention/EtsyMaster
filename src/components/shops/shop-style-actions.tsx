"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { LoaderCircleIcon, PaletteIcon, PlusIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { addSavedListings, refreshStyles, sized, useStyles } from "@/hooks/use-styles"
import type { Listing } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// A shop's picked listings onto a style: a new city style made of them, or
// added to one there is. Their posters are taken out of the photos on the
// server in the background (the style counts them incoming), so the board
// holds the artwork, not the room around it.

const posters = (listings: Listing[]) =>
  listings.filter((l) => l.images[0]).map((l) => ({ listingId: l.id, title: l.title, image: l.images[0].full || l.images[0].medium }))

export function ShopStyleActions({ listings, onDone }: { listings: Listing[]; onDone: () => void }) {
  const [naming, setNaming] = React.useState(false)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setNaming(true)} disabled={!listings.length} className="active:scale-[0.97]">
        <PaletteIcon />
        Create style
      </Button>
      <AddToStyle listings={listings} onDone={onDone} />
      <CreateStyleDialog open={naming} onOpenChange={setNaming} listings={listings} onDone={onDone} />
    </>
  )
}

function done(id: string, name: string, count: number, open: (href: string) => void) {
  toast.success(`${count} ${count === 1 ? "poster" : "posters"} on their way to “${name}”`, {
    description: "Taken out of their photos in the background; the guide is read once they're on the board.",
    action: { label: "Open", onClick: () => open(`/citys/styles/${id}`) },
  })
}

function CreateStyleDialog({ open, onOpenChange, listings, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; listings: Listing[]; onDone: () => void }) {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const list = posters(listings).slice(0, 20)

  async function create() {
    if (!name.trim() || !list.length) return
    setBusy(true)
    try {
      const made = await fetch("/api/citys/styles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) })
      const style = await made.json()
      if (!made.ok) throw new Error(style.error ?? made.statusText)
      await addSavedListings(style.id, list)
      void refreshStyles()
      done(style.id, name.trim(), list.length, router.push)
      setName("")
      onOpenChange(false)
      onDone()
    } catch (error) {
      toast.error(`Couldn't make the style: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle>New style from {list.length} {list.length === 1 ? "listing" : "listings"}</DialogTitle>
        <DialogDescription>
          Their posters become the style&apos;s board{listings.length > 20 ? " (the first 20)" : ""}: taken out of the photos, read, then ready for the lab and Produce.
        </DialogDescription>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Style name, e.g. Pastel coast photo" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || !list.length}>
              {busy ? <LoaderCircleIcon className="animate-spin" /> : <PaletteIcon />}
              Make the style
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** A style to add the picked listings to: city styles first, then the others, filtered as you type. */
function AddToStyle({ listings, onDone }: { listings: Listing[]; onDone: () => void }) {
  const router = useRouter()
  const styles = useStyles()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [busy, setBusy] = React.useState<string | null>(null)
  const needle = query.trim().toLowerCase()
  const shown = (styles ?? [])
    .filter((s) => !needle || s.name.toLowerCase().includes(needle))
    .toSorted((a, b) => Number(!!b.cityVersion || !!b.cityStatus) - Number(!!a.cityVersion || !!a.cityStatus))

  async function add(id: string, name: string) {
    const list = posters(listings)
    setBusy(id)
    try {
      await addSavedListings(id, list)
      done(id, name, list.length, router.push)
      setOpen(false)
      onDone()
    } catch (error) {
      toast.error(`Couldn't add them: ${(error as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void refreshStyles()
      }}
    >
      <PopoverTrigger render={<Button size="sm" variant="outline" disabled={!listings.length} />}>
        <PlusIcon />
        Add to style
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-0 p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <SearchIcon className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a style"
            aria-label="Find a style"
            className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul className="max-h-72 overflow-y-auto p-1">
          {styles === null ? (
            <li className="px-2 py-3 text-xs text-muted-foreground">Loading…</li>
          ) : shown.length === 0 ? (
            <li className="px-2 py-3 text-xs text-muted-foreground">No style matches.</li>
          ) : (
            shown.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => add(s.id, s.name)}
                  className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:bg-accent [@media(hover:hover)]:hover:bg-accent", busy === s.id && "opacity-70")}
                >
                  <span className="relative size-8 shrink-0 overflow-hidden rounded bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {s.covers[0] && <img src={sized(s.covers[0], 160)} alt="" className="size-full object-cover" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{s.name}</span>
                    <span className="block text-[11px] text-muted-foreground tabular-nums">
                      {s.cityVersion || s.cityStatus ? "City style · " : ""}
                      {s.count} {s.count === 1 ? "image" : "images"}
                    </span>
                  </span>
                  {busy === s.id && <LoaderCircleIcon className="size-4 animate-spin" />}
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          Or open <Link href="/citys/styles" className="underline-offset-2 hover:underline">City styles</Link>.
        </div>
      </PopoverContent>
    </Popover>
  )
}
