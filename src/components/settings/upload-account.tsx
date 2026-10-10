"use client"

import Link from "next/link"
import * as React from "react"
import {
  ArrowUpRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  LinkIcon,
  LoaderCircleIcon,
  LogInIcon,
  Settings2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { useChains } from "@/components/mockups/chain-store"
import { AccountMenu, KeyDialog } from "@/components/settings/account-dialogs"
import { GelatoBlock } from "@/components/settings/gelato-block"
import { ListingDefaults } from "@/components/settings/listing-defaults"
import {
  BlockTitle,
  Choice,
  ConnectButton,
  Note,
  Row,
  Rows,
  SavedInput,
  Status,
  connectHref,
  copy,
  saveAccount,
} from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { refreshAccountOptions } from "@/hooks/use-accounts"
import { usePrices } from "@/hooks/use-prices"
import { ETSY_SCOPES, UPLOAD_SCOPES, type AccountView, type ReadinessCheck } from "@/lib/accounts/types"
import { formatDate } from "@/lib/etsy/format"
import { cn } from "@/lib/utils"

// One upload account: what still stands between it and live uploads, its
// Etsy side (the app's key, the shop owner's grant, the shop), its Gelato
// side (store, templates), and what its new listings get.

const DAY = 24 * 60 * 60 * 1000
/** Etsy's grant runs out unless it's renewed; this early it's said in amber. */
const WARN_DAYS = 14

const DEFAULT_CHAIN = "default"

export function UploadAccount({ account, accounts }: { account: AccountView; accounts: AccountView[] }) {
  return (
    <section aria-label={account.label} className="flex flex-col rounded-xl border">
      <div className="flex flex-col gap-2.5 px-4 pt-3 pb-4">
        <div className="flex items-center gap-2">
          <SavedInput
            value={account.label}
            onSave={(label) => label && saveAccount(account.id, { label })}
            aria-label="Account name"
            className="-ml-2 h-8 max-w-full min-w-24 field-sizing-content border-transparent bg-transparent text-base font-semibold shadow-none md:text-base dark:bg-transparent [@media(hover:hover)]:hover:border-input"
          />
          <AccountMenu account={account} className="ml-auto" />
        </div>
        <Checklist checks={account.checks} />
      </div>
      <div className="grid divide-y border-t @4xl/main:grid-cols-3 @4xl/main:divide-x @4xl/main:divide-y-0">
        <EtsyBlock account={account} />
        <GelatoBlock account={account} accounts={accounts} />
        <ListingBlock account={account} />
      </div>
      <ListingDefaults account={account} />
    </section>
  )
}

function Checklist({ checks }: { checks: ReadinessCheck[] }) {
  const next = checks.find((c) => !c.done)
  return (
    <div className="flex flex-col gap-1.5">
      <ol className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-label="What live uploads need">
        {checks.map((check) => (
          <li
            key={check.key}
            title={check.done ? undefined : check.hint}
            className={cn(
              "flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:shrink-0",
              check.done ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {check.done ? (
              <CircleCheckIcon className="text-emerald-600 dark:text-emerald-400" aria-label="Done" />
            ) : (
              <CircleDashedIcon aria-label="Not done" />
            )}
            {check.label}
          </li>
        ))}
      </ol>
      {next ? (
        <p className="text-[13px] text-pretty">
          <span className="text-muted-foreground">Next: </span>
          {next.hint}
        </p>
      ) : (
        <p className="text-[13px] text-emerald-700 dark:text-emerald-400">Ready for live uploads</p>
      )}
    </div>
  )
}

// --- Etsy ---

/** Whole days until `ms`. */
const daysUntil = (ms: number) => Math.max(0, Math.floor((ms - Date.now()) / DAY))

function EtsyBlock({ account }: { account: AccountView }) {
  const [keyOpen, setKeyOpen] = React.useState(false)
  const [reading, setReading] = React.useState(false)
  const lacking = UPLOAD_SCOPES.filter((s) => !account.scopes.includes(s))
  const again = !!account.connectionError || (account.connected && lacking.length > 0)

  async function readShop() {
    setReading(true)
    try {
      await refreshAccountOptions(account.id)
    } catch (error) {
      toast.error(`Couldn't read the shop: ${(error as Error).message}`)
    } finally {
      setReading(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 p-4">
      <BlockTitle>Etsy</BlockTitle>
      <Rows>
        <Row label="App">
          {account.hasKey ? (
            <span className="flex items-baseline gap-2">
              <span className="tabular-nums">{account.appId ?? "Key saved"}</span>
              <button
                type="button"
                onClick={() => setKeyOpen(true)}
                className="rounded-sm text-xs text-muted-foreground underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:text-foreground [@media(hover:hover)]:hover:underline"
              >
                Replace
              </button>
            </span>
          ) : (
            <Button variant="outline" size="xs" onClick={() => setKeyOpen(true)} className="active:scale-[0.97]">
              Add the app&apos;s key
            </Button>
          )}
        </Row>
        <Row label="Connection">
          <Connection account={account} />
        </Row>
        <Row label="Shop">
          <ShopValue account={account} />
          {account.connected && !account.shop && (
            <Button variant="outline" size="xs" onClick={readShop} disabled={reading} className="active:scale-[0.97]">
              {reading && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
              Read the shop
            </Button>
          )}
        </Row>
      </Rows>

      {account.hasKey && (!account.connected || again) && (
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex items-center gap-1">
            <ConnectButton account={account} size="sm" className="active:scale-[0.97]">
              <LogInIcon />
              {again ? "Connect again" : "Connect to Etsy"}
            </ConnectButton>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Copy the sign-in link"
                    onClick={() => copy(window.location.origin + connectHref(account.id), "Sign-in link")}
                    className="text-muted-foreground active:scale-[0.97]"
                  />
                }
              >
                <LinkIcon />
              </TooltipTrigger>
              <TooltipContent>Copy the sign-in link, to open it in a private window</TooltipContent>
            </Tooltip>
          </div>
          <Note>
            Etsy connects whoever is signed in on etsy.com: sign in as this shop&apos;s owner first, or open the copied
            link in a private window. The app must list the callback URL above.
          </Note>
        </div>
      )}
      <KeyDialog account={account} open={keyOpen} onOpenChange={setKeyOpen} />
    </div>
  )
}

function Connection({ account }: { account: AccountView }) {
  if (account.connected) {
    const until = account.connectionExpiresAt ?? 0
    const left = daysUntil(until)
    const missing = ETSY_SCOPES.filter((s) => !account.scopes.includes(s))
    const blocking = missing.filter((s) => (UPLOAD_SCOPES as readonly string[]).includes(s))
    return (
      <>
        <Status tone={left < WARN_DAYS ? "warn" : "ok"}>Connected</Status>
        <Note
          tone={left < WARN_DAYS ? "warn" : undefined}
          className="tabular-nums"
        >
          <span title="Etsy's grant runs out 90 days after it was last renewed; every sync renews it">
            {left < WARN_DAYS
              ? `Runs out in ${left} day${left === 1 ? "" : "s"} unless it's used`
              : `Renews with use · until ${formatDate(new Date(until).toISOString())}`}
          </span>
        </Note>
        {missing.length > 0 && (
          <Note tone={blocking.length ? "warn" : undefined}>Not granted: {missing.join(", ")}</Note>
        )}
      </>
    )
  }
  if (account.connectionError) {
    return (
      <>
        <Status tone="error">Lost</Status>
        <Note tone="error">{account.connectionError}</Note>
      </>
    )
  }
  return <Status tone="off">Not connected</Status>
}

function ShopValue({ account }: { account: AccountView }) {
  const shop = account.shop
  if (!shop) return <span className="text-muted-foreground">{account.connected ? "Not read yet" : "—"}</span>
  return (
    <>
      <a
        href={shop.url ?? `https://www.etsy.com/shop/${shop.name}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex max-w-full items-center gap-1 rounded-sm font-medium underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:underline"
      >
        <span className="truncate">{shop.name}</span>
        <ArrowUpRightIcon className="size-3 shrink-0 text-muted-foreground" />
      </a>
      <Note className="tabular-nums">
        {[
          `#${shop.id}`,
          shop.currency,
          shop.createdAt && `open since ${formatDate(shop.createdAt, { month: "short", year: "numeric" })}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Note>
    </>
  )
}

// --- New listings ---

function ListingBlock({ account }: { account: AccountView }) {
  const chains = useChains()
  const prices = usePrices()
  const ids = { perDay: React.useId(), signature: React.useId(), setup: React.useId() }

  const fallback = chains?.find((c) => c.isDefault)
  const chainItems = [
    { value: DEFAULT_CHAIN, label: fallback ? `Default · ${fallback.name}` : "Default chain" },
    ...(chains ?? []).map((c) => ({ value: c.id, label: c.name })),
  ]
  if (account.chainId && chains && !chains.some((c) => c.id === account.chainId)) {
    chainItems.push({ value: account.chainId, label: "A deleted chain" })
  }
  const profileItems = (prices?.profiles ?? []).map((p) => ({ value: p.id, label: p.name }))
  if (account.priceProfileId && !profileItems.some((p) => p.value === account.priceProfileId)) {
    profileItems.push({ value: account.priceProfileId, label: account.priceProfileId })
  }

  function savePerDay(text: string) {
    const count = Number(text)
    if (!Number.isInteger(count) || count < 1) return toast.error("Listings per day takes a whole number above 0")
    return saveAccount(account.id, { dailyTarget: count })
  }

  function saveSetup(text: string) {
    const euros = Number(text.replace(/[€\s]/g, "").replace(",", "."))
    if (!Number.isFinite(euros) || euros < 0) return toast.error("The setup cost takes an amount in euros, e.g. 13.00")
    return saveAccount(account.id, { setupFeeCents: Math.round(euros * 100) })
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 p-4">
      <BlockTitle>New listings</BlockTitle>
      <Rows>
        <Row label="Mockups">
          <span className="flex w-full items-center gap-1">
            <Choice
              label="Mockup chain"
              value={account.chainId ?? DEFAULT_CHAIN}
              items={chainItems}
              disabled={!chains}
              onChange={(value) => saveAccount(account.id, { chainId: !value || value === DEFAULT_CHAIN ? null : value })}
            />
            <EditLink href="/mockups?tab=chains" label="Edit chains in Mockups" />
          </span>
        </Row>
        <Row label="Prices">
          <span className="flex w-full items-center gap-1">
            <Choice
              label="Price profile"
              value={account.priceProfileId}
              items={profileItems}
              placeholder="Pick a price profile"
              disabled={!profileItems.length}
              onChange={(priceProfileId) => saveAccount(account.id, { priceProfileId })}
            />
            <EditLink href="/prices" label="Edit profiles in Prices" />
          </span>
        </Row>
        <Row label="Per day" htmlFor={ids.perDay}>
          <span className="flex items-baseline gap-2">
            <SavedInput
              id={ids.perDay}
              value={String(account.dailyTarget)}
              onSave={savePerDay}
              inputMode="numeric"
              className="w-16 text-right tabular-nums"
            />
            <Note>new listings, in paced uploads</Note>
          </span>
        </Row>
        <Row label="Signature" htmlFor={ids.signature}>
          <SavedInput
            id={ids.signature}
            value={account.signature ?? ""}
            onSave={(text) => saveAccount(account.id, { signature: text || null })}
            placeholder="Closes every description"
            className="w-full"
          />
        </Row>
        <Row label="Setup cost" htmlFor={ids.setup}>
          <span className="flex items-baseline gap-2">
            <SavedInput
              id={ids.setup}
              value={(account.setupFeeCents / 100).toFixed(2)}
              onSave={saveSetup}
              inputMode="decimal"
              className="w-20 text-right tabular-nums"
            />
            <Note>€ to open the shop</Note>
          </span>
        </Row>
      </Rows>
    </div>
  )
}

function EditLink({ href, label }: { href: string; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href={href} />}
            aria-label={label}
            className="text-muted-foreground"
          />
        }
      >
        <Settings2Icon />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
