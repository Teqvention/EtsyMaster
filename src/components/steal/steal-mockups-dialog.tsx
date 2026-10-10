"use client"

import Image from "next/image"
import { useRouter } from "next/navigation"
import * as React from "react"
import { ChevronDownIcon, FolderIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { CategoryPicker } from "@/components/mockups/category-picker"
import { SelectMark } from "@/components/selection"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { generate } from "@/hooks/use-generations"
import type { Listing } from "@/lib/etsy/types"
import type { GenerationSource } from "@/lib/generation/types"
import { cn } from "@/lib/utils"

// Turning a listing's photos into blank mockup scenes: the photo on screen
// (the default), all of them, or a hand-picked few. They land in a mockup
// category (not a Saved folder), the one used last to start with. Mount it
// afresh (`key`) for each opening.

// Not "steal-mockups:category": that one could hold a Saved folder.
const LAST_CATEGORY = "steal-mockups:mockup-category"

type Choice = "shown" | "all" | "pick"

export function StealMockupsDialog({
  listing,
  photo,
  open,
  onOpenChange,
}: {
  listing: Listing
  /** The photo on screen (index into `listing.images`). */
  photo: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const photos = listing.images
  const [choice, setChoice] = React.useState<Choice>("shown")
  const [picked, setPicked] = React.useState<ReadonlySet<number>>(() => new Set([photo]))
  const [chosenCategory, setCategory] = React.useState<string | null>(null)
  const [last] = React.useState(() =>
    typeof window === "undefined" ? null : localStorage.getItem(LAST_CATEGORY)
  )
  const [busy, setBusy] = React.useState(false)
  const category = chosenCategory ?? last

  const indices =
    choice === "all"
      ? photos.map((_, i) => i)
      : choice === "pick"
        ? [...picked].toSorted((a, b) => a - b)
        : [photo]
  const count = indices.length

  function toggle(index: number) {
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!category || !count || busy) return
    const sources: GenerationSource[] = indices.map((k) => ({
      listingId: listing.id,
      title: count > 1 ? `${listing.title} · photo ${k + 1}` : listing.title,
      image: photos[k].full,
      url: listing.url,
      shop: listing.shop?.name ?? null,
      tags: listing.tags,
    }))
    setBusy(true)
    try {
      await generate("mockup", category, sources)
      localStorage.setItem(LAST_CATEGORY, category)
      onOpenChange(false)
      toast.success(
        count === 1 ? `Stealing the mockup into ${category}` : `Stealing ${count} mockups into ${category}`,
        { action: { label: "View", onClick: () => router.push("/generation?kind=mockup") } }
      )
    } catch (error) {
      toast.error(`Couldn't steal mockups: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // The listing panel behind browses with the arrow keys and closes on Esc.
        onKeyDown={(event) => event.stopPropagation()}
        // Anchored from the top, so picking photos grows it downwards only.
        className="top-[max(1rem,12svh)] translate-y-0 gap-0 p-0 sm:max-w-xl"
      >
        {/* min-w-0: the truncated title must not size the dialog's grid column. */}
        <form onSubmit={submit} className="flex max-h-[min(88svh,46rem)] min-w-0 flex-col">
          <DialogHeader className="gap-1 p-5 pr-12 pb-4">
            <DialogTitle className="text-base">Steal mockups</DialogTitle>
            <DialogDescription className="truncate">{listing.title}</DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
            {photos.length > 1 ? (
              <RadioGroup
                value={choice}
                onValueChange={(value) => setChoice(value as Choice)}
                aria-label="Which photos"
                className="grid-cols-3 gap-2.5"
              >
                <ChoiceCard value="shown" title="This photo" detail={`Photo ${photo + 1} of ${photos.length}`}>
                  <Thumb src={photos[photo]?.medium} />
                </ChoiceCard>
                <ChoiceCard value="all" title={`All ${photos.length} photos`} detail="Every one">
                  <div className="grid size-full grid-cols-2 grid-rows-2 gap-px">
                    {photos.slice(0, 4).map((image, i) => (
                      <Thumb key={i} src={image.medium} className={cn(photos.length === 3 && i === 2 && "col-span-2")} />
                    ))}
                  </div>
                </ChoiceCard>
                <ChoiceCard
                  value="pick"
                  title="Choose photos"
                  detail={choice === "pick" ? `${picked.size} of ${photos.length} picked` : "Pick a few"}
                >
                  <div className="grid size-full grid-cols-3 grid-rows-2 gap-px opacity-80">
                    {photos.slice(0, 6).map((image, i) => (
                      <span key={i} className="relative">
                        <Thumb src={image.thumb} />
                        {i === photo && <span className="absolute inset-0 ring-2 ring-brand ring-inset" />}
                      </span>
                    ))}
                  </div>
                </ChoiceCard>
              </RadioGroup>
            ) : (
              <div className="relative aspect-4/3 w-48 overflow-hidden rounded-lg border bg-muted">
                <Thumb src={photos[0]?.medium} />
              </div>
            )}

            {choice === "pick" && (
              <ul
                aria-label="Photos"
                className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2 transition-[opacity,translate] duration-200 ease-out-strong starting:-translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0"
              >
                {photos.map((image, i) => {
                  const on = picked.has(i)
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        aria-pressed={on}
                        aria-label={`Photo ${i + 1}`}
                        onClick={() => toggle(i)}
                        className={cn(
                          "group/tile relative block aspect-square w-full overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10 outline-none transition-[box-shadow,scale] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.96] motion-reduce:active:scale-100",
                          on && "ring-2 ring-brand"
                        )}
                      >
                        <Thumb src={image.medium} />
                        <span
                          aria-hidden
                          className={cn(
                            "absolute inset-0 bg-brand/10 opacity-0 transition-opacity duration-150",
                            on && "opacity-100"
                          )}
                        />
                        <SelectMark selected={on} selecting />
                        {i === photo && (
                          <span className="absolute right-1 bottom-1 rounded-sm bg-background/85 px-1 text-[10px] font-medium backdrop-blur-sm">
                            On screen
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">Mockup category</span>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" size="sm" className="max-w-64 min-w-0">
                      <FolderIcon className="text-muted-foreground" />
                      <span className={cn("truncate", !category && "text-muted-foreground")}>
                        {category ?? "Choose a category"}
                      </span>
                      <ChevronDownIcon className="text-muted-foreground" data-icon="inline-end" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="start" className="w-64 p-0">
                  <CategoryPicker of="mockups" onPick={setCategory} current={category} />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <DialogFooter className="m-0 flex-row items-center gap-2 border-t bg-muted/50 px-5 py-3">
            <p className="mr-auto text-xs text-muted-foreground">
              Each photo becomes a blank mockup scene.
            </p>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button
              type="submit"
              disabled={!category || !count || busy}
              className="active:scale-[0.97] motion-reduce:active:scale-100"
            >
              {busy && <LoaderCircleIcon className="animate-spin" />}
              {count === 1 ? "Steal mockup" : `Steal ${count} mockups`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ChoiceCard({
  value,
  title,
  detail,
  children,
}: {
  value: Choice
  title: string
  detail: string
  children: React.ReactNode
}) {
  return (
    <label className="group/choice flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border bg-card transition-[border-color,box-shadow,scale] duration-150 ease-out active:scale-[0.98] has-data-checked:border-brand has-data-checked:ring-1 has-data-checked:ring-brand has-focus-visible:ring-3 has-focus-visible:ring-ring/50 motion-reduce:active:scale-100 [@media(hover:hover)]:hover:border-foreground/25">
      <span className="relative aspect-4/3 overflow-hidden border-b bg-muted">{children}</span>
      <span className="flex items-start gap-2 p-2.5">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{title}</span>
          <span className="truncate text-xs text-muted-foreground tabular-nums">{detail}</span>
        </span>
        <RadioGroupItem value={value} className="mt-0.5 data-checked:border-brand data-checked:bg-brand dark:data-checked:bg-brand" />
      </span>
    </label>
  )
}

function Thumb({ src, className }: { src?: string; className?: string }) {
  if (!src) return null
  return (
    <span className={cn("relative block size-full", className)}>
      <Image src={src} alt="" fill unoptimized sizes="200px" draggable={false} className="object-cover" />
    </span>
  )
}
