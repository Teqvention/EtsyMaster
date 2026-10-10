"use client"

import Link from "next/link"
import * as React from "react"
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  FlaskConicalIcon,
  LoaderCircleIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"

import { shortTitle } from "@/components/generation/parts"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { uploadAccounts, useAccounts } from "@/hooks/use-accounts"
import { useEtsyUsage } from "@/hooks/use-etsy-usage"
import { startUpload, usePipeline } from "@/hooks/use-pipeline"
import { removePosters, restorePosters } from "@/hooks/use-uploads"
import type { AccountView } from "@/lib/accounts/types"
import type { EtsyUsage } from "@/lib/etsy/usage"
import { formatNumber } from "@/lib/etsy/format"
import type { MockupChain } from "@/lib/mockups/chain-types"
import type { UploadPlan } from "@/lib/pipeline/types"
import {
  alikePairs,
  allowedFor,
  place,
  planGroups,
  type Allowed,
  type Assignment,
  type Placeable,
  type SpreadMode,
} from "@/lib/uploads/distribute"
import { canUpload, posterKey, statusOf, type PosterStatus, type PosterUploads } from "@/lib/uploads/groups"
import type { GroupPoster, UploadGroup } from "@/lib/uploads/types"
import { cn } from "@/lib/utils"

// The one click that puts posters on Etsy: which posters go (whole
// reference photos, or single posters), and how they're shared out between
// the upload accounts. A preset says which accounts each group may go to;
// the posters are then placed so every account gets its share and alike
// motifs land in different shops. The columns are exactly what the job gets,
// and any poster can still be moved by hand: click it for the next account,
// drag it, or focus it and press the account's number. The bin at the top
// switches to deleting instead: posters picked then leave the uploads.

const PRESETS: { mode: SpreadMode; label: string; hint: string }[] = [
  { mode: "one", label: "One account", hint: "Every poster goes to one shop." },
  {
    mode: "groups",
    label: "Groups to accounts",
    hint: "Each reference photo's posters stay together; whole groups are shared out so the shops get about as many.",
  },
  {
    mode: "even",
    label: "Even split",
    hint: "Every group is spread evenly over the shops, and alike motifs land in different ones.",
  },
  { mode: "mixed", label: "Mixed", hint: "Choose per group: spread evenly, or all to one shop." },
]

/** About this many Etsy requests make one listing: setting it right, ten photos, a video, the checks. */
const CALLS_PER_LISTING = 20
const SPLIT = "split"
const NO_CHAIN = "none"
const DRAG = "application/x-upload-poster"

const nameOf = (a: AccountView) => a.shop?.name ?? a.label
const plural = (n: number, word: string) => `${formatNumber(n)} ${word}${n === 1 ? "" : "s"}`
const ratio = (p: GroupPoster) => (p.posterWidth && p.posterHeight ? `${p.posterWidth} / ${p.posterHeight}` : "3 / 4")

const NOT_FREE: Partial<Record<PosterStatus, string>> = {
  live: "Already on Etsy",
  uploading: "Uploading now",
  failed: "Its upload failed: retry that one rather than start it again",
  uploaded: "Marked as uploaded",
}

export function UploadDialog({
  open,
  onOpenChange,
  groups,
  chains,
  uploads,
  start,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: UploadGroup[]
  chains: MockupChain[]
  uploads: PosterUploads
  /** A group id or poster key to begin with; null picks every poster that may go. */
  start: string | null
}) {
  // Focus starts on the form itself: its keys work at once, and Enter can't start an upload by accident.
  const formRef = React.useRef<HTMLFormElement>(null)
  // Set while deleting: Escape ends that first, and only then closes.
  const onEscape = React.useRef<(() => void) | null>(null)
  const setEscape = React.useCallback((handler: (() => void) | null) => {
    onEscape.current = handler
  }, [])
  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (!next && details.reason === "escape-key" && onEscape.current) return onEscape.current()
        onOpenChange(next)
      }}
    >
      <DialogContent className="gap-0 p-0 sm:max-w-5xl" initialFocus={formRef}>
        {open && (
          <Form
            formRef={formRef}
            setEscape={setEscape}
            groups={groups}
            chains={chains}
            uploads={uploads}
            start={start}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** `before` with `keys` added (or taken out). */
function toggled(before: Set<string>, keys: string[], on: boolean) {
  const next = new Set(before)
  for (const key of keys) {
    if (on) next.add(key)
    else next.delete(key)
  }
  return next
}

/** Every poster that may go into a new job, by key. */
function freeKeys(groups: UploadGroup[], uploads: PosterUploads) {
  const keys = new Set<string>()
  for (const g of groups) {
    for (const p of g.posters) {
      const key = posterKey(g.id, p.outputId)
      if (canUpload(uploads, key, p.state)) keys.add(key)
    }
  }
  return keys
}

/** What's picked to begin with: one poster, one group's, or everything that may go. */
function firstPick(free: Set<string>, start: string | null) {
  if (!start) return new Set(free)
  return new Set([...free].filter((key) => key === start || key.startsWith(`${start}/`)))
}

function Form({
  formRef,
  setEscape,
  groups,
  chains,
  uploads,
  start,
  onDone,
}: {
  formRef: React.RefObject<HTMLFormElement | null>
  setEscape: (handler: (() => void) | null) => void
  groups: UploadGroup[]
  chains: MockupChain[]
  uploads: PosterUploads
  start: string | null
  onDone: () => void
}) {
  const accountsState = useAccounts()
  const { pipeline, available } = usePipeline()
  const { state: usage } = useEtsyUsage()

  const accounts = React.useMemo(() => uploadAccounts(accountsState), [accountsState])
  const blockers = pipeline?.blockers ?? []
  const ready = accounts.filter((a) => a.missing.length === 0)
  const liveOk = ready.length > 0 && blockers.length === 0

  const free = React.useMemo(() => freeKeys(groups, uploads), [groups, uploads])
  const [picked, setPicked] = React.useState(() => firstPick(free, start))
  const [modeChoice, setModeChoice] = React.useState<SpreadMode | null>(null)
  const [one, setOne] = React.useState<string | null>(null)
  const [perGroup, setPerGroup] = React.useState<Record<string, string>>({})
  const [moved, setMoved] = React.useState<Assignment>({})
  const [activate, setActivate] = React.useState(true)
  const [testChoice, setTestChoice] = React.useState<boolean | null>(null)
  const [chainChoice, setChainChoice] = React.useState<Record<string, string | null>>({})
  const [busy, setBusy] = React.useState(false)
  // Delete mode: the posters marked to go; null while uploading.
  const [deleting, setDeleting] = React.useState<Set<string> | null>(null)

  React.useEffect(() => {
    setEscape(deleting ? () => setDeleting(null) : null)
    return () => setEscape(null)
  }, [deleting, setEscape])

  // Live uploads need an account that's set up and a pipeline without
  // blockers; until then it's test runs, which every upload account can take.
  const testRun = !liveOk || (testChoice ?? false)
  const usable = React.useMemo(
    () => accounts.filter((a) => testRun || a.missing.length === 0),
    [accounts, testRun]
  )
  const ids = React.useMemo(() => usable.map((a) => a.id), [usable])
  const mode = modeChoice ?? (ids.length > 1 ? "even" : "one")
  const oneId = one && ids.includes(one) ? one : (ids[0] ?? null)

  const posters = React.useMemo<Placeable[]>(
    () =>
      groups.flatMap((g) =>
        g.posters
          .map((p) => ({ key: posterKey(g.id, p.outputId), groupId: g.id, outputId: p.outputId, motif: p.motif }))
          .filter((p) => picked.has(p.key) && free.has(p.key))
      ),
    [groups, picked, free]
  )
  const mixed = React.useMemo<Allowed>(
    () =>
      Object.fromEntries(
        Object.entries(perGroup)
          .filter(([, to]) => to !== SPLIT)
          .map(([group, to]) => [group, [to]])
      ),
    [perGroup]
  )
  const assignment = React.useMemo(() => {
    const placed = place(posters, allowedFor(mode, posters, ids, { one: oneId, mixed }), ids)
    for (const [key, to] of Object.entries(moved)) if (placed[key] && ids.includes(to)) placed[key] = to
    return placed
  }, [posters, mode, ids, oneId, mixed, moved])
  const alikeOf = React.useMemo(() => {
    const map = new Map<string, string[]>()
    for (const list of Object.values(alikePairs(posters, assignment))) {
      for (const [a, b] of list) {
        map.set(a, [...(map.get(a) ?? []), b])
        map.set(b, [...(map.get(b) ?? []), a])
      }
    }
    return map
  }, [posters, assignment])
  const posterOf = React.useMemo(
    () => new Map(groups.flatMap((g) => g.posters.map((p) => [posterKey(g.id, p.outputId), p] as const))),
    [groups]
  )

  const byAccount = new Map<string, Placeable[]>(accounts.map((a) => [a.id, []]))
  for (const p of posters) byAccount.get(assignment[p.key])?.push(p)
  const movedCount = posters.filter((p) => moved[p.key] && assignment[p.key] === moved[p.key]).length
  const shops = [...byAccount.values()].filter((list) => list.length > 0).length

  const defaultChain = chains.find((c) => c.isDefault) ?? chains[0] ?? null
  const chainOf = (a: AccountView) =>
    a.id in chainChoice
      ? chainChoice[a.id]
      : chains.some((c) => c.id === a.chainId)
        ? a.chainId
        : (defaultChain?.id ?? null)

  const reason = !available
    ? "The upload pipeline isn't running on the server yet"
    : accountsState === null
      ? "Loading the accounts…"
      : accounts.length === 0
        ? "Add an upload account in Settings first"
        : ids.length === 0
          ? "No account is ready for live uploads"
          : posters.length === 0
            ? "Pick the posters to upload"
            : null

  function setMode(next: SpreadMode) {
    setModeChoice(next)
    setMoved({})
  }

  function move(key: string, to: string) {
    setMoved((m) => ({ ...m, [key]: to }))
  }

  /** Keeps the keyboard on a poster that just moved to another column. */
  function refocus(key: string) {
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>(`[data-thumb="${CSS.escape(key)}"]`)?.focus()
    )
  }

  function togglePick(keys: string[], on: boolean) {
    setPicked((before) => toggled(before, keys, on))
  }

  function toggleDelete(keys: string[], on: boolean) {
    setDeleting((before) => before && toggled(before, keys, on))
  }

  async function confirmDelete() {
    if (!deleting?.size || busy) return
    const keys = [...deleting]
    setBusy(true)
    try {
      await removePosters(keys)
      toast(`Deleted ${plural(keys.length, "poster")}`, {
        description: "Out of the uploads and no longer approved.",
        action: {
          label: "Undo",
          onClick: () => restorePosters(keys).catch((error) => toast.error(`Couldn't bring them back: ${error.message}`)),
        },
      })
      setDeleting(null)
      formRef.current?.focus()
    } catch (error) {
      toast.error(`Couldn't delete: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  function onThumbKey(event: React.KeyboardEvent, key: string) {
    if (event.metaKey || event.ctrlKey || event.altKey || deleting) return
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault()
      togglePick([key], false)
      // Its thumb is gone; the form keeps the keys working.
      formRef.current?.focus()
      return
    }
    const at = ids.indexOf(assignment[key])
    const to = /^[1-9]$/.test(event.key)
      ? accounts[Number(event.key) - 1]?.id
      : event.key === "ArrowRight"
        ? ids[at + 1]
        : event.key === "ArrowLeft"
          ? ids[at - 1]
          : undefined
    if (!to || !ids.includes(to)) return
    event.preventDefault()
    if (to === assignment[key]) return
    move(key, to)
    refocus(key)
  }

  async function submit() {
    if (reason || busy || deleting) return
    const plan: UploadPlan = {
      groups: planGroups(posters, assignment),
      chains: Object.fromEntries(usable.filter((a) => byAccount.get(a.id)?.length).map((a) => [a.id, chainOf(a)])),
      activate,
      dryRun: testRun,
    }
    setBusy(true)
    try {
      await startUpload(plan)
      const count = plural(posters.length, "poster")
      toast(testRun ? `Test run of ${count} started` : `Uploading ${count}`, {
        description: testRun
          ? "Everything is made here; nothing is sent to Etsy or Gelato."
          : `To ${plural(shops, "shop")}. ${activate ? "Each goes live once its print route is proven." : "They stay inactive for a look."}`,
      })
      onDone()
    } catch (error) {
      toast.error(`Couldn't start: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.defaultPrevented) return
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
      return
    }
    if (event.metaKey || event.ctrlKey || event.altKey || !/^[1-4]$/.test(event.key)) return
    const target = event.target as HTMLElement
    if (target.closest("input, textarea, [role=combobox], [role=listbox], [data-thumb]")) return
    event.preventDefault()
    setMode(PRESETS[Number(event.key) - 1].mode)
  }

  const preset = PRESETS.find((p) => p.mode === mode)!

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      onKeyDown={onKeyDown}
      tabIndex={-1}
      // min-w-0: a long title mustn't size the dialog's grid column.
      className="flex max-h-[min(90svh,60rem)] min-w-0 flex-col outline-none"
    >
      <DialogHeader className="flex-row items-center gap-3 border-b p-4 pr-12">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <DialogTitle>{deleting ? "Delete posters" : "Upload posters"}</DialogTitle>
          <DialogDescription>
            {deleting
              ? "Pick the posters to delete, here or on the left: they leave the uploads and lose their approval."
              : "Which posters go up, and how they’re shared out between the shops."}
          </DialogDescription>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-pressed={!!deleting}
                aria-label="Delete posters"
                disabled={free.size === 0 && !deleting}
                onClick={() => setDeleting((before) => (before ? null : new Set()))}
                className="aria-pressed:bg-destructive/10 aria-pressed:text-destructive"
              />
            }
          >
            <Trash2Icon />
          </TooltipTrigger>
          <TooltipContent>{deleting ? "Back to uploading" : "Delete posters"}</TooltipContent>
        </Tooltip>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[19rem_minmax(0,1fr)] md:overflow-hidden">
        <Picker
          groups={groups}
          uploads={uploads}
          free={free}
          picked={deleting ?? picked}
          deleting={!!deleting}
          start={start}
          mode={mode}
          usable={usable}
          perGroup={perGroup}
          onPick={deleting ? toggleDelete : togglePick}
          onPickAll={() => (deleting ? setDeleting(new Set(free)) : setPicked(new Set(free)))}
          onPickNone={() => (deleting ? setDeleting(new Set()) : setPicked(new Set()))}
          onGroupTarget={(group, to) => {
            setPerGroup((p) => ({ ...p, [group]: to }))
            setMoved({})
          }}
        />

        <div className="flex min-h-0 min-w-0 flex-col md:overflow-y-auto">
          <div className="flex flex-col gap-2 border-b p-4">
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                variant="outline"
                size="sm"
                spacing={0}
                value={[mode]}
                onValueChange={(value) => value[0] && setMode(value[0] as SpreadMode)}
                aria-label="How the posters are shared out"
              >
                {PRESETS.map((p, i) => (
                  <ToggleGroupItem
                    key={p.mode}
                    value={p.mode}
                    className="gap-1.5 px-2.5 text-muted-foreground aria-pressed:text-foreground"
                  >
                    {p.label}
                    <Kbd className="hidden h-4 min-w-4 text-[10px] lg:inline-flex">{i + 1}</Kbd>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {mode === "one" && usable.length > 1 && (
                <Select
                  value={oneId}
                  items={usable.map((a) => ({ value: a.id, label: nameOf(a) }))}
                  onValueChange={(value) => {
                    if (!value) return
                    setOne(value)
                    setMoved({})
                  }}
                >
                  <SelectTrigger size="sm" className="min-w-36" aria-label="The account">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {usable.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {nameOf(a)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{preset.hint}</p>
          </div>

          <div className="flex flex-col gap-3 p-4">
            {accountsState === null ? (
              <div className="grid grid-cols-3 gap-3" aria-busy aria-label="Loading the accounts">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-48 rounded-xl" />
                ))}
              </div>
            ) : accounts.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-10 text-center">
                <p className="text-sm font-medium">No upload accounts yet</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Add the shops the posters go to in Settings: each needs its Etsy app, the shop owner&apos;s
                  sign in and a Gelato store.
                </p>
                <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/settings" />}>
                  Open Settings
                  <ArrowRightIcon />
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
                {accounts.map((account, index) => (
                  <Column
                    key={account.id}
                    account={account}
                    index={index}
                    usable={ids.includes(account.id)}
                    testRun={testRun}
                    posters={byAccount.get(account.id) ?? []}
                    posterOf={posterOf}
                    alikeOf={alikeOf}
                    moved={moved}
                    deleting={deleting}
                    chains={chains}
                    chain={chainOf(account)}
                    onChain={(chain) => setChainChoice((c) => ({ ...c, [account.id]: chain }))}
                    keys={accounts.length}
                    usage={usage?.accounts.find((u) => u.id === account.id)?.usage ?? null}
                    onDrop={(key) => {
                      if (ids.includes(account.id) && assignment[key] !== account.id) move(key, account.id)
                    }}
                    onCycle={(key) => {
                      if (deleting) return toggleDelete([key], !deleting.has(key))
                      if (ids.length < 2) return
                      move(key, ids[(ids.indexOf(assignment[key]) + 1) % ids.length])
                    }}
                    onThumbKey={onThumbKey}
                  />
                ))}
              </div>
            )}
            {movedCount > 0 && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {plural(movedCount, "poster")} moved by hand ·{" "}
                <button
                  type="button"
                  onClick={() => setMoved({})}
                  className="rounded-sm underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:text-foreground"
                >
                  Reset
                </button>
              </p>
            )}
          </div>

          <div className="mt-auto flex flex-col gap-3 border-t p-4">
            <Option
              title="Go live when ready"
              hint={
                activate
                  ? "Each listing goes live once its print route is proven, with our photos first."
                  : "Listings wait inactive on Etsy for a look; activate them there."
              }
              checked={activate}
              onCheckedChange={setActivate}
            />
            <Option
              title="Test run"
              hint={
                liveOk
                  ? "Copy, print files, mockups and the requests are all made here, but nothing is sent to Etsy or Gelato."
                  : undefined
              }
              checked={testRun}
              onCheckedChange={(on) => setTestChoice(on)}
              disabled={!liveOk}
            >
              {!liveOk && <LiveBlocked accounts={accounts} ready={ready.length} blockers={blockers} />}
            </Option>
          </div>
        </div>
      </div>

      {deleting ? (
        <DialogFooter className="m-0 flex-row items-center gap-3 rounded-b-xl border-t bg-muted/40 p-3 sm:justify-between">
          <p className="min-w-0 text-xs text-muted-foreground tabular-nums">
            {deleting.size === 0 ? (
              "Pick the posters to delete"
            ) : (
              <>
                <span className="font-medium text-foreground">{plural(deleting.size, "poster")}</span> to delete ·
                they can be restored from the deleted list
              </>
            )}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => setDeleting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting.size === 0 || busy}
              className="transition-transform duration-150 ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
            >
              {busy ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <Trash2Icon />}
              Delete {deleting.size > 0 ? formatNumber(deleting.size) : ""}
            </Button>
          </div>
        </DialogFooter>
      ) : (
        <DialogFooter className="m-0 flex-row items-center gap-3 rounded-b-xl border-t bg-muted/40 p-3 sm:justify-between">
          <p className="min-w-0 text-xs text-muted-foreground tabular-nums">
            {reason ?? (
              <>
                <span className="font-medium text-foreground">{plural(posters.length, "poster")}</span> to{" "}
                {plural(shops, "shop")}
                {testRun ? " · test run, nothing leaves this machine" : activate ? " · live when ready" : " · stay inactive"}
              </>
            )}
          </p>
          <Button
            type="submit"
            disabled={!!reason || busy}
            className="shrink-0 transition-transform duration-150 ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
          >
            {busy ? (
              <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
            ) : testRun ? (
              <FlaskConicalIcon />
            ) : (
              <UploadIcon />
            )}
            {testRun ? "Start test run" : `Upload ${formatNumber(posters.length)}`}
            <Kbd className="bg-primary-foreground/15 text-primary-foreground">⌘↵</Kbd>
          </Button>
        </DialogFooter>
      )}
    </form>
  )
}

// --- Which posters go ---

function Picker({
  groups,
  uploads,
  free,
  picked,
  deleting,
  start,
  mode,
  usable,
  perGroup,
  onPick,
  onPickAll,
  onPickNone,
  onGroupTarget,
}: {
  groups: UploadGroup[]
  uploads: PosterUploads
  free: Set<string>
  /** Picked to upload, or marked to delete while `deleting`. */
  picked: Set<string>
  deleting: boolean
  start: string | null
  mode: SpreadMode
  usable: AccountView[]
  perGroup: Record<string, string>
  onPick: (keys: string[], on: boolean) => void
  onPickAll: () => void
  onPickNone: () => void
  onGroupTarget: (group: string, to: string) => void
}) {
  // The group the dialog was opened for starts open, or the only one.
  const [open, setOpen] = React.useState(
    () => new Set(start ? [start.split("/")[0]] : groups.length === 1 ? [groups[0].id] : [])
  )
  const count = [...picked].filter((key) => free.has(key)).length

  return (
    <section aria-label="Posters" className="flex min-h-0 flex-col border-b md:border-r md:border-b-0">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="text-xs font-medium">{deleting ? "To delete" : "Posters"}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatNumber(count)} of {formatNumber(free.size)}
        </span>
        <div className="ml-auto flex items-center">
          <Button type="button" variant="ghost" size="xs" onClick={onPickAll} disabled={count === free.size}>
            All
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={onPickNone} disabled={count === 0}>
            None
          </Button>
        </div>
      </div>
      {groups.length === 0 || free.size === 0 ? (
        <p className="p-4 text-xs text-muted-foreground">
          Nothing to upload: every approved poster is on Etsy or on its way.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 p-2 md:overflow-y-auto">
          {groups.map((group) => (
            <GroupPick
              key={group.id}
              group={group}
              uploads={uploads}
              free={free}
              picked={picked}
              deleting={deleting}
              open={open.has(group.id)}
              onOpenChange={(on) =>
                setOpen((before) => {
                  const next = new Set(before)
                  if (on) next.add(group.id)
                  else next.delete(group.id)
                  return next
                })
              }
              target={mode === "mixed" ? (perGroup[group.id] ?? SPLIT) : null}
              usable={usable}
              onPick={onPick}
              onTarget={(to) => onGroupTarget(group.id, to)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function GroupPick({
  group,
  uploads,
  free,
  picked,
  deleting,
  open,
  onOpenChange,
  target,
  usable,
  onPick,
  onTarget,
}: {
  group: UploadGroup
  uploads: PosterUploads
  free: Set<string>
  picked: Set<string>
  deleting: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Mixed preset: where the group goes, SPLIT or an account id. */
  target: string | null
  usable: AccountView[]
  onPick: (keys: string[], on: boolean) => void
  onTarget: (to: string) => void
}) {
  const keys = group.posters.map((p) => posterKey(group.id, p.outputId)).filter((key) => free.has(key))
  const on = keys.filter((key) => picked.has(key)).length
  const title = shortTitle(group.source.title)
  const targets = [{ value: SPLIT, label: "Split evenly" }, ...usable.map((a) => ({ value: a.id, label: nameOf(a) }))]

  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-2.5 rounded-lg p-1.5 transition-colors duration-150 [@media(hover:hover)]:hover:bg-muted/60">
        <Checkbox
          checked={keys.length > 0 && on === keys.length}
          indeterminate={on > 0 && on < keys.length}
          disabled={keys.length === 0}
          onCheckedChange={(checked) => onPick(keys, checked)}
          aria-label={`${deleting ? "Delete" : "Upload"} the posters of ${title}`}
          // Some picked: a dash on the filled box, instead of the check.
          className={cn(
            "data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground data-indeterminate:before:h-0.5 data-indeterminate:before:w-2 data-indeterminate:before:rounded-full data-indeterminate:before:bg-current data-indeterminate:[&_svg]:hidden",
            deleting &&
              "data-checked:border-destructive data-checked:bg-destructive data-checked:text-white data-indeterminate:border-destructive data-indeterminate:bg-destructive data-indeterminate:text-white dark:data-checked:bg-destructive"
          )}
        />
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={group.image ?? group.posters[0]?.thumb}
            alt=""
            loading="lazy"
            draggable={false}
            className="size-9 shrink-0 rounded-md bg-muted object-cover ring-1 ring-foreground/10"
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm" title={group.source.title}>
              {title}
            </span>
            <span className="truncate text-xs text-muted-foreground tabular-nums">
              {keys.length === 0 ? "Nothing left to upload" : `${on} of ${keys.length}`} · {group.folder}
            </span>
          </span>
          <ChevronDownIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out-strong motion-reduce:transition-none",
              open && "rotate-180"
            )}
          />
        </button>
      </div>

      {target !== null && keys.length > 0 && (
        <div className="flex items-center gap-2 py-1 pr-1.5 pl-8 text-xs text-muted-foreground">
          <span className="shrink-0">Goes to</span>
          <Select value={target} items={targets} onValueChange={(value) => value && onTarget(value)}>
            <SelectTrigger size="sm" className="h-6 min-w-0 flex-1 text-xs" aria-label={`Where ${title} goes`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {targets.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Opens by its own height: a grid row going from 0fr to 1fr. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out-strong motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="grid grid-cols-5 gap-1.5 py-1.5 pr-1.5 pl-8">
            {group.posters.map((p) => {
              const key = posterKey(group.id, p.outputId)
              return (
                <PosterPick
                  key={key}
                  poster={p}
                  free={free.has(key)}
                  picked={picked.has(key)}
                  deleting={deleting}
                  status={statusOf(uploads, key, p.state)}
                  onToggle={() => onPick([key], !picked.has(key))}
                />
              )
            })}
          </div>
        </div>
      </div>
    </li>
  )
}

function PosterPick({
  poster,
  free,
  picked,
  deleting,
  status,
  onToggle,
}: {
  poster: GroupPoster
  free: boolean
  picked: boolean
  deleting: boolean
  status: PosterStatus
  onToggle: () => void
}) {
  const on = free && picked
  const note = free
    ? poster.draftId
      ? null
      : "Its copy is written first"
    : (NOT_FREE[status] ?? "Gelato made it once already: retry that upload instead")
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-pressed={on}
            aria-disabled={!free}
            onClick={() => free && onToggle()}
            className={cn(
              "group/tile relative overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10 transition-[opacity,transform] duration-150 ease-out-strong outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
              free ? "active:scale-[0.97]" : "cursor-not-allowed",
              deleting ? !free && "opacity-40" : !on && "opacity-40",
              deleting && on && "ring-2 ring-destructive"
            )}
            style={{ aspectRatio: ratio(poster) }}
          />
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={poster.thumb} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
        {free && (
          <span
            aria-hidden
            className={cn(
              "absolute top-1 left-1 grid size-3.5 place-items-center rounded-full border shadow-sm transition-colors duration-150",
              on
                ? deleting
                  ? "border-destructive bg-destructive text-white"
                  : "border-brand bg-brand text-white"
                : "border-white bg-black/25 text-transparent"
            )}
          >
            {deleting ? <Trash2Icon className="size-2" strokeWidth={3} /> : <CheckIcon className="size-2.5" strokeWidth={3} />}
          </span>
        )}
        {status === "live" && (
          <span aria-hidden className="absolute right-1 bottom-1 size-1.5 rounded-full bg-emerald-500 ring-1 ring-white" />
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-64 flex-col items-start gap-0.5">
        <span className="font-medium">{poster.title}</span>
        {note && <span className="opacity-70">{note}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

// --- Where they go ---

function Column({
  account,
  index,
  usable,
  testRun,
  posters,
  posterOf,
  alikeOf,
  moved,
  deleting,
  chains,
  chain,
  onChain,
  keys,
  usage,
  onDrop,
  onCycle,
  onThumbKey,
}: {
  account: AccountView
  index: number
  /** Takes posters in this job: set up for live uploads, or any account in a test run. */
  usable: boolean
  testRun: boolean
  posters: Placeable[]
  posterOf: Map<string, GroupPoster>
  alikeOf: Map<string, string[]>
  moved: Assignment
  /** Delete mode: the posters marked to go. */
  deleting: Set<string> | null
  chains: MockupChain[]
  chain: string | null
  onChain: (chain: string | null) => void
  /** How many accounts there are: the numbers that move a poster. */
  keys: number
  usage: EtsyUsage | null
  onDrop: (key: string) => void
  onCycle: (key: string) => void
  onThumbKey: (event: React.KeyboardEvent, key: string) => void
}) {
  const [over, setOver] = React.useState(false)
  const name = nameOf(account)
  const count = posters.length
  const calls = count * CALLS_PER_LISTING
  const days = account.dailyTarget > 0 ? Math.ceil(count / account.dailyTarget) : 1
  const alike = posters.filter((p) => alikeOf.has(p.key)).length
  const chainItems = [
    ...chains.map((c) => ({
      value: c.id,
      label: c.name,
      hint: `${plural(c.scenes.length, "photo")}${c.video ? " · video" : ""}`,
    })),
    { value: NO_CHAIN, label: "Poster only", hint: "no mockups" },
  ]

  return (
    <section
      aria-label={name}
      onDragOver={(event) => {
        if (!usable || !event.dataTransfer.types.includes(DRAG)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
        setOver(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        const key = event.dataTransfer.getData(DRAG)
        if (key) onDrop(key)
      }}
      className={cn(
        "flex min-w-0 flex-col gap-2.5 rounded-xl border p-3 transition-colors duration-150",
        over ? "border-ring bg-muted/50" : "bg-card",
        !usable && "bg-muted/30"
      )}
    >
      <div className="flex items-start gap-2">
        <Kbd className="mt-px">{index + 1}</Kbd>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium" title={name}>
            {name}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                account.missing.length ? "bg-amber-500" : "bg-emerald-500"
              )}
            />
            <span className="truncate" title={account.missing.join(", ")}>
              {account.missing.length === 0
                ? "Ready"
                : usable
                  ? "Test runs only"
                  : `Needs ${account.missing.join(", ")}`}
            </span>
          </span>
        </div>
        <span className={cn("text-xl leading-none font-semibold tabular-nums", !usable && "text-muted-foreground")}>
          {count}
        </span>
      </div>

      {usable ? (
        <Select
          value={chain ?? NO_CHAIN}
          items={chainItems}
          onValueChange={(value) => value && onChain(value === NO_CHAIN ? null : value)}
          disabled={chains.length === 0}
        >
          <SelectTrigger size="sm" className="w-full min-w-0 text-xs" aria-label={`Mockup chain for ${name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {chainItems.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
                <span className="text-muted-foreground">{c.hint}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-xs text-muted-foreground">
          Not ready for live uploads.{" "}
          <Link
            href="/settings"
            className="underline underline-offset-2 [@media(hover:hover)]:hover:text-foreground"
          >
            Set it up
          </Link>
        </p>
      )}

      <ul className="flex min-h-16 flex-wrap content-start gap-1.5" aria-label={`Posters for ${name}`}>
        {posters.map((p) => {
          const poster = posterOf.get(p.key)
          if (!poster) return null
          return (
            <li key={p.key}>
              <Thumb
                id={p.key}
                poster={poster}
                accountName={name}
                alike={(alikeOf.get(p.key) ?? []).map((k) => posterOf.get(k)?.title ?? "")}
                moved={!!moved[p.key]}
                marked={deleting ? deleting.has(p.key) : null}
                keys={keys}
                onClick={() => onCycle(p.key)}
                onKeyDown={(event) => onThumbKey(event, p.key)}
              />
            </li>
          )
        })}
        {count === 0 && usable && (
          <li className="grid h-16 flex-1 place-items-center rounded-md border border-dashed text-xs text-muted-foreground">
            Drop posters here
          </li>
        )}
      </ul>

      {count > 0 && (
        <div className="mt-auto flex flex-col gap-0.5 text-[11px] text-muted-foreground tabular-nums">
          {alike > 0 && <span className="text-amber-600 dark:text-amber-400">{alike} alike side by side</span>}
          {days > 1 && (
            <span>
              Paced over {days} days, {formatNumber(account.dailyTarget)} a day
            </span>
          )}
          {testRun ? (
            <span>No Etsy requests in a test run</span>
          ) : usage ? (
            <span className={cn(calls > usage.remainingToday && "text-amber-600 dark:text-amber-400")}>
              About {formatNumber(calls)} Etsy requests, {formatNumber(usage.remainingToday)} left today
            </span>
          ) : (
            <span>About {formatNumber(calls)} Etsy requests</span>
          )}
        </div>
      )}
    </section>
  )
}

function Thumb({
  id,
  poster,
  accountName,
  alike,
  moved,
  marked,
  keys,
  onClick,
  onKeyDown,
}: {
  id: string
  poster: GroupPoster
  accountName: string
  /** Titles of the alike posters in the same shop. */
  alike: string[]
  moved: boolean
  /** Delete mode: whether it's marked to go; null while uploading. */
  marked: boolean | null
  keys: number
  onClick: () => void
  onKeyDown: (event: React.KeyboardEvent) => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            draggable={marked === null}
            data-thumb={id}
            onDragStart={(event) => {
              event.dataTransfer.setData(DRAG, id)
              event.dataTransfer.effectAllowed = "move"
            }}
            onClick={onClick}
            onKeyDown={onKeyDown}
            aria-label={marked === null ? `${poster.title}, goes to ${accountName}` : `Delete ${poster.title}`}
            aria-pressed={marked ?? undefined}
            className={cn(
              "relative block h-16 overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              marked === null ? "cursor-grab active:cursor-grabbing" : "transition-transform duration-150 ease-out-strong active:scale-[0.97] motion-reduce:transition-none",
              marked === null && alike.length > 0 && "ring-2 ring-amber-500/80",
              marked && "ring-2 ring-destructive"
            )}
            style={{ aspectRatio: ratio(poster) }}
          />
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={poster.thumb} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
        {moved && marked === null && (
          <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-foreground ring-1 ring-background" />
        )}
        {marked && (
          <span aria-hidden className="absolute inset-0 grid place-items-center bg-destructive/45 text-white">
            <Trash2Icon className="size-4" />
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-64 flex-col items-start gap-0.5">
        <span className="font-medium">{poster.title}</span>
        {alike.length > 0 && (
          <span className="text-amber-300 dark:text-amber-600">Alike: {alike.filter(Boolean).join(", ")}</span>
        )}
        {marked === null ? (
          <>
            {moved && <span className="opacity-70">Moved by hand</span>}
            <span className="opacity-70">
              Click for the next shop or drag it. Focused: {keys > 1 ? `1–${keys}` : "1"} or ← → moves it, ⌫ leaves it out
            </span>
          </>
        ) : (
          <span className="opacity-70">{marked ? "Marked to delete: click to keep it" : "Click to mark it for deleting"}</span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

// --- Options ---

function Option({
  title,
  hint,
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  title: string
  hint?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  children?: React.ReactNode
}) {
  const id = React.useId()
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="mt-0.5"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className={cn("text-sm", disabled ? "text-muted-foreground" : "cursor-pointer")}>
          {title}
        </label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {children}
      </div>
    </div>
  )
}

/** Why only test runs can start: no account set up, or the pipeline's blockers. */
function LiveBlocked({ accounts, ready, blockers }: { accounts: AccountView[]; ready: number; blockers: string[] }) {
  const missing = [...new Set(accounts.flatMap((a) => a.missing))]
  return (
    <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      {ready === 0 && accounts.length > 0 && (
        <p>
          Only test runs for now: no account is ready for live uploads
          {missing.length > 0 && <> (still to do: {missing.join(", ")})</>}.{" "}
          <Link href="/settings" className="underline underline-offset-2 [@media(hover:hover)]:hover:text-foreground">
            Set them up in Settings
          </Link>
        </p>
      )}
      {blockers.map((b) => (
        <p key={b} className="text-amber-600 dark:text-amber-400">
          {b}
        </p>
      ))}
      <p>Copy, print files, mockups and the requests are all made here; nothing is sent to Etsy or Gelato.</p>
    </div>
  )
}
