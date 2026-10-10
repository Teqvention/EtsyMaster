"use client"

import Image from "next/image"
import * as React from "react"
import { ExternalLinkIcon, ImagesIcon, PencilIcon, ReplaceIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { fetchDetail } from "@/hooks/use-artikel"
import { formatNumber } from "@/lib/etsy/format"
import type { ArtikelDetail, ArtikelRow, InternalTag } from "@/lib/artikel/types"
import type { LedgerCategory } from "@/lib/sync/types"
import { cn } from "@/lib/utils"

import type { ActionKind } from "./action-dialog"
import { Est, money, shortDate, Signed, StateLabel, TagChip } from "./shared"

// One listing in depth over the range: its numbers, views and orders day by
// day, every order, Etsy's fees by kind, its sizes and photos, and the
// changes that can be made to it alone.

const FEE_LABEL: Record<LedgerCategory, string> = {
  listing: "Listing fees",
  transaction: "Transaction fees",
  processing: "Payment processing",
  ads: "Etsy Ads",
  offsite_ads: "Offsite Ads",
  shipping_label: "Shipping labels",
  vat: "VAT on fees",
  subscription: "Etsy Plus",
  setup: "Shop setup",
  other_fee: "Other fees",
  sale: "Sales",
  refund: "Refunds",
  payout: "Payouts",
  other: "Other",
}

export function ListingSheet({
  row,
  range,
  tags,
  onClose,
  onAction,
}: {
  row: ArtikelRow | null
  range: { from: string; to: string }
  tags: Map<string, InternalTag>
  onClose: () => void
  onAction: (kind: ActionKind, listingId: number) => void
}) {
  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-xl">
        {row && <Detail key={`${row.listingId}|${range.from}|${range.to}`} row={row} range={range} tags={tags} onAction={onAction} />}
      </SheetContent>
    </Sheet>
  )
}

function Detail({
  row,
  range,
  tags,
  onAction,
}: {
  row: ArtikelRow
  range: { from: string; to: string }
  tags: Map<string, InternalTag>
  onAction: (kind: ActionKind, listingId: number) => void
}) {
  const [detail, setDetail] = React.useState<{ data?: ArtikelDetail; error?: string } | null>(null)
  React.useEffect(() => {
    let cancelled = false
    fetchDetail(row.listingId, range).then(
      (data) => !cancelled && setDetail({ data }),
      (error: Error) => !cancelled && setDetail({ error: error.message })
    )
    return () => {
      cancelled = true
    }
  }, [row.listingId, range])
  const data = detail?.data
  const c = row.currency

  return (
    <>
      <SheetHeader className="gap-1 border-b p-4 pr-12">
        <SheetTitle className="text-base leading-snug text-pretty">{row.title}</SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <StateLabel state={row.state} />
          <span>· {row.shop}</span>
          {row.section && <span>· {row.section}</span>}
          <a href={row.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline">
            On Etsy
            <ExternalLinkIcon className="size-3" />
          </a>
          {row.tags.map((id) => {
            const tag = tags.get(id)
            return tag && <TagChip key={id} tag={tag} />
          })}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-5 p-4">
        <dl className="grid grid-cols-4 gap-px overflow-hidden rounded-lg border bg-border text-sm">
          {[
            { label: "Views", value: formatNumber(row.views) },
            { label: "Favourites", value: formatNumber(row.favorites) },
            { label: "Sales", value: `${formatNumber(row.sales)}${row.orders !== row.sales ? ` · ${row.orders} ord.` : ""}` },
            { label: "Revenue", value: money(row.revenueCents, c) },
            { label: "Etsy fees", value: <>{money(row.feesCents, c)}{row.feesEstimated && <Est title="Partly worked out at Etsy's rates" />}</> },
            { label: "Gelato", value: <>{money(row.costCents, c)}{row.costEstimated && <Est title="Gelato's usual price for the size" />}</> },
            { label: "Profit", value: <Signed cents={row.profitCents} currency={c} /> },
            { label: "Ads (share)", value: row.adsEstCents ? `≈ ${money(row.adsEstCents, c)}` : "—" },
          ].map((stat) => (
            <div key={stat.label} className="flex min-w-0 flex-col gap-0.5 bg-card px-2.5 py-1.5">
              <dt className="truncate text-[11px] text-muted-foreground">{stat.label}</dt>
              <dd className="truncate font-semibold tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>
        <p className="-mt-3 text-[11px] text-muted-foreground">
          {shortDate(range.from)} – {shortDate(range.to)}. All time: {formatNumber(row.viewsTotal)} views, {formatNumber(row.favoritesTotal)} favourites.
          Etsy Ads are the shop&apos;s spend shared by views: Etsy gives neither spend nor clicks per listing. Offsite Ads fees count with the fees.
        </p>

        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" className="active:scale-[0.97]" onClick={() => onAction("price", row.listingId)}>
            <PencilIcon />
            Change price
          </Button>
          <Button variant="outline" size="sm" className="active:scale-[0.97]" onClick={() => onAction("reorderPhotos", row.listingId)}>
            <ImagesIcon />
            Photo order
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="active:scale-[0.97]"
            disabled={data !== undefined && !data.pipeline}
            title={data && !data.pipeline ? "Only listings our upload pipeline made have the poster to show in another scene" : undefined}
            onClick={() => onAction("swapPhoto", row.listingId)}
          >
            <ReplaceIcon />
            Swap a photo
          </Button>
        </div>

        {!detail ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
          </div>
        ) : detail.error ? (
          <p className="text-sm text-destructive">{detail.error}</p>
        ) : (
          data && <Body data={data} currency={c} />
        )}
      </div>
    </>
  )
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Body({ data, currency }: { data: ArtikelDetail; currency: string }) {
  const maxViews = Math.max(1, ...data.days.map((d) => d.views))
  const fees = data.fees.filter((f) => f.cents !== 0)
  return (
    <>
      <Section title="Day by day" aside={<span className="text-[11px] text-muted-foreground">views · orders marked</span>}>
        <div className="flex h-20 items-end gap-px" role="img" aria-label="Views per day">
          {data.days.map((d) => (
            <div key={d.date} className="group/day relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${shortDate(d.date)}: ${d.views} views, ${d.favorites} favourites${d.orders ? `, ${d.orders} order${d.orders === 1 ? "" : "s"}` : ""}`}>
              <div className={cn("w-full rounded-t-[2px] bg-foreground/20", d.views === 0 && "bg-foreground/5")} style={{ height: `${Math.max((d.views / maxViews) * 100, 3)}%` }} />
              {d.orders > 0 && <span className="absolute -top-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-emerald-500" />}
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
          <span>{shortDate(data.days[0]?.date ?? "")}</span>
          <span>{shortDate(data.days.at(-1)?.date ?? "")}</span>
        </div>
      </Section>

      <Section title="Orders" aside={<span className="text-[11px] text-muted-foreground tabular-nums">{data.orders.length}</span>}>
        {data.orders.length === 0 ? (
          <p className="text-xs text-muted-foreground">None in this range.</p>
        ) : (
          <table className="w-full text-xs tabular-nums">
            <tbody>
              {data.orders.map((o) => (
                <tr key={`${o.receiptId}-${o.at}-${o.size}`} className={cn("border-b last:border-0", o.revenueCents === 0 && "text-muted-foreground line-through")}>
                  <td className="py-1 pr-2 whitespace-nowrap">{shortDate(o.at)}</td>
                  <td className="py-1 pr-2">{o.size?.toUpperCase().replace("X", "×") ?? "—"}{o.quantity > 1 && ` ×${o.quantity}`}</td>
                  <td className="py-1 pr-2 text-muted-foreground">{o.country ?? ""}</td>
                  <td className="py-1 pr-2 text-right">{money(o.revenueCents, currency)}</td>
                  <td className="py-1 text-right text-muted-foreground">
                    {o.revenueCents === 0 ? "" : o.costCents !== null ? `Gelato ${money(o.costCents, currency)}` : "Gelato est."}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {(fees.length > 0 || data.feesEstimatedCents > 0) && (
        <Section title="Etsy fees">
          <ul className="flex flex-col text-xs tabular-nums">
            {fees.map((f) => (
              <li key={f.category} className="flex justify-between border-b py-1 last:border-0">
                <span>{FEE_LABEL[f.category]}</span>
                <span>{money(f.cents, currency)}</span>
              </li>
            ))}
            {data.feesEstimatedCents > 0 && (
              <li className="flex justify-between border-b py-1 text-muted-foreground last:border-0">
                <span>Not booked yet, at Etsy&apos;s rates</span>
                <span>≈ {money(data.feesEstimatedCents, currency)}</span>
              </li>
            )}
          </ul>
        </Section>
      )}

      <Section title="Sizes" aside={<span className="text-[11px] text-muted-foreground tabular-nums">{data.variants.length}</span>}>
        <ul className="grid grid-cols-2 gap-x-4 text-xs tabular-nums">
          {data.variants.map((v) => (
            <li key={v.productId} className="flex justify-between gap-2 border-b py-1">
              <span className="truncate" title={v.label}>{v.label || "Price"}</span>
              <span>{money(v.priceCents, currency)}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Photos" aside={<span className="text-[11px] text-muted-foreground">{data.pipeline ? "Made by our pipeline" : "Not from our pipeline: photos can be reordered, not swapped"}</span>}>
        <div className="grid grid-cols-5 gap-1.5">
          {data.images.map((image, i) => (
            <a key={image.id} href={image.fullUrl} target="_blank" rel="noopener noreferrer" className="relative aspect-square overflow-hidden rounded-md border bg-muted">
              <Image src={image.url} alt="" fill unoptimized sizes="100px" className="object-cover" />
              <span className={cn("absolute top-1 left-1 grid h-4 min-w-4 place-items-center rounded px-1 text-[10px] font-semibold tabular-nums", i === 0 ? "bg-brand text-white" : "bg-background/90")}>
                {i + 1}
              </span>
            </a>
          ))}
        </div>
      </Section>

      {data.tagsOnEtsy.length > 0 && (
        <Section title="Tags on Etsy">
          <p className="text-xs leading-relaxed text-muted-foreground">{data.tagsOnEtsy.join(" · ")}</p>
        </Section>
      )}
    </>
  )
}
