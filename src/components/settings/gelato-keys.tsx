"use client"

import * as React from "react"
import { LoaderCircleIcon, PlusIcon, RefreshCwIcon, StoreIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Section } from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { addGelatoKey, refreshGelato, removeGelatoKey, useGelato, type GelatoStoreView } from "@/hooks/use-gelato"
import type { AccountView } from "@/lib/accounts/types"
import { cn } from "@/lib/utils"

// The Gelato API keys, one per Gelato account, with the stores each reaches
// and the account each store prints for. A store is picked per account above.

export function GelatoKeys({ accounts }: { accounts: AccountView[] }) {
  const gelato = useGelato()
  const [refreshing, setRefreshing] = React.useState(false)

  async function refresh() {
    setRefreshing(true)
    try {
      await refreshGelato(true)
    } catch (error) {
      toast.error(`Couldn't reach Gelato: ${(error as Error).message}`)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Section
      title="Gelato keys"
      aside={
        <div className="-mr-1 flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={refresh}
                  disabled={refreshing || !gelato}
                  aria-label="Ask Gelato for the stores again"
                  className="text-muted-foreground"
                />
              }
            >
              <RefreshCwIcon className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />
            </TooltipTrigger>
            <TooltipContent>Ask Gelato for the stores again</TooltipContent>
          </Tooltip>
          <AddKey />
        </div>
      }
    >
      {!gelato ? (
        <Skeleton className="h-24 rounded-md" />
      ) : gelato.keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">{gelato.error ?? "No key yet: add one to pick stores."}</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {gelato.keys.map((key) => (
            <KeyRow
              key={key.id}
              gelatoKey={key}
              stores={gelato.stores.filter((s) => s.keyId === key.id)}
              accounts={accounts}
            />
          ))}
        </ul>
      )}
    </Section>
  )
}

function KeyRow({
  gelatoKey,
  stores,
  accounts,
}: {
  gelatoKey: { id: string; label: string }
  stores: GelatoStoreView[]
  accounts: AccountView[]
}) {
  const users = (storeId: string) => accounts.filter((a) => a.gelato?.storeId === storeId)
  const relying = accounts.filter((a) => stores.some((s) => s.id === a.gelato?.storeId))

  return (
    <li className="flex items-start gap-2 py-2 first:pt-0.5 last:pb-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{gelatoKey.label}</span>
        {stores.length === 0 ? (
          <span className="text-xs text-amber-700 dark:text-amber-400">Reaches no store: Gelato may refuse the key</span>
        ) : (
          <ul className="flex flex-col gap-0.5 text-xs">
            {stores.map((store) => {
              const by = users(store.id)
              return (
                <li key={store.id} className="flex min-w-0 items-center gap-1.5">
                  <StoreIcon className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{store.name}</span>
                  {store.status !== "active" && (
                    <span className="shrink-0 text-amber-700 dark:text-amber-400">{store.status}</span>
                  )}
                  <span className={cn("ml-auto shrink-0 truncate", by.length ? "text-foreground" : "text-muted-foreground")}>
                    {by.length ? by.map((a) => a.label).join(", ") : "Unused"}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <RemoveKey gelatoKey={gelatoKey} relying={relying} />
    </li>
  )
}

function RemoveKey({ gelatoKey, relying }: { gelatoKey: { id: string; label: string }; relying: AccountView[] }) {
  const [confirming, setConfirming] = React.useState(false)
  const [removing, setRemoving] = React.useState(false)

  async function remove() {
    setConfirming(false)
    setRemoving(true)
    try {
      await removeGelatoKey(gelatoKey.id)
      toast(`Removed the key of ${gelatoKey.label}`)
    } catch (error) {
      toast.error(`Couldn't remove it: ${(error as Error).message}`)
      setRemoving(false)
    }
  }

  return (
    <Popover open={confirming} onOpenChange={setConfirming}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground active:scale-[0.97] data-popup-open:bg-muted [@media(hover:hover)]:hover:text-destructive"
            aria-label={`Remove the key of ${gelatoKey.label}`}
            disabled={removing}
          />
        }
      >
        {removing ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <Trash2Icon />}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-3 p-3">
        <p className="text-sm text-pretty">
          Remove the key of <span className="font-medium">{gelatoKey.label}</span>?{" "}
          {relying.length
            ? `${relying.map((a) => a.label).join(", ")} print${relying.length === 1 ? "s" : ""} through it and can't upload until another key reaches the store.`
            : "No account prints through it."}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Keep
          </Button>
          <Button variant="destructive" size="sm" className="active:scale-[0.97]" onClick={remove} autoFocus>
            Remove
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function AddKey() {
  const [open, setOpen] = React.useState(false)
  const [key, setKey] = React.useState("")
  const [label, setLabel] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const added = await addGelatoKey(label, key)
      toast.success(`Added the key of ${added.label}`)
      setOpen(false)
      setKey("")
      setLabel("")
    } catch (error) {
      toast.error(`Gelato didn't take the key: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="xs" className="text-muted-foreground active:scale-[0.97] data-popup-open:bg-muted" />}
      >
        <PlusIcon />
        Add key
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-2.5">
        <form onSubmit={submit} className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-0.5">
            <p className="font-medium">Add a Gelato key</p>
            <p className="text-xs text-pretty text-muted-foreground">
              From Gelato&apos;s dashboard, Developer → API keys. Its stores show once Gelato answers to it.
            </p>
          </div>
          <Input
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="API key"
            aria-label="API key"
            autoComplete="off"
            autoFocus
            className="font-mono text-xs md:text-xs"
          />
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Name (its stores' names if empty)"
            aria-label="Name"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !key.includes(":")} className="active:scale-[0.97]">
              {busy && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
              Add key
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
