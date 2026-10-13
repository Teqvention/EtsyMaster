"use client"

import Image from "next/image"
import Link from "next/link"
import * as React from "react"
import {
  ArrowRightIcon,
  CheckIcon,
  CircleAlertIcon,
  FlaskConicalIcon,
  ImageIcon,
  LayersIcon,
  LoaderCircleIcon,
  PlusIcon,
  RocketIcon,
  Settings2Icon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { TierBadge } from "@/components/citys/tier"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { fetchCityCopy, posterPreviewUrl, useCityUpload } from "@/hooks/use-city-upload"
import type { CityUploadSettings, CityUploadState, QueueItem, UploadGroupSpec, UploadPlanView } from "@/lib/citys/upload"
import { TIERS, type Tier } from "@/lib/citys/types"
import { cn } from "@/lib/utils"

// Citys → Upload: the city posters approved under Outputs go to our city
// shops, group by group. A group says which styles, which places (tiers,
// open ones only), the composition they're set in and the shop they go to;
// the options say how the queue is ordered. The queue below shows it all
// before anything goes: each poster as it will look, where it goes, which
// old listing's slot it takes. A test run writes down what would go out; a
// start hands the queue to the upload pipeline.

const WORK_TIERS: Tier[] = ["A", "B", "C", "D", "E"]

const newGroup = (account: string, compositionId: string | null): UploadGroupSpec => ({
  id: `g-${Date.now().toString(36)}`,
  styles: [],
  tiers: ["A", "B", "C"],
  openOnly: true,
  compositionId,
  account,
  count: 50,
})

export function UploadView() {
  const up = useCityUpload()
  const [starting, setStarting] = React.useState<"test" | "live" | null>(null)
  const [confirming, setConfirming] = React.useState(false)
  const [preview, setPreview] = React.useState<QueueItem | null>(null)

  if (up.error && !up.state) {
    return (
      <div className="px-4 lg:px-6">
        <Empty className="min-h-[40svh] border border-dashed">
          <EmptyHeader>
            <EmptyTitle>Upload didn&apos;t load</EmptyTitle>
            <EmptyDescription>{up.error}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }
  if (!up.state) {
    return (
      <div className="flex flex-col gap-3 px-4 lg:px-6">
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
        <Skeleton className="h-[40svh] rounded-lg" />
      </div>
    )
  }

  const state = up.state
  const settings = state.settings
  const set = (patch: Partial<CityUploadSettings>) => up.change({ ...settings, ...patch })
  const setGroup = (id: string, patch: Partial<UploadGroupSpec>) => set({ groups: settings.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) })
  const ready = (account: string) => !state.accounts.find((a) => a.id === account)?.missing.length
  const queue = up.plan?.queue ?? []
  const accountsInQueue = [...new Set(queue.map((q) => q.account))]
  const notReady = accountsInQueue.filter((a) => !ready(a))

  async function start(dryRun: boolean) {
    setStarting(dryRun ? "test" : "live")
    try {
      const result = await up.start(dryRun)
      setConfirming(false)
      toast.success(dryRun ? "Test run started" : "City upload started", {
        description: `${result.items} poster${result.items === 1 ? "" : "s"} in the pipeline${result.skipped ? `, ${result.skipped} on their way already` : ""}. Follow it below or under Uploads.`,
      })
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setStarting(null)
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-8 lg:px-6">
      <ShopStrip state={state} />

      <section aria-labelledby="up-groups" className="flex flex-col rounded-lg border">
        <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <h2 id="up-groups" className="text-sm font-semibold">
            Groups
          </h2>
          <span className="text-xs text-muted-foreground">which posters go, how they look and where</span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto active:scale-[0.97]"
            onClick={() => set({ groups: [...settings.groups, newGroup(state.accounts[0]?.id ?? "", state.compositions[0]?.id ?? null)] })}
          >
            <PlusIcon />
            Add group
          </Button>
        </header>
        {settings.groups.length ? (
          <ol className="flex flex-col divide-y">
            {settings.groups.map((group, i) => (
              <GroupRow
                key={group.id}
                index={i}
                group={group}
                state={state}
                plan={up.plan}
                onChange={(patch) => setGroup(group.id, patch)}
                onRemove={() => set({ groups: settings.groups.filter((g) => g.id !== group.id) })}
              />
            ))}
          </ol>
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <div className="grid size-10 place-items-center rounded-full bg-muted">
              <LayersIcon className="size-4 text-muted-foreground" />
            </div>
            <div className="flex max-w-sm flex-col gap-1">
              <p className="text-sm font-medium">No group yet</p>
              <p className="text-xs text-pretty text-muted-foreground">
                A group takes approved posters of some styles, sets them in a composition and sends them to one shop. Best places first.
              </p>
            </div>
            <Button size="sm" onClick={() => set({ groups: [newGroup(state.accounts[0]?.id ?? "", state.compositions[0]?.id ?? null)] })} className="active:scale-[0.97]">
              <PlusIcon />
              Add the first group
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t px-4 py-3">
          <Option checked={settings.adjacent} onChange={(adjacent) => set({ adjacent })} label="A style's posters together" hint="One style after another in the queue, else the groups take turns" />
          <Option checked={settings.oncePerDay} onChange={(oncePerDay) => set({ oncePerDay })} label="A place once a day per shop" hint="With several styles: the second poster of a place waits for tomorrow's upload" />
          <Option checked={settings.slots} onChange={(slots) => set({ slots })} label="Take replace slots first" hint="A place's new poster takes the slot of its old one marked replace; the slot of a place without demand (F) goes to a new place, and those go up first" />
          <Option checked={settings.activate} onChange={(activate) => set({ activate })} label="Live once printable" hint="Put each listing live as soon as its print route is proven, else it waits inactive" />
        </div>
      </section>

      <section aria-labelledby="up-queue" className="flex flex-col rounded-lg border">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
          <h2 id="up-queue" className="text-sm font-semibold">
            Queue
          </h2>
          <QueueSummary plan={up.plan} state={state} planning={up.planning} />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={!queue.length || !!starting} onClick={() => start(true)} className="active:scale-[0.97]" title="Composes, writes the copy, makes print files and mockups, and writes down what would go to Gelato and Etsy: nothing is sent">
              {starting === "test" ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <FlaskConicalIcon />}
              Test run
            </Button>
            {confirming ? (
              <span className="flex items-center gap-2">
                <span className="text-xs">
                  {queue.length} listing{queue.length === 1 ? "" : "s"} on Etsy?
                </span>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => start(false)} disabled={!!starting} className="active:scale-[0.97]">
                  {starting === "live" ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <RocketIcon />}
                  Start
                </Button>
              </span>
            ) : (
              <Button
                size="sm"
                disabled={!queue.length || !!starting || notReady.length > 0 || state.blockers.length > 0}
                onClick={() => setConfirming(true)}
                className="active:scale-[0.97]"
                title={notReady.length ? `${notReady.map((a) => state.accounts.find((x) => x.id === a)?.label ?? a).join(", ")} isn't ready for uploads yet` : state.blockers[0]}
              >
                <RocketIcon />
                Start upload
              </Button>
            )}
          </div>
        </header>
        {up.plan && up.plan.skipped.length > 0 && (
          <p className="border-b px-4 py-2 text-[11px] text-muted-foreground">
            Left out: {up.plan.skipped.map((s) => `${s.count.toLocaleString("en-US")} · ${s.reason.toLowerCase()}`).join(" · ")}
          </p>
        )}
        <QueueList plan={up.plan} state={state} planning={up.planning} onOpen={setPreview} />
      </section>

      <JobsList state={state} onRetire={up.retire} />

      <PosterPreview item={preview} state={state} onClose={() => setPreview(null)} />
    </div>
  )
}

// --- Shops ---

function ShopStrip({ state }: { state: CityUploadState }) {
  return (
    <section aria-label="City shops" className="grid gap-2 sm:grid-cols-2">
      {state.accounts.map((a) => (
        <div key={a.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
          <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", a.missing.length ? "bg-amber-500/12 text-amber-700 dark:text-amber-400" : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400")}>
            {a.missing.length ? <CircleAlertIcon className="size-4" /> : <CheckIcon className="size-4" />}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{a.shop ?? a.label}</span>
            <span className="truncate text-[11px] text-muted-foreground tabular-nums">
              {a.listings.toLocaleString("en-US")} listings · {a.slots.toLocaleString("en-US")} slots to replace
              {a.missing.length > 0 && <span className="text-amber-700 dark:text-amber-400"> · needs {a.missing.join(", ")}</span>}
            </span>
          </span>
          {a.missing.length > 0 && (
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/settings" />} className="shrink-0">
              <Settings2Icon />
              Settings
            </Button>
          )}
        </div>
      ))}
      {state.blockers.map((b) => (
        <p key={b} className="flex items-center gap-1.5 text-xs text-amber-700 sm:col-span-2 dark:text-amber-400">
          <CircleAlertIcon className="size-3.5" />
          {b}
        </p>
      ))}
    </section>
  )
}

function Option({ checked, onChange, label, hint }: { checked: boolean; onChange: (checked: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs" title={hint}>
      <Switch checked={checked} onCheckedChange={onChange} size="sm" />
      {label}
    </label>
  )
}

// --- One group ---

function GroupRow({
  index,
  group,
  state,
  plan,
  onChange,
  onRemove,
}: {
  index: number
  group: UploadGroupSpec
  state: CityUploadState
  plan: UploadPlanView | null
  onChange: (patch: Partial<UploadGroupSpec>) => void
  onRemove: () => void
}) {
  const taken = plan?.queue.filter((q) => q.group === group.id).length ?? null
  const composition = state.compositions.find((c) => c.id === group.compositionId) ?? null
  return (
    <li className="grid gap-x-6 gap-y-3 px-4 py-3 lg:grid-cols-[2rem_minmax(0,1.4fr)_minmax(0,1fr)_auto]">
      <span className="hidden pt-1 text-xs font-medium text-muted-foreground tabular-nums lg:block">{index + 1}</span>

      <div className="flex min-w-0 flex-col gap-2.5">
        <Field label="Styles">
          <StylePicker group={group} state={state} onChange={(styles) => onChange({ styles })} />
        </Field>
        <Field label="Places">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Tiers">
              {WORK_TIERS.map((tier) => {
                const on = group.tiers.length ? group.tiers.includes(tier) : true
                return (
                  <button
                    key={tier}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const current = group.tiers.length ? group.tiers : WORK_TIERS
                      const next = on ? current.filter((t) => t !== tier) : [...current, tier]
                      onChange({ tiers: next.length ? TIERS.filter((t) => next.includes(t)) : [tier] })
                    }}
                    className={cn(
                      "grid h-7 w-8 place-items-center border-r text-xs font-semibold tabular-nums transition-[background-color,color] duration-150 last:border-r-0 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                      on ? "bg-foreground text-background" : "text-muted-foreground [@media(hover:hover)]:hover:bg-muted"
                    )}
                  >
                    {tier}
                  </button>
                )
              })}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Switch checked={group.openOnly} onCheckedChange={(openOnly) => onChange({ openOnly })} size="sm" />
              Open places only
            </label>
          </div>
        </Field>
      </div>

      <div className="flex min-w-0 flex-col gap-2.5">
        <Field label="Composition">
          <div className="flex items-center gap-2">
            <span className="relative grid h-10 w-8 shrink-0 place-items-center overflow-hidden rounded border bg-muted">
              {composition ? <Image src={composition.preview} alt="" fill unoptimized sizes="32px" className="object-cover" /> : <ImageIcon className="size-3.5 text-muted-foreground" />}
            </span>
            <Select
              value={group.compositionId ?? "none"}
              items={[{ value: "none", label: "The photo alone" }, ...state.compositions.map((c) => ({ value: c.id, label: c.name }))]}
              onValueChange={(value) => value && onChange({ compositionId: value === "none" ? null : value })}
            >
              <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Composition">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">The photo alone</SelectItem>
                {state.compositions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Field>
        <Field label="Shop">
          <div className="flex items-center gap-2">
            <Select
              value={group.account || null}
              items={state.accounts.map((a) => ({ value: a.id, label: a.shop ?? a.label }))}
              onValueChange={(value) => value && onChange({ account: value })}
            >
              <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Shop">
                <SelectValue placeholder="Pick a shop" />
              </SelectTrigger>
              <SelectContent>
                {state.accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.shop ?? a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              up to
              <Input
                type="number"
                min={1}
                max={500}
                value={group.count}
                onChange={(e) => onChange({ count: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })}
                className="h-8 w-16 text-right tabular-nums"
                aria-label="Posters at most"
              />
            </label>
          </div>
        </Field>
      </div>

      <div className="flex items-start justify-between gap-2 lg:flex-col lg:items-end">
        <span className="text-xs text-muted-foreground tabular-nums">{taken === null ? "…" : `${taken} in the queue`}</span>
        <Button variant="ghost" size="icon-sm" aria-label="Remove the group" className="text-muted-foreground" onClick={onRemove}>
          <Trash2Icon />
        </Button>
      </div>
    </li>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{label}</span>
      {children}
    </div>
  )
}

function StylePicker({ group, state, onChange }: { group: UploadGroupSpec; state: CityUploadState; onChange: (styles: string[]) => void }) {
  const picked = new Set(group.styles)
  const label = !group.styles.length
    ? "Every style"
    : group.styles.map((key) => state.styles.find((s) => s.key === key)?.label ?? key).join(", ")
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="h-8 min-w-0 justify-start font-normal active:scale-[0.97]" />}>
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-0 p-1.5">
        <button
          type="button"
          onClick={() => onChange([])}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs [@media(hover:hover)]:hover:bg-muted"
        >
          <span className="grid size-4 place-items-center">{!group.styles.length && <CheckIcon className="size-3.5" />}</span>
          Every style
        </button>
        {state.styles.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onChange(picked.has(s.key) ? group.styles.filter((k) => k !== s.key) : [...group.styles, s.key])}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs [@media(hover:hover)]:hover:bg-muted"
          >
            <span className="grid size-4 place-items-center">{picked.has(s.key) && <CheckIcon className="size-3.5" />}</span>
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{s.approved} approved</span>
          </button>
        ))}
        {!state.styles.length && <p className="px-2 py-3 text-center text-xs text-muted-foreground">No city posters made yet: make them in the Stealer.</p>}
      </PopoverContent>
    </Popover>
  )
}

// --- The queue ---

function QueueSummary({ plan, state, planning }: { plan: UploadPlanView | null; state: CityUploadState; planning: boolean }) {
  if (!plan) return <span className="text-xs text-muted-foreground">Planning…</span>
  const byAccount = new Map<string, number>()
  for (const q of plan.queue) byAccount.set(q.account, (byAccount.get(q.account) ?? 0) + 1)
  return (
    <span className={cn("flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular-nums transition-opacity duration-150", planning && "opacity-60")}>
      <span className="font-medium text-foreground">
        {plan.queue.length.toLocaleString("en-US")} poster{plan.queue.length === 1 ? "" : "s"}
      </span>
      {[...byAccount].map(([account, n]) => {
        const shop = state.accounts.find((a) => a.id === account)
        const slots = plan.slots[account]
        return (
          <span key={account}>
            · {shop?.shop ?? account} {n}
            {slots?.used ? `, ${slots.used} of ${slots.free} replace slots` : ""}
          </span>
        )
      })}
    </span>
  )
}

function QueueList({ plan, state, planning, onOpen }: { plan: UploadPlanView | null; state: CityUploadState; planning: boolean; onOpen: (item: QueueItem) => void }) {
  if (!plan) {
    return (
      <div className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="aspect-[3/4] rounded-md" />
        ))}
      </div>
    )
  }
  if (!plan.queue.length) {
    return (
      <Empty className="min-h-56 border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ImageIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing to upload</EmptyTitle>
          <EmptyDescription>
            {state.settings.groups.length ? "No approved poster fits the groups: approve city posters under Outputs, or widen a group's styles or tiers." : "Add a group to plan the queue."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/citys/outputs" />}>
            Outputs
            <ArrowRightIcon />
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
  return (
    <ol className={cn("grid gap-x-3 gap-y-4 p-4 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]", planning && "opacity-70")}>
      {plan.queue.slice(0, 120).map((item, i) => (
        <li key={item.key}>
          <button type="button" onClick={() => onOpen(item)} className="group/tile flex w-full flex-col gap-1.5 text-left outline-none">
            <span className="relative block aspect-[3/4] overflow-hidden rounded-md bg-muted ring-1 ring-border transition-transform duration-150 ease-out group-focus-visible/tile:ring-2 group-focus-visible/tile:ring-ring group-active/tile:scale-[0.98]">
              <Image src={posterPreviewUrl(item.setId, item.outputId, item.compositionId, 320)} alt="" fill unoptimized sizes="160px" className="object-cover" loading="lazy" />
              <span className="absolute bottom-1.5 left-1.5 rounded bg-background/90 px-1 text-[10px] font-medium tabular-nums shadow-sm">{i + 1}</span>
              {item.replaces && (
                <span
                  className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded bg-background/90 py-0.5 pr-1.5 pl-0.5 text-[10px] shadow-sm"
                  title={item.replaces.why === "same place" ? `Replaces our old poster “${item.replaces.title}”` : `Full replacement: a new place in the slot of “${item.replaces.title}”`}
                >
                  {item.replaces.image && (
                    <span className="relative block size-4 overflow-hidden rounded-sm">
                      <Image src={item.replaces.image} alt="" fill unoptimized sizes="16px" className="object-cover" />
                    </span>
                  )}
                  {item.replaces.why === "same place" ? "replaces" : "full swap"}
                </span>
              )}
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              {item.tier && <TierBadge tier={item.tier} className="size-[18px] text-[10px]" />}
              <span className="truncate text-xs font-medium">{item.place}</span>
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {item.styleLabel} · {state.accounts.find((a) => a.id === item.account)?.shop ?? item.account}
            </span>
          </button>
        </li>
      ))}
      {plan.queue.length > 120 && (
        <li className="grid aspect-[3/4] place-items-center rounded-md border border-dashed text-center text-xs text-muted-foreground">
          and {(plan.queue.length - 120).toLocaleString("en-US")} more
        </li>
      )}
    </ol>
  )
}

function PosterPreview({ item, state, onClose }: { item: QueueItem | null; state: CityUploadState; onClose: () => void }) {
  const [copy, setCopy] = React.useState<{ title: string; tags: string[]; description: string } | null>(null)
  const [writing, setWriting] = React.useState(false)
  // Another poster: its copy isn't written yet.
  const [copyFor, setCopyFor] = React.useState(item?.key)
  if (copyFor !== item?.key) {
    setCopyFor(item?.key)
    setCopy(null)
  }

  async function write() {
    if (!item) return
    setWriting(true)
    try {
      setCopy(await fetchCityCopy(item.setId, item.outputId))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setWriting(false)
    }
  }

  const composition = state.compositions.find((c) => c.id === item?.compositionId)
  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl gap-0 p-0 sm:max-w-4xl">
        {item && (
          <div className="grid max-h-[85svh] md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="flex items-center justify-center bg-muted/60 p-6">
              <Image
                src={posterPreviewUrl(item.setId, item.outputId, item.compositionId, 900)}
                alt={`${item.place} poster`}
                width={450}
                height={600}
                unoptimized
                className="h-auto max-h-[70svh] w-auto rounded-sm shadow-lg"
              />
            </div>
            <div className="flex min-w-0 flex-col gap-4 overflow-y-auto p-5">
              <DialogHeader className="gap-1">
                <DialogTitle className="flex items-center gap-2">
                  {item.tier && <TierBadge tier={item.tier} />}
                  {item.place}
                  <span className="text-sm font-normal text-muted-foreground">{item.country}</span>
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {item.styleLabel} · {item.detail} · {composition ? composition.name : "the photo alone"} · to {state.accounts.find((a) => a.id === item.account)?.shop ?? item.account}
                </DialogDescription>
              </DialogHeader>
              {item.replaces && (
                <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                  {item.replaces.image && (
                    <span className="relative block size-10 shrink-0 overflow-hidden rounded">
                      <Image src={item.replaces.image} alt="" fill unoptimized sizes="40px" className="object-cover" />
                    </span>
                  )}
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[11px] text-muted-foreground">{item.replaces.why === "same place" ? "Replaces our old poster of the place" : "Full replacement, a new place in the slot of"}</span>
                    <span className="truncate text-xs">{item.replaces.title}</span>
                  </span>
                </div>
              )}
              {copy ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm leading-snug font-medium text-pretty">{copy.title}</p>
                  <div className="flex flex-wrap gap-1">
                    {copy.tags.map((t) => (
                      <span key={t} className="inline-flex h-5 items-center rounded bg-muted px-1.5 text-[11px] text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-pretty">
                    {copy.description.split(/\n\s*\n/).map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Kept for the upload: the shop&apos;s blocks (sizes, shipping) follow the story on Etsy.</p>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-2 rounded-md border border-dashed p-4">
                  <p className="text-xs text-muted-foreground">The copy is written when the poster goes up. See it now, written by the keyword strategy:</p>
                  <Button variant="outline" size="sm" onClick={write} disabled={writing} className="active:scale-[0.97]">
                    {writing && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
                    Write the copy
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// --- Under way ---

function JobsList({ state, onRetire }: { state: CityUploadState; onRetire: (ids: number[]) => Promise<{ retired: number }> }) {
  const [busy, setBusy] = React.useState<string | null>(null)
  if (!state.jobs.length) return null
  return (
    <section aria-labelledby="up-jobs" className="flex flex-col rounded-lg border">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <h2 id="up-jobs" className="text-sm font-semibold">
          City uploads
        </h2>
        <Link href="/uploads" className="ml-auto text-xs text-muted-foreground underline-offset-2 [@media(hover:hover)]:hover:underline">
          Every stage under Uploads
        </Link>
      </header>
      <ul className="flex flex-col divide-y">
        {state.jobs.map((job) => (
          <li key={job.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-xs">
            <span className="font-medium tabular-nums">{new Date(job.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            {job.dryRun && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Test run</span>}
            <span className="flex h-1.5 w-40 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${job.live} of ${job.total} done`}>
              <span className="h-full bg-emerald-500" style={{ width: `${(job.live / job.total) * 100}%` }} />
              <span className="h-full bg-destructive" style={{ width: `${(job.failed / job.total) * 100}%` }} />
            </span>
            <span className="text-muted-foreground tabular-nums">
              {job.live} of {job.total} {job.dryRun ? "through" : "live"}
              {job.running > 0 && ` · ${job.running} under way`}
              {job.failed > 0 && <span className="text-destructive"> · {job.failed} failed</span>}
            </span>
            {job.outdated > 0 && (
              <span className="text-amber-700 dark:text-amber-400">The server doing the uploads runs a version without city uploads: update it, then retry under Uploads.</span>
            )}
            {job.toRetire.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto active:scale-[0.97]"
                disabled={busy === job.id}
                onClick={async () => {
                  setBusy(job.id)
                  try {
                    const { retired } = await onRetire(job.toRetire.map((r) => r.listingId))
                    toast.success(`${retired} old listing${retired === 1 ? "" : "s"} going inactive`, { description: "Artikel runs it as a bulk action." })
                  } catch (error) {
                    toast.error((error as Error).message)
                  } finally {
                    setBusy(null)
                  }
                }}
                title={job.toRetire.map((r) => r.title).join("\n")}
              >
                {busy === job.id ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <XIcon />}
                Deactivate {job.toRetire.length} replaced
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
