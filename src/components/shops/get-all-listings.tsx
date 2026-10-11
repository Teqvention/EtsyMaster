"use client"

import * as React from "react"
import { DownloadIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useAccounts } from "@/hooks/use-accounts"
import { useEtsyUsage } from "@/hooks/use-etsy-usage"
import { allListingsCost, analyseShops, hasAllListings } from "@/hooks/use-shop-analysis"
import { getShopVisit } from "@/hooks/use-shop-history"
import { formatNumber } from "@/lib/etsy/format"
import type { ListingShop } from "@/lib/etsy/types"
import { cn } from "@/lib/utils"

// "Get all listings", asked first which Etsy accounts to spend on it: every
// account with a key, its quota left today beside it, the analysis accounts
// picked until another choice is made (and remembered). Upload accounts can
// be lent too; the server keeps a spare of theirs for uploads.

const STORAGE_KEY = "etsy-research:listing-accounts"
/** What an upload account keeps for its uploads when lent to research (RESERVE in lib/etsy/client.ts). */
const UPLOAD_SPARE = 150

/** The accounts picked last time, or null to leave it to the analysis accounts. */
export function rememberedAccounts(): string[] | null {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown
    return Array.isArray(stored) && stored.every((id) => typeof id === "string") && stored.length ? stored : null
  } catch {
    return null
  }
}

/**
 * Fetches the listings the shops don't have yet (shops that have them all are
 * left out) with `accounts`, or the ones picked last time, then says how it went.
 */
export function getAllListings(shops: ListingShop[], accounts = rememberedAccounts() ?? undefined) {
  const missing = shops.filter((s) => !hasAllListings(getShopVisit(s.id)?.analysis, s.activeListings))
  const complete = shops.length - missing.length
  if (missing.length === 0) {
    toast(
      shops.length === 1
        ? `${shops[0].name} has all its listings already`
        : `All ${formatNumber(shops.length)} shops have all their listings already`
    )
    return
  }
  toast(`Getting the missing listings of ${formatNumber(missing.length)} ${missing.length === 1 ? "shop" : "shops"}`, {
    description: `${complete ? `${formatNumber(complete)} already ${complete === 1 ? "has" : "have"} all of theirs. ` : ""}Only listings not held yet are fetched.`,
  })
  analyseShops(missing, accounts).then((batch) => {
    // Added to a batch already under way: that one reports.
    if (!batch) return
    const ok = batch.done - batch.failed.length
    if (batch.failed.length) {
      toast.error(`Got all listings of ${formatNumber(ok)} of ${formatNumber(batch.total)} shops`, {
        description: `Failed: ${batch.failed.join(", ")}`,
        duration: 10_000,
      })
    } else {
      toast.success(
        batch.done < batch.total
          ? `Stopped after ${formatNumber(batch.done)} of ${formatNumber(batch.total)} shops`
          : `Got all listings of ${formatNumber(batch.total)} ${batch.total === 1 ? "shop" : "shops"}`,
        { duration: 10_000 }
      )
    }
  })
}

function remember(accounts: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts))
  } catch {
    // Not remembered; the analysis accounts are picked next time.
  }
}

type Option = {
  id: string
  label: string
  role: "upload" | "analysis"
  shop: string | null
  /** Requests left today it can spend here; null before the first reading. */
  left: number | null
  limit: number | null
  blockedUntil: string | null
}

/** Every account with an Etsy key, analysis accounts first, with what it can spend today. */
function useOptions(): Option[] | null {
  const accounts = useAccounts()
  const { state } = useEtsyUsage()
  return React.useMemo(() => {
    if (!accounts) return null
    return accounts.accounts
      .filter((a) => a.hasKey)
      .map((a) => {
        const usage = state?.accounts.find((u) => u.id === a.id)?.usage ?? null
        const spare = a.role === "upload" ? UPLOAD_SPARE : 0
        return {
          id: a.id,
          label: a.label,
          role: a.role,
          shop: a.shop?.name ?? null,
          left: usage ? Math.max(usage.remainingToday - spare, 0) : null,
          limit: usage?.limitPerDay ?? null,
          blockedUntil: usage?.blockedUntil ?? null,
        }
      })
      .sort((a, b) => Number(a.role === "upload") - Number(b.role === "upload"))
  }, [accounts, state])
}

export function GetAllListingsPopover({
  shops,
  side = "bottom",
  align = "end",
  children,
}: {
  shops: ListingShop[]
  side?: "top" | "bottom"
  align?: "start" | "end"
  /** The button that opens it. */
  children: React.ReactElement
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={children} />
      <PopoverContent side={side} align={align} className="w-[22rem] max-w-[calc(100vw-2rem)] gap-0 p-0">
        {/* Remounted per opening, so it starts from the remembered choice. */}
        {open && <Picker shops={shops} onDone={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  )
}

function Picker({ shops, onDone }: { shops: ListingShop[]; onDone: () => void }) {
  const options = useOptions()
  const [chosen, setChosen] = React.useState<string[] | null>(null)

  const { missing, cost } = React.useMemo(() => {
    const missing = shops.filter((s) => !hasAllListings(getShopVisit(s.id)?.analysis, s.activeListings))
    const cost = missing.reduce((total, s) => total + allListingsCost(s, getShopVisit(s.id)?.analysis), 0)
    return { missing, cost }
  }, [shops])

  // What's ticked: this opening's choice, else the remembered one (what's left
  // of it), else the analysis accounts.
  const ids = new Set(options?.map((o) => o.id))
  const remembered = rememberedAccounts()?.filter((id) => ids.has(id))
  const picked =
    chosen ??
    (remembered?.length ? remembered : options?.filter((o) => o.role === "analysis").map((o) => o.id)) ??
    []
  const pickedOptions = options?.filter((o) => picked.includes(o.id)) ?? []
  const left = pickedOptions.every((o) => o.left !== null)
    ? pickedOptions.reduce((total, o) => total + (o.blockedUntil ? 0 : o.left!), 0)
    : null

  function toggle(id: string, on: boolean) {
    setChosen(on ? [...picked, id] : picked.filter((p) => p !== id))
  }

  function start() {
    remember(picked)
    onDone()
    getAllListings(shops, picked)
  }

  const analysis = options?.filter((o) => o.role === "analysis") ?? []
  const upload = options?.filter((o) => o.role === "upload") ?? []

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-0.5 px-3 pt-3 pb-2.5">
        <p className="text-sm font-medium">Get all listings</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {missing.length === 0
            ? shops.length === 1
              ? "This shop has all its listings already"
              : "Every shop here has all its listings already"
            : `${formatNumber(missing.length)} ${missing.length === 1 ? "shop" : "shops"} · about ${formatNumber(cost)} Etsy requests`}
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t px-1.5 py-2" role="group" aria-label="Fetch with">
        {!options ? (
          <p className="px-1.5 py-2 text-xs text-muted-foreground">Loading the accounts…</p>
        ) : options.length === 0 ? (
          <p className="px-1.5 py-2 text-xs text-muted-foreground">No account has an Etsy key yet: add one in Settings.</p>
        ) : (
          <>
            {analysis.length > 0 && (
              <AccountGroup title="Analysis accounts" options={analysis} picked={picked} onToggle={toggle} />
            )}
            {upload.length > 0 && (
              <AccountGroup
                title="Upload accounts"
                hint={`${UPLOAD_SPARE} requests each stay spare for uploads`}
                options={upload}
                picked={picked}
                onToggle={toggle}
              />
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t bg-muted/40 px-3 py-2.5">
        <Verdict picked={picked.length} left={left} cost={cost} nothing={missing.length === 0} />
        <Button
          size="sm"
          className="w-full active:scale-[0.97]"
          disabled={picked.length === 0 || missing.length === 0}
          onClick={start}
        >
          <DownloadIcon />
          {missing.length > 1 ? `Get the listings of ${formatNumber(missing.length)} shops` : "Get the listings"}
        </Button>
      </div>
    </div>
  )
}

function AccountGroup({
  title,
  hint,
  options,
  picked,
  onToggle,
}: {
  title: string
  hint?: string
  options: Option[]
  picked: string[]
  onToggle: (id: string, on: boolean) => void
}) {
  return (
    <div className="flex flex-col">
      <p className="flex items-baseline justify-between gap-2 px-1.5 pb-1 text-[11px] text-muted-foreground">
        <span className="font-semibold tracking-wider uppercase">{title}</span>
        {hint && <span className="truncate">{hint}</span>}
      </p>
      <ul className="flex flex-col">
        {options.map((option) => (
          <li key={option.id}>
            <AccountRow option={option} on={picked.includes(option.id)} onToggle={onToggle} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function AccountRow({
  option,
  on,
  onToggle,
}: {
  option: Option
  on: boolean
  onToggle: (id: string, on: boolean) => void
}) {
  const share = option.left !== null && option.limit ? Math.min(option.left / option.limit, 1) : null
  const low = option.blockedUntil !== null || (option.left !== null && option.left < 200)
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors duration-150 [@media(hover:hover)]:hover:bg-muted/60",
        on && "bg-muted/40"
      )}
    >
      <Checkbox checked={on} onCheckedChange={(checked) => onToggle(option.id, checked)} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{option.label}</span>
        {option.shop && option.shop !== option.label && (
          <span className="truncate text-[11px] text-muted-foreground">{option.shop}</span>
        )}
      </span>
      <span className="flex w-24 shrink-0 flex-col items-end gap-1">
        <span
          className={cn(
            "text-xs tabular-nums",
            low ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
          )}
        >
          {option.blockedUntil
            ? `Out until ${new Date(option.blockedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : option.left === null
              ? "Quota unknown"
              : `${formatNumber(option.left)} left`}
        </span>
        {share !== null && !option.blockedUntil && (
          <span className="h-1 w-full overflow-hidden rounded-full bg-foreground/10" aria-hidden>
            <span
              className={cn("block h-full rounded-full", low ? "bg-amber-500" : "bg-emerald-500")}
              style={{ width: `${share * 100}%` }}
            />
          </span>
        )}
      </span>
    </label>
  )
}

/** Whether the accounts picked can carry it. */
function Verdict({ picked, left, cost, nothing }: { picked: number; left: number | null; cost: number; nothing: boolean }) {
  if (nothing) return null
  if (picked === 0) {
    return <p className="text-xs text-destructive">Pick at least one account to fetch with.</p>
  }
  const accounts = picked === 1 ? "the account picked" : `the ${picked} accounts picked`
  if (left === null) {
    return <p className="text-xs text-muted-foreground">Fetches with {accounts}, the fullest first.</p>
  }
  if (left < cost) {
    return (
      <p className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400 [&_svg]:mt-px [&_svg]:size-3.5 [&_svg]:shrink-0">
        <TriangleAlertIcon />
        <span className="text-pretty">
          {formatNumber(left)} requests left on {accounts}: it stops when they run out. Pick another account to
          get further.
        </span>
      </p>
    )
  }
  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      {formatNumber(left)} requests left on {accounts}, the fullest used first.
    </p>
  )
}
