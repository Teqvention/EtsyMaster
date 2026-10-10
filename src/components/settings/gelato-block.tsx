"use client"

import * as React from "react"
import { ArrowUpRightIcon, CircleCheckIcon, LoaderCircleIcon, RotateCwIcon } from "lucide-react"
import { toast } from "sonner"

import { BlockTitle, Note, Row, Rows, SavedInput, saveAccount } from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { checkTemplates } from "@/hooks/use-accounts"
import { useGelato, type GelatoStoreView } from "@/hooks/use-gelato"
import type { AccountView, TemplateStatus } from "@/lib/accounts/types"
import { OFFERED } from "@/lib/catalog/sizes"
import { timeAgo } from "@/lib/shops/time-ago"
import { cn } from "@/lib/utils"

// Which Gelato store prints for the account's shop, and the templates its
// listings are made from: the nine offered sizes in portrait, and optionally in
// landscape. Templates are made in Gelato's dashboard (the API can't); a
// pasted ID is checked with Gelato at once.

type Slot = "templateId" | "templateIdLandscape"

export function GelatoBlock({ account, accounts }: { account: AccountView; accounts: AccountView[] }) {
  const gelato = useGelato()
  const stores = gelato?.stores ?? []
  const current = account.gelato
  const store = stores.find((s) => s.id === current?.storeId)
  const sharing = current ? accounts.filter((a) => a.id !== account.id && a.gelato?.storeId === current.storeId) : []
  const usedBy = (storeId: string) =>
    accounts
      .filter((a) => a.id !== account.id && a.gelato?.storeId === storeId)
      .map((a) => a.label)
      .join(", ")

  const items = stores.map((s) => ({ value: s.id, label: s.name }))
  if (current?.storeId && !store) items.push({ value: current.storeId, label: current.storeName ?? current.storeId })
  const groups = (gelato?.keys ?? [])
    .map((k) => ({ ...k, stores: stores.filter((s) => s.keyId === k.id) }))
    .filter((g) => g.stores.length)

  async function pick(storeId: string | null) {
    if (!storeId || storeId === current?.storeId) return
    const next = stores.find((s) => s.id === storeId)
    // Templates belong to a Gelato account: another store of the same one keeps them.
    const same = !!store && store.keyId === next?.keyId
    const had = !!(current?.templateId || current?.templateIdLandscape)
    const saved = await saveAccount(account.id, {
      gelato: {
        storeId,
        storeName: next?.name ?? null,
        ...(same && { templateId: current?.templateId ?? null, templateIdLandscape: current?.templateIdLandscape ?? null }),
      },
    })
    if (saved && had && !same) {
      toast("Templates cleared", { description: `Paste the templates of ${next?.keyLabel ?? "the new store's"} Gelato account.` })
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 p-4">
      <BlockTitle
        aside={
          <a
            href="https://dashboard.gelato.com"
            target="_blank"
            rel="noreferrer"
            className="-mr-1 inline-flex items-center gap-0.5 rounded-sm px-1 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:text-foreground"
          >
            Dashboard
            <ArrowUpRightIcon className="size-3" />
          </a>
        }
      >
        Gelato
      </BlockTitle>
      <Rows>
        <Row label="Store">
          <Select value={current?.storeId ?? null} items={items} onValueChange={(value) => pick(value)} disabled={!gelato}>
            <SelectTrigger size="sm" className="w-full min-w-0 text-[13px]" aria-label="Gelato store">
              <SelectValue
                placeholder={!gelato ? "Loading…" : stores.length ? "Pick the store" : "No store: add a Gelato key"}
              />
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectGroup key={group.id}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.stores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {usedBy(s.id) && <span className="text-xs text-muted-foreground">{usedBy(s.id)}</span>}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {store && account.shop && !sellsIn(store, account.shop.name) && (
            <Note tone="warn">
              Publishes to {store.name} on Etsy, not to {account.shop.name}
            </Note>
          )}
          {sharing.length > 0 && (
            <Note tone="warn">
              {sharing.map((a) => a.label).join(", ")} {sharing.length === 1 ? "uses" : "use"} this store too
            </Note>
          )}
          {store && store.status !== "active" && <Note tone="warn">The store is {store.status} in Gelato</Note>}
          {gelato && !gelato.error && current?.storeId && !store && (
            <Note tone="warn">No saved Gelato key reaches this store</Note>
          )}
        </Row>
        <Template account={account} slot="templateId" />
        <Template account={account} slot="templateIdLandscape" />
      </Rows>
    </div>
  )
}

/** Whether the store publishes to `shop`: Gelato names stores after their Etsy shop. */
function sellsIn(store: GelatoStoreView, shop: string) {
  const name = shop.toLowerCase()
  return store.name.toLowerCase() === name || !!store.domain?.toLowerCase().endsWith(`/shop/${name}`)
}

function Template({ account, slot }: { account: AccountView; slot: Slot }) {
  const [busy, setBusy] = React.useState(false)
  const id = React.useId()
  const gelato = account.gelato
  const value = gelato?.[slot] ?? ""
  const check = value ? gelato?.checks?.[value] : undefined
  const portrait = slot === "templateId"

  async function run(task: () => Promise<unknown>) {
    setBusy(true)
    try {
      await task()
    } finally {
      setBusy(false)
    }
  }

  const save = (text: string) =>
    run(() =>
      saveAccount(account.id, {
        gelato: portrait ? { templateId: text || null } : { templateIdLandscape: text || null },
      })
    )
  const recheck = () =>
    run(() => checkTemplates(account.id).catch((error: Error) => toast.error(`Couldn't check: ${error.message}`)))

  return (
    <Row label={portrait ? "Portrait" : "Landscape"} htmlFor={id}>
      <span className="flex w-full items-center gap-1">
        <SavedInput
          id={id}
          value={value}
          onSave={save}
          disabled={!gelato?.storeId}
          placeholder="Template ID"
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs md:text-xs"
        />
        {value && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={recheck}
                  disabled={busy}
                  aria-label="Check with Gelato again"
                  className="text-muted-foreground"
                />
              }
            >
              <RotateCwIcon className={cn(busy && "animate-spin motion-reduce:animate-none")} />
            </TooltipTrigger>
            <TooltipContent>Check with Gelato again</TooltipContent>
          </Tooltip>
        )}
      </span>
      {busy ? (
        <Note>
          <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
          Checking with Gelato…
        </Note>
      ) : !gelato?.storeId ? (
        <Note>Pick the store first</Note>
      ) : !value ? (
        <Note tone={portrait ? "warn" : undefined}>
          {portrait
            ? "Needed: a premium matte poster, 200 gsm, in the nine sizes, made in Gelato"
            : "Optional: landscape posters wait without one"}
        </Note>
      ) : check ? (
        <CheckResult check={check} />
      ) : (
        <Note>Not checked yet</Note>
      )}
    </Row>
  )
}

function CheckResult({ check }: { check: TemplateStatus }) {
  const when = `checked ${timeAgo(check.checkedAt)}`
  if (check.ok) {
    return (
      <Note tone="ok">
        <CircleCheckIcon />
        {check.name || "Template"} · all {OFFERED.length} sizes <span className="text-muted-foreground">· {when}</span>
      </Note>
    )
  }
  return (
    <>
      <ul className="flex flex-col gap-0.5 text-xs text-pretty text-destructive">
        {check.problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
      {check.missing.length > 0 && <Sizes missing={check.missing} />}
      <Note>{check.name ? `${check.name} · ${when}` : when}</Note>
    </>
  )
}

/** The offered sizes, the ones the template lacks marked. */
function Sizes({ missing }: { missing: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Sizes in the template">
      {OFFERED.map((size) => {
        const absent = missing.includes(size.key)
        return (
          <li
            key={size.key}
            title={absent ? `${size.cm}: missing` : size.cm}
            className={cn(
              "rounded-sm border px-1 text-[10px] leading-4 tabular-nums",
              absent ? "border-dashed border-destructive/60 text-destructive" : "text-muted-foreground"
            )}
          >
            {size.key.startsWith("a") ? size.key.toUpperCase() : size.key.replace("x", "×")}
            {absent && <span className="sr-only"> missing</span>}
          </li>
        )
      })}
    </ul>
  )
}
