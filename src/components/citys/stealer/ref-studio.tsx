"use client"

import * as React from "react"
import { ExternalLinkIcon, LoaderCircleIcon, RefreshCwIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"

import { RequestEditor, TemplatePicker } from "@/components/citys/request-editor"
import { TierBadge } from "@/components/citys/tier"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { cropAgain, generateCities } from "@/hooks/use-stealer"
import type { StealerCityRow, StealerRef } from "@/lib/citys/stealer"
import { requestSize, type CityRequest } from "@/lib/citys/studio-types"
import { formatAge, formatCompact, formatRate } from "@/lib/etsy/format"
import { cn } from "@/lib/utils"

// One reference photo opened: everything that can be asked for on the left,
// the photo large on the right with the shop small beneath it. Generate
// sends it off; "Keep for this photo" stores the settings on the photo for
// a scaled run instead.

export function RefStudio({
  item,
  city,
  print: initial = 0,
  request,
  onRequest,
  mode,
  onClose,
  onKeep,
}: {
  item: StealerRef | null
  city: StealerCityRow | null
  /** The print to open on, for a set's photo. */
  print?: number
  request: CityRequest
  onRequest: (next: CityRequest) => void
  /** "open": generate from here; "settings": settings of its own for a scaled run. */
  mode: "open" | "settings"
  onClose: () => void
  onKeep?: (request: CityRequest | null) => void
}) {
  const [print, setPrint] = React.useState(initial)
  const [busy, setBusy] = React.useState(false)
  // Another listing (or print asked for): that print.
  const [printFor, setPrintFor] = React.useState(`${item?.listingId}|${initial}`)
  if (printFor !== `${item?.listingId}|${initial}`) {
    setPrintFor(`${item?.listingId}|${initial}`)
    setPrint(initial)
  }

  if (!item || !city) return null
  const prints = item.crop.prints
  const shown = prints[print] ?? null
  const size = requestSize(request)

  async function generate() {
    if (!item || !city) return
    setBusy(true)
    try {
      await generateCities([
        {
          placeId: city.id,
          place: city.name,
          country: city.country,
          ref: { listingId: item.listingId, shopId: item.shopId, shop: item.shop, title: item.title, image: item.short, tags: item.tags, labels: item.labels, print },
          request,
        },
      ])
      toast.success(`${size} ${size === 1 ? "image" : "images"} of ${city.name} on their way`, { description: "They land in Citys → Outputs." })
      onClose()
    } catch (error) {
      toast.error(`Couldn't start it: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="grid h-[min(52rem,calc(100svh-2rem))] grid-rows-1 gap-0 overflow-hidden p-0 sm:max-w-[min(78rem,calc(100%-2rem))]">
        <div className="grid min-h-0 grid-cols-1 md:grid-cols-[25rem_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-r">
            <div className="flex flex-col gap-1 border-b px-4 pt-4 pb-3">
              <div className="flex items-center gap-2">
                <TierBadge tier={city.tier} />
                <DialogTitle className="truncate text-base">{city.name}</DialogTitle>
              </div>
              <DialogDescription className="text-xs">
                {mode === "settings" ? "Settings of its own for this photo, used when the pick is generated." : "What to make of this photo."}
              </DialogDescription>
              <div className="pt-1">
                <TemplatePicker value={request} onPick={onRequest} />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <RequestEditor value={request} onChange={onRequest} hasReference />
            </div>
            <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                {size} {size === 1 ? "image" : "images"}
              </span>
              {mode === "settings" ? (
                <div className="flex gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => onKeep?.(null)}>
                    Use the pick&apos;s
                  </Button>
                  <Button size="sm" onClick={() => onKeep?.(request)} disabled={!size}>
                    Keep for this photo
                  </Button>
                </div>
              ) : (
                <Button onClick={generate} disabled={busy || !size} className="active:scale-[0.97]">
                  {busy ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
                  Generate {size}
                </Button>
              )}
            </div>
          </div>

          <div className="hidden min-h-0 flex-col bg-muted/40 md:flex">
            <div className="relative min-h-0 flex-1 p-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={shown ? shown.url : item.full || item.image}
                alt={item.title}
                className="absolute inset-6 m-auto max-h-[calc(100%-3rem)] max-w-[calc(100%-3rem)] rounded-md object-contain shadow-sm"
              />
            </div>
            <div className="flex flex-col gap-2 border-t bg-background px-5 py-3">
              {prints.length > 1 && (
                <div className="flex gap-1.5">
                  {prints.map((p, i) => (
                    <button
                      key={p.file}
                      type="button"
                      onClick={() => setPrint(i)}
                      className={cn("overflow-hidden rounded-md border-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50", i === print ? "border-brand" : "border-transparent opacity-70 hover:opacity-100")}
                      aria-label={`Print ${i + 1}${p.label ? `: ${p.label}` : ""}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.thumb} alt="" className="h-12 w-10 object-cover" />
                    </button>
                  ))}
                </div>
              )}
              <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{item.shop}</p>
                  <p className="truncate text-xs text-muted-foreground" title={item.title}>
                    {item.title}
                  </p>
                </div>
                <dl className="flex shrink-0 gap-3 text-right text-[11px] tabular-nums">
                  <div>
                    <dt className="text-muted-foreground">Sales/mo</dt>
                    <dd className="font-medium">{formatRate(item.spm)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Favs</dt>
                    <dd className="font-medium">{formatCompact(item.fav)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Up</dt>
                    <dd className="font-medium">{formatAge(item.ageDays)}</dd>
                  </div>
                </dl>
                <div className="flex shrink-0 gap-1">
                  {(item.crop.status === "error" || item.crop.status === "done") && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Take the photo out again"
                      aria-label="Take the photo out again"
                      onClick={() => cropAgain([item]).then(() => toast.success("Taking it out again"), (e: Error) => toast.error(e.message))}
                    >
                      <RefreshCwIcon />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon-sm" nativeButton={false} render={<a href={`https://www.etsy.com/listing/${item.listingId}`} target="_blank" rel="noopener noreferrer" />} aria-label="Open on Etsy">
                    <ExternalLinkIcon />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
