"use client"

import { useSearchParams } from "next/navigation"
import * as React from "react"
import { CircleCheckIcon, CopyIcon, PlusIcon, StoreIcon } from "lucide-react"
import { toast } from "sonner"

import { AddAccountDialog } from "@/components/settings/account-dialogs"
import { AnalysisAccounts } from "@/components/settings/analysis-accounts"
import { FileHosting } from "@/components/settings/file-hosting"
import { GelatoKeys } from "@/components/settings/gelato-keys"
import { copy } from "@/components/settings/shared"
import { UploadAccount } from "@/components/settings/upload-account"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { refreshAccounts, useAccounts } from "@/hooks/use-accounts"
import type { AccountView } from "@/lib/accounts/types"
import { cn } from "@/lib/utils"

// The control room for everything uploads run on: the Etsy accounts (their
// apps' keys, the shop owners' grants, the shops), the Gelato store and
// templates each shop prints with, what new listings get, and where print
// files are hosted. An upload account is ready for live uploads once its
// checklist is done; the open one is kept in `?account=`.

export function SettingsView() {
  const state = useAccounts()
  const [wanted, select] = useSelected()
  const [adding, setAdding] = React.useState(false)
  useOAuthOutcome()

  if (!state) return <Loading />

  const uploads = state.accounts.filter((a) => a.role === "upload")
  const analysis = state.accounts.filter((a) => a.role === "analysis")
  const selected = uploads.find((a) => a.id === wanted) ?? uploads[0]
  const ready = uploads.filter((a) => a.missing.length === 0).length
  const added = (account: AccountView) => account.role === "upload" && select(account.id)

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-sm font-medium">Upload accounts</h2>
        {uploads.length > 0 && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {ready} of {uploads.length} ready for live uploads
          </span>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <CallbackUrl url={state.callbackUrl} />
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="shrink-0 active:scale-[0.97]">
            <PlusIcon />
            Add account
          </Button>
        </div>
      </div>

      {selected ? (
        <Tabs value={selected.id} onValueChange={(value) => select(String(value))} className="gap-3">
          <TabsList className="grid w-full grid-cols-1 items-stretch justify-normal gap-2 rounded-none bg-transparent p-0 group-data-horizontal/tabs:h-auto @2xl/main:grid-cols-3">
            {uploads.map((account) => (
              <AccountTile key={account.id} account={account} />
            ))}
          </TabsList>
          <TabsContent value={selected.id}>
            <UploadAccount key={selected.id} account={selected} accounts={state.accounts} />
          </TabsContent>
        </Tabs>
      ) : (
        <Empty className="min-h-[30svh] border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <StoreIcon />
            </EmptyMedia>
            <EmptyTitle>No upload account yet</EmptyTitle>
            <EmptyDescription>
              An upload account is an Etsy app connected to one of your shops: new listings go there.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setAdding(true)} className="active:scale-[0.97]">
              <PlusIcon />
              Add account
            </Button>
          </EmptyContent>
        </Empty>
      )}

      <div className="grid items-start gap-3 @4xl/main:grid-cols-3">
        <AnalysisAccounts accounts={analysis} onAdd={() => setAdding(true)} />
        <GelatoKeys accounts={state.accounts} />
        <FileHosting />
      </div>

      <AddAccountDialog open={adding} onOpenChange={setAdding} onAdded={added} />
    </div>
  )
}

function AccountTile({ account }: { account: AccountView }) {
  const done = account.checks.filter((c) => c.done).length
  const ready = account.missing.length === 0
  return (
    <TabsTrigger
      value={account.id}
      className="h-auto flex-col items-stretch justify-start gap-2 rounded-lg border-border px-3 py-2.5 text-left font-normal whitespace-normal text-foreground transition-[background-color,border-color] duration-150 ease-out data-active:border-foreground/25 data-active:bg-muted/60 motion-reduce:transition-none dark:data-active:border-foreground/25 dark:data-active:bg-muted/60 [@media(hover:hover)]:hover:bg-muted/40"
    >
      <span className="flex w-full min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">{account.label}</span>
        {account.connectionError ? (
          <span className="ml-auto shrink-0 text-xs font-medium text-destructive">Connection lost</span>
        ) : ready ? (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <CircleCheckIcon className="size-3.5" />
            Ready
          </span>
        ) : (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
            {done} of {account.checks.length}
          </span>
        )}
      </span>
      <span className="flex gap-1" aria-hidden>
        {account.checks.map((check) => (
          <span
            key={check.key}
            className={cn("h-1 flex-1 rounded-full", check.done ? "bg-emerald-500" : "bg-foreground/10")}
          />
        ))}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {account.connectionError ??
          (ready
            ? [account.shop?.name, account.gelato?.storeName].filter(Boolean).join(" · ")
            : `To do: ${account.missing.join(", ")}`)}
      </span>
    </TabsTrigger>
  )
}

function CallbackUrl({ url }: { url: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs">
      <a
        href="https://www.etsy.com/developers/your-apps"
        target="_blank"
        rel="noreferrer"
        title="Every Etsy app must list exactly this callback URL, or Etsy can't send the sign-in back"
        className="shrink-0 rounded-sm text-muted-foreground underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:text-foreground [@media(hover:hover)]:hover:underline"
      >
        Callback URL
      </a>
      <code className="truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">{url}</code>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => copy(url, "Callback URL")}
              aria-label="Copy the callback URL"
              className="shrink-0 text-muted-foreground active:scale-[0.97]"
            />
          }
        >
          <CopyIcon />
        </TooltipTrigger>
        <TooltipContent>Copy: every Etsy app must list it exactly</TooltipContent>
      </Tooltip>
    </div>
  )
}

/** The upload account asked for in the address; a sign-in comes back with `?connected=`. */
function useSelected() {
  const params = useSearchParams()
  const wanted = params.get("account") ?? params.get("connected")
  const select = React.useCallback((id: string) => {
    window.history.replaceState(null, "", `?account=${encodeURIComponent(id)}`)
  }, [])
  return [wanted, select] as const
}

/** Etsy's answer to a sign-in arrives once, in the address: it's told, and the address tidied up. */
function useOAuthOutcome() {
  const params = useSearchParams()
  const connected = params.get("connected")
  const error = params.get("error")
  const account = params.get("account")

  React.useEffect(() => {
    if (!connected && !error) return
    const id = connected ?? account
    window.history.replaceState(null, "", id ? `?account=${encodeURIComponent(id)}` : window.location.pathname)
    refreshAccounts().then((state) => {
      const found = state?.accounts.find((a) => a.id === id)
      const name = found?.label ?? id ?? "the account"
      if (connected) {
        const next = found?.checks.find((c) => !c.done)
        toast.success(`${name} is connected to Etsy`, {
          id: "etsy-sign-in",
          description: next ? `Next: ${next.hint}` : found?.role === "upload" ? "Ready for live uploads" : undefined,
        })
      } else {
        toast.error(`Couldn't connect ${name}`, { id: "etsy-sign-in", description: error, duration: 20_000 })
      }
    })
  }, [connected, error, account])
}

function Loading() {
  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6" aria-busy aria-label="Loading settings">
      <Skeleton className="h-5 w-72" />
      <div className="grid gap-2 @2xl/main:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[4.75rem] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[26rem] rounded-xl" />
      <div className="grid gap-3 @4xl/main:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-lg" />
        ))}
      </div>
    </div>
  )
}
