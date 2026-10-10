"use client"

import Image from "next/image"
import * as React from "react"
import { ArrowRightIcon, ImageIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fetchDetail, previewAction, startAction } from "@/hooks/use-artikel"
import { formatNumber } from "@/lib/etsy/format"
import type {
  ActionParams,
  ActionPreview,
  ActionTarget,
  ArtikelState,
  PreviewRow,
  Rounding,
} from "@/lib/artikel/types"
import { cn } from "@/lib/utils"

import { PhotoOrder } from "./photo-order"
import { ScenePicker } from "./scene-picker"
import { money, plural } from "./shared"

// One bulk action, set up and checked before it goes: what to change, which
// listings (the picked ones, a shop, every shop, a tag or a section), and a
// preview of every listing's change worked out from the synced data, prices
// size by size. Nothing reaches Etsy until it's queued.

export type ActionKind = ActionParams["kind"]

const TITLE: Record<ActionKind, string> = {
  price: "Change prices",
  profile: "Apply a price profile",
  section: "Move to a section",
  state: "Activate or deactivate",
  swapPhoto: "Swap a photo",
  reorderPhotos: "Change the photo order",
}

const DESCRIPTION: Record<ActionKind, string> = {
  price: "Every size up or down by a percentage or an amount, rounded to a price ending if you like.",
  profile: "Each size gets the profile's price. Sizes that aren't ours keep theirs.",
  section: "Listings move to the section of this name in their shop; it's made where it's missing.",
  state: "Inactive listings go live again, active ones come off the shop. Drafts, sold-out and expired listings need Etsy itself: publishing or renewing costs a listing fee.",
  swapPhoto: "The photo at one position is made again from the poster in another scene. Only listings our upload pipeline made have the poster.",
  reorderPhotos: "The photos move into the new order; the first is the thumbnail. Listings with fewer photos than you move are left out.",
}

type TargetChoice = { value: string; label: string; group: string; target: ActionTarget }

/** Where an action can go: the picked listings, each shop, every shop, each tag and section. */
export function targetChoices(state: ArtikelState, picked: number[], account: string | null): TargetChoice[] {
  const out: TargetChoice[] = []
  if (picked.length) {
    out.push({ value: "listings", label: plural(picked.length, "selected listing"), group: "Selection", target: { kind: "listings", ids: picked } })
  }
  const shops = account ? state.shops.filter((s) => s.account === account) : state.shops
  for (const s of shops) {
    out.push({
      value: `shop:${s.account}`,
      label: `All of ${s.shop} (${formatNumber(s.listings)})`,
      group: "Shops",
      target: { kind: "shop", account: s.account },
    })
  }
  if (!account && state.shops.length > 1) out.push({ value: "all", label: "Every shop", group: "Shops", target: { kind: "all" } })
  for (const t of state.tags) {
    out.push({ value: `tag:${t.id}`, label: `Tag “${t.name}”`, group: "Internal tags", target: { kind: "tag", tagId: t.id } })
  }
  for (const s of shops) {
    for (const section of s.sections) {
      out.push({
        value: `section:${s.account}:${section.id}`,
        label: `${section.title}${shops.length > 1 ? ` · ${s.shop}` : ""}`,
        group: "Sections",
        target: { kind: "section", account: s.account, sectionId: section.id },
      })
    }
  }
  return out
}

/** A listing of the target to show the photo order with. */
function sampleOf(target: ActionTarget, state: ArtikelState) {
  const rows = state.rows
  switch (target.kind) {
    case "listings":
      return target.ids[0]
    case "shop":
      return rows.find((r) => r.account === target.account)?.listingId
    case "all":
      return rows[0]?.listingId
    case "tag":
      return rows.find((r) => r.tags.includes(target.tagId))?.listingId
    case "section":
      return rows.find((r) => r.account === target.account && r.sectionId === target.sectionId)?.listingId
  }
}

export function ActionDialog({
  kind,
  onClose,
  state,
  choices,
  defaultTarget,
}: {
  kind: ActionKind | null
  onClose: () => void
  state: ArtikelState
  choices: TargetChoice[]
  defaultTarget: string
}) {
  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-3xl">
        {kind && <Form key={kind} kind={kind} state={state} choices={choices} defaultTarget={defaultTarget} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function Form({
  kind,
  state,
  choices,
  defaultTarget,
  onDone,
}: {
  kind: ActionKind
  state: ArtikelState
  choices: TargetChoice[]
  defaultTarget: string
  onDone: () => void
}) {
  const [targetValue, setTargetValue] = React.useState(
    choices.some((c) => c.value === defaultTarget) ? defaultTarget : (choices[0]?.value ?? "")
  )
  const choice = choices.find((c) => c.value === targetValue)
  const [params, setParams] = React.useState<ActionParams | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const request = React.useMemo(
    () => (params && choice ? JSON.stringify({ params, target: choice.target }) : null),
    [params, choice]
  )
  const [preview, setPreview] = React.useState<{ key: string; data?: ActionPreview; error?: string } | null>(null)
  React.useEffect(() => {
    if (!request) return
    let cancelled = false
    const timer = setTimeout(() => {
      const { params, target } = JSON.parse(request) as { params: ActionParams; target: ActionTarget }
      previewAction(params, target).then(
        (data) => !cancelled && setPreview({ key: request, data }),
        (error: Error) => !cancelled && setPreview({ key: request, error: error.message })
      )
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [request])
  const current = request && preview?.key === request ? preview : null
  const data = current?.data

  async function queue() {
    if (!params || !choice) return
    setSubmitting(true)
    try {
      await startAction(params, choice.target)
      toast.success(`Queued: ${data?.label ?? TITLE[kind]}`, {
        description: "It runs in the background; Bulk actions shows how far it got.",
      })
      onDone()
    } catch (error) {
      toast.error(`Couldn't queue it: ${(error as Error).message}`)
    } finally {
      setSubmitting(false)
    }
  }

  const groups = [...new Set(choices.map((c) => c.group))]
  const sample = choice && sampleOf(choice.target, state)

  return (
    <>
      <DialogHeader className="border-b p-4">
        <DialogTitle>{TITLE[kind]}</DialogTitle>
        <DialogDescription>{DESCRIPTION[kind]}</DialogDescription>
      </DialogHeader>

      <div className="flex max-h-[70svh] flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-16 shrink-0 text-muted-foreground">Apply to</span>
          <Select value={targetValue} items={choices} onValueChange={(value) => value && setTargetValue(value)}>
            <SelectTrigger size="sm" className="min-w-64" aria-label="Apply to">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectGroup key={group}>
                  <SelectLabel>{group}</SelectLabel>
                  {choices
                    .filter((c) => c.group === group)
                    .map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        {kind === "price" && <PriceForm onParams={setParams} />}
        {kind === "profile" && <ProfileForm state={state} onParams={setParams} />}
        {kind === "section" && <SectionForm state={state} onParams={setParams} />}
        {kind === "state" && <StateForm onParams={setParams} />}
        {kind === "swapPhoto" && <SwapForm onParams={setParams} />}
        {kind === "reorderPhotos" && <OrderForm sampleId={sample ?? null} onParams={setParams} />}

        <section aria-label="Preview" aria-busy={!!request && !current} className="flex min-h-24 flex-col gap-2 border-t pt-3">
          {!request ? (
            <p className="text-xs text-muted-foreground">Set the change to see what it does.</p>
          ) : current?.error ? (
            <p className="text-xs text-destructive">{current.error}</p>
          ) : !data ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
              Working out the changes…
            </p>
          ) : (
            <Preview preview={data} kind={kind} />
          )}
        </section>
      </div>

      <DialogFooter className="m-0 items-center border-t p-3 sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {data && data.changes > 0
            ? `${plural(data.requests, "Etsy request")}, from each shop's own quota (150 always stay spare).`
            : "Nothing goes to Etsy before you queue it."}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            onClick={queue}
            disabled={!data || data.changes === 0 || data.blocked.length > 0 || submitting}
            className="active:scale-[0.97]"
          >
            {submitting && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
            {data && data.changes > 0 ? `Queue ${plural(data.changes, "change")}` : "Queue"}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}

// --- The forms: each reports its params, or null while incomplete ---

function useReport(params: ActionParams | null, onParams: (params: ActionParams | null) => void) {
  const key = JSON.stringify(params)
  React.useEffect(() => {
    onParams(JSON.parse(key) as ActionParams | null)
  }, [key, onParams])
}

const ROUNDINGS: { value: Rounding; label: string }[] = [
  { value: "none", label: "Exact" },
  { value: "90", label: ".90" },
  { value: "95", label: ".95" },
  { value: "99", label: ".99" },
]

function PriceForm({ onParams }: { onParams: (params: ActionParams | null) => void }) {
  const [direction, setDirection] = React.useState<"up" | "down">("up")
  const [mode, setMode] = React.useState<"percent" | "amount">("percent")
  const [value, setValue] = React.useState("10")
  const [rounding, setRounding] = React.useState<Rounding>("90")
  const n = Number(value.replace(",", "."))
  const valid = Number.isFinite(n) && n > 0
  useReport(
    valid
      ? { kind: "price", mode, value: (direction === "up" ? 1 : -1) * (mode === "amount" ? Math.round(n * 100) : n), rounding }
      : null,
    onParams
  )
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 shrink-0 text-muted-foreground">Change</span>
        <ToggleGroup variant="outline" size="sm" spacing={0} value={[direction]} onValueChange={(v) => v[0] && setDirection(v[0] as "up" | "down")} aria-label="Up or down">
          <ToggleGroupItem value="up">Raise</ToggleGroupItem>
          <ToggleGroupItem value="down">Lower</ToggleGroupItem>
        </ToggleGroup>
        <InputGroup className="h-7 w-28">
          <InputGroupInput
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode="decimal"
            aria-label="By how much"
            aria-invalid={!valid}
            className="tabular-nums"
          />
          <InputGroupAddon align="inline-end">{mode === "percent" ? "%" : "€"}</InputGroupAddon>
        </InputGroup>
        <ToggleGroup variant="outline" size="sm" spacing={0} value={[mode]} onValueChange={(v) => v[0] && setMode(v[0] as "percent" | "amount")} aria-label="Percent or euros">
          <ToggleGroupItem value="percent">%</ToggleGroupItem>
          <ToggleGroupItem value="amount">€</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 shrink-0 text-muted-foreground">Ending</span>
        <ToggleGroup variant="outline" size="sm" spacing={0} value={[rounding]} onValueChange={(v) => v[0] && setRounding(v[0] as Rounding)} aria-label="Price ending">
          {ROUNDINGS.map((r) => (
            <ToggleGroupItem key={r.value} value={r.value} className="tabular-nums">
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="text-xs text-muted-foreground">
          {rounding === "none" ? "Kept to the cent." : `To the nearest price ending .${rounding}, never back past the old price.`}
        </span>
      </div>
    </div>
  )
}

function ProfileForm({ state, onParams }: { state: ArtikelState; onParams: (params: ActionParams | null) => void }) {
  const [profileId, setProfileId] = React.useState(state.profiles.find((p) => p.id === "mid")?.id ?? state.profiles[0]?.id ?? "")
  const items = state.profiles.map((p) => ({ value: p.id, label: p.name }))
  useReport(profileId ? { kind: "profile", profileId } : null, onParams)
  const profile = state.profiles.find((p) => p.id === profileId)
  const prices = profile ? Object.values(profile.prices) : []
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-16 shrink-0 text-muted-foreground">Profile</span>
      <Select value={profileId} items={items} onValueChange={(value) => value && setProfileId(value)}>
        <SelectTrigger size="sm" className="min-w-40" aria-label="Price profile">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {prices.length > 0 && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {money(Math.min(...prices))} to {money(Math.max(...prices))} · edit profiles under Prices
        </span>
      )}
    </div>
  )
}

function SectionForm({ state, onParams }: { state: ArtikelState; onParams: (params: ActionParams | null) => void }) {
  const [title, setTitle] = React.useState("")
  const clean = title.trim()
  useReport(clean && clean.length <= 24 ? { kind: "section", title: clean } : null, onParams)
  const known = [...new Set(state.shops.flatMap((s) => s.sections.map((x) => x.title)))].sort()
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 shrink-0 text-muted-foreground">Section</span>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. City Maps"
          maxLength={24}
          className="h-7 w-56"
          aria-label="Section name"
          autoFocus
        />
      </div>
      {known.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-[4.5rem]">
          {known.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setTitle(name)}
              className={cn(
                "rounded-md border px-1.5 py-0.5 text-xs transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] [@media(hover:hover)]:hover:bg-muted",
                name === clean && "border-brand bg-brand/10"
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function StateForm({ onParams }: { onParams: (params: ActionParams | null) => void }) {
  const [to, setTo] = React.useState<"active" | "inactive">("inactive")
  useReport({ kind: "state", state: to }, onParams)
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-16 shrink-0 text-muted-foreground">Make</span>
      <ToggleGroup variant="outline" size="sm" spacing={0} value={[to]} onValueChange={(v) => v[0] && setTo(v[0] as "active" | "inactive")} aria-label="New state">
        <ToggleGroupItem value="inactive">Inactive</ToggleGroupItem>
        <ToggleGroupItem value="active">Active</ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}

function SwapForm({ onParams }: { onParams: (params: ActionParams | null) => void }) {
  const [rank, setRank] = React.useState(2)
  const [sceneId, setSceneId] = React.useState<string | null>(null)
  useReport(sceneId ? { kind: "swapPhoto", rank, sceneId } : null, onParams)
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 shrink-0 text-muted-foreground">Photo</span>
        <ToggleGroup variant="outline" size="sm" spacing={0} value={[String(rank)]} onValueChange={(v) => v[0] && setRank(Number(v[0]))} aria-label="Which photo">
          {Array.from({ length: 10 }, (_, i) => (
            <ToggleGroupItem key={i} value={String(i + 1)} className="tabular-nums">
              {i + 1}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="text-xs text-muted-foreground">{rank === 1 ? "The thumbnail" : ""}</span>
      </div>
      <div className="flex gap-2">
        <span className="w-16 shrink-0 pt-1 text-muted-foreground">Scene</span>
        <div className="min-w-0 flex-1">
          <ScenePicker value={sceneId} onChange={setSceneId} />
        </div>
      </div>
    </div>
  )
}

function OrderForm({ sampleId, onParams }: { sampleId: number | null; onParams: (params: ActionParams | null) => void }) {
  const [sample, setSample] = React.useState<{ id: number; urls: string[] } | null>(null)
  const count = sample ? Math.max(sample.urls.length, 2) : 10
  const [order, setOrder] = React.useState<number[]>(() => Array.from({ length: 20 }, (_, i) => i + 1))
  React.useEffect(() => {
    if (!sampleId) return
    let cancelled = false
    const today = new Date().toISOString().slice(0, 10)
    fetchDetail(sampleId, { from: today, to: today }).then(
      (detail) => !cancelled && setSample({ id: sampleId, urls: detail.images.map((i) => i.url) }),
      () => {}
    )
    return () => {
      cancelled = true
    }
  }, [sampleId])

  const shown = order.filter((rank) => rank <= count)
  // Only the moved front is sent (photos after it stay where they are), so
  // listings with fewer photos than the sample still take the change.
  let keep = shown.length
  while (keep > 0 && shown[keep - 1] === keep) keep--
  const front = shown.slice(0, keep)
  useReport(front.length ? { kind: "reorderPhotos", order: front } : null, onParams)

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex gap-2">
        <span className="w-16 shrink-0 pt-1 text-muted-foreground">Order</span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <PhotoOrder
            photos={Array.from({ length: count }, (_, i) => ({ rank: i + 1, url: sample?.urls[i] ?? null }))}
            order={shown}
            onChange={(next) => setOrder([...next, ...order.filter((rank) => rank > count)])}
          />
          <p className="text-xs text-muted-foreground">
            {sample ? "Shown with the first listing's photos; every listing moves its own photos the same way." : "Drag the positions into the new order."}
          </p>
        </div>
      </div>
    </div>
  )
}

// --- Preview ---

function Preview({ preview, kind }: { preview: ActionPreview; kind: ActionKind }) {
  const changes = preview.rows.filter((r) => !r.skip)
  const skipped = preview.rows.filter((r) => r.skip)
  const cut = preview.changes + preview.skipped > preview.rows.length
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <span className="font-medium">{plural(preview.changes, "listing")}</span> change
        {preview.skipped > 0 && <span className="text-muted-foreground"> · {formatNumber(preview.skipped)} left as they are</span>}
      </p>
      {preview.blocked.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-300">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
          <span>
            {preview.blocked.join("; ")}. Connect the shop under Settings, then queue: nothing can change on Etsy before.
          </span>
        </p>
      )}
      {kind === "price" || kind === "profile" ? <PriceGroups rows={changes} /> : <ChangeList rows={changes} />}
      {skipped.length > 0 && <Skipped rows={skipped} />}
      {cut && <p className="text-[11px] text-muted-foreground">The first {formatNumber(preview.rows.length)} are shown.</p>}
    </div>
  )
}

/** Listings with the same change, together: one size table each. */
function PriceGroups({ rows }: { rows: PreviewRow[] }) {
  const groups = React.useMemo(() => {
    const map = new Map<string, { prices: NonNullable<PreviewRow["prices"]>; currency: string; rows: PreviewRow[] }>()
    for (const row of rows) {
      if (!row.prices) continue
      const key = `${row.currency}|${row.prices.map((p) => `${p.label}:${p.before}:${p.after}`).join("|")}`
      const group = map.get(key) ?? { prices: row.prices, currency: row.currency ?? "EUR", rows: [] }
      group.rows.push(row)
      map.set(key, group)
    }
    return [...map.values()].sort((a, b) => b.rows.length - a.rows.length)
  }, [rows])

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group, i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-md border p-2">
          <Listings rows={group.rows} />
          <table className="w-full table-fixed text-xs tabular-nums">
            <colgroup>
              <col />
              <col className="w-20" />
              <col className="w-8" />
              <col className="w-20" />
              <col className="w-36" />
            </colgroup>
            <thead className="text-[10px] tracking-wider text-muted-foreground uppercase">
              <tr>
                <th className="pb-1 text-left font-medium">Size</th>
                <th className="pb-1 text-right font-medium">Now</th>
                <th aria-hidden />
                <th className="pb-1 text-right font-medium">New</th>
                <th className="pb-1 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {group.prices.map((p) => {
                const delta = p.after - p.before
                return (
                  <tr key={p.label} className={cn(delta === 0 && "text-muted-foreground")}>
                    <td className="truncate py-0.5 pr-2" title={p.label}>
                      {p.label}
                    </td>
                    <td className="py-0.5 text-right">{money(p.before, group.currency)}</td>
                    <td className="text-center text-muted-foreground">
                      <ArrowRightIcon className="inline size-3" />
                    </td>
                    <td className="py-0.5 text-right font-medium">{money(p.after, group.currency)}</td>
                    <td
                      className={cn(
                        "py-0.5 text-right",
                        delta > 0 ? "text-emerald-600 dark:text-emerald-400" : delta < 0 ? "text-destructive" : undefined
                      )}
                    >
                      {delta === 0
                        ? "—"
                        : `${delta > 0 ? "+" : "−"}${money(Math.abs(delta), group.currency)} (${delta > 0 ? "+" : "−"}${Math.abs((delta / p.before) * 100).toFixed(1)} %)`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

const FEW = 4

/** The listings of a group: a few by name, the rest on request. */
function Listings({ rows }: { rows: PreviewRow[] }) {
  const [all, setAll] = React.useState(false)
  const shown = all ? rows : rows.slice(0, FEW)
  return (
    <p className="text-xs leading-relaxed">
      <span className="font-medium">{plural(rows.length, "listing")}:</span>{" "}
      <span className="text-muted-foreground">
        {shown.map((r) => r.title).join(" · ")}
        {rows.length > FEW && (
          <button type="button" onClick={() => setAll(!all)} className="ml-1 text-foreground underline-offset-2 hover:underline">
            {all ? "fewer" : `and ${formatNumber(rows.length - FEW)} more`}
          </button>
        )}
      </span>
    </p>
  )
}

function ChangeList({ rows }: { rows: PreviewRow[] }) {
  if (!rows.length) return null
  return (
    <ul className="flex flex-col divide-y rounded-md border">
      {rows.slice(0, 100).map((row) => (
        <li key={row.listingId} className="flex items-center gap-2 px-2 py-1 text-xs">
          <span className="relative grid size-7 shrink-0 place-items-center overflow-hidden rounded bg-muted">
            {row.thumb ? (
              <Image src={row.thumb} alt="" fill unoptimized sizes="28px" className="object-cover" />
            ) : (
              <ImageIcon className="size-3 text-muted-foreground" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate">{row.title}</span>
          <span className="shrink-0 text-muted-foreground">{row.change}</span>
        </li>
      ))}
      {rows.length > 100 && (
        <li className="px-2 py-1 text-xs text-muted-foreground">and {formatNumber(rows.length - 100)} more</li>
      )}
    </ul>
  )
}

function Skipped({ rows }: { rows: PreviewRow[] }) {
  const reasons = new Map<string, PreviewRow[]>()
  for (const row of rows) reasons.set(row.skip!, [...(reasons.get(row.skip!) ?? []), row])
  return (
    <details className="group/skipped text-xs">
      <summary className="cursor-pointer text-muted-foreground select-none [@media(hover:hover)]:hover:text-foreground">
        Left as they are: {[...reasons].map(([reason, list]) => `${reason} (${formatNumber(list.length)})`).join(" · ")}
      </summary>
      <ul className="mt-1.5 flex flex-col gap-0.5 pl-3 text-muted-foreground">
        {rows.slice(0, 100).map((row) => (
          <li key={row.listingId} className="truncate">
            {row.title} <span className="text-muted-foreground/70">— {row.skip}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}
