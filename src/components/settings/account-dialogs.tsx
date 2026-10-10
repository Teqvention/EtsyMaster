"use client"

import * as React from "react"
import {
  ArrowLeftRightIcon,
  EllipsisIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  LogInIcon,
  Trash2Icon,
  UnplugIcon,
} from "lucide-react"
import { toast } from "sonner"

import { connectHref } from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { addAccount, deleteAccount, patchAccount } from "@/hooks/use-accounts"
import type { AccountRole, AccountView } from "@/lib/accounts/types"
import { cn } from "@/lib/utils"

// Adding an account, giving one a new key, and what's hard to take back
// (disconnecting, removing) behind a confirmation. Keys go to the server
// once, are checked with Etsy there and never come back to the browser.

const APPS_URL = "https://www.etsy.com/developers/your-apps"

type Key = { keystring: string; secret: string }

export function AddAccountDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: (account: AccountView) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Remounted per opening, so the form starts empty. */}
        {open && (
          <AddAccountForm
            onCancel={() => onOpenChange(false)}
            onAdded={(account) => {
              onOpenChange(false)
              onAdded(account)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function AddAccountForm({ onCancel, onAdded }: { onCancel: () => void; onAdded: (account: AccountView) => void }) {
  const [label, setLabel] = React.useState("")
  const [role, setRole] = React.useState<AccountRole>("upload")
  const [key, setKey] = React.useState<Key>({ keystring: "", secret: "" })
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const account = await addAccount({ label: label.trim(), role, ...key })
      toast.success(`Added ${account.label}`, { description: `Etsy app ${account.appId}` })
      onAdded(account)
    } catch (error) {
      setError((error as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Add an Etsy account</DialogTitle>
        <DialogDescription>
          The keystring and shared secret of its app, from{" "}
          <a href={APPS_URL} target="_blank" rel="noreferrer">
            etsy.com/developers/your-apps
          </a>
          . Etsy checks them before they&apos;re saved.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. the shop's name" autoFocus />
        </Field>
        <Field label="Used for">
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              variant="outline"
              size="sm"
              spacing={0}
              value={[role]}
              onValueChange={(value) => value[0] && setRole(value[0] as AccountRole)}
              aria-label="Used for"
            >
              <ToggleGroupItem value="upload" className="px-2.5">
                Uploads
              </ToggleGroupItem>
              <ToggleGroupItem value="analysis" className="px-2.5">
                Analysis
              </ToggleGroupItem>
            </ToggleGroup>
            <span className="text-xs font-normal text-muted-foreground">
              {role === "upload" ? "Its shop gets new listings" : "Research and shop analyses"}
            </span>
          </div>
        </Field>
        <KeyFields value={key} onChange={setKey} />
        {error && <p className="text-xs text-pretty text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={busy || !label.trim() || !key.keystring.trim() || !key.secret.trim()}
          className="active:scale-[0.97]"
        >
          {busy && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
          Add account
        </Button>
      </DialogFooter>
    </form>
  )
}

export function KeyDialog({
  account,
  open,
  onOpenChange,
}: {
  account: AccountView
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <KeyForm account={account} onCancel={() => onOpenChange(false)} onSaved={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function KeyForm({ account, onCancel, onSaved }: { account: AccountView; onCancel: () => void; onSaved: () => void }) {
  const [key, setKey] = React.useState<Key>({ keystring: "", secret: "" })
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const saved = await patchAccount(account.id, key)
      toast.success(`New key saved for ${saved.label}`, {
        description:
          account.connected && !saved.connected
            ? "It's another Etsy app's key, so the connection ended: connect again."
            : `Etsy app ${saved.appId}`,
      })
      onSaved()
    } catch (error) {
      setError((error as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>
          {account.hasKey ? "New key" : "Key"} for {account.label}
        </DialogTitle>
        <DialogDescription>
          From{" "}
          <a href={APPS_URL} target="_blank" rel="noreferrer">
            etsy.com/developers/your-apps
          </a>
          .{" "}
          {account.hasKey
            ? "Etsy checks it before it replaces the old one; another app's key ends the connection."
            : "Etsy checks it before it's saved."}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <KeyFields value={key} onChange={setKey} autoFocus />
        {error && <p className="text-xs text-pretty text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !key.keystring.trim() || !key.secret.trim()} className="active:scale-[0.97]">
          {busy && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
          Save key
        </Button>
      </DialogFooter>
    </form>
  )
}

function KeyFields({ value, onChange, autoFocus }: { value: Key; onChange: (value: Key) => void; autoFocus?: boolean }) {
  return (
    <>
      <Field label="Keystring">
        <Input
          value={value.keystring}
          onChange={(event) => onChange({ ...value, keystring: event.target.value })}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          className="font-mono text-xs md:text-xs"
        />
      </Field>
      <Field label="Shared secret">
        <Input
          type="password"
          value={value.secret}
          onChange={(event) => onChange({ ...value, secret: event.target.value })}
          autoComplete="new-password"
          className="font-mono text-xs md:text-xs"
        />
      </Field>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  )
}

// --- The account's menu ---

export function AccountMenu({ account, className }: { account: AccountView; className?: string }) {
  const [dialog, setDialog] = React.useState<"key" | "disconnect" | "remove" | null>(null)
  const linked = account.connected || !!account.connectionError
  const close = (open: boolean) => {
    if (!open) setDialog(null)
  }

  async function switchRole() {
    const before = account.role
    const role: AccountRole = before === "upload" ? "analysis" : "upload"
    try {
      await patchAccount(account.id, { role })
      toast(`${account.label} is ${role === "upload" ? "an upload" : "an analysis"} account now`, {
        action: {
          label: "Undo",
          onClick: () => {
            patchAccount(account.id, { role: before }).catch((error) => toast.error(`Couldn't undo: ${error.message}`))
          },
        },
      })
    } catch (error) {
      toast.error(`Couldn't change it: ${(error as Error).message}`)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`More for ${account.label}`}
              className={cn("shrink-0 text-muted-foreground data-popup-open:bg-muted", className)}
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => setDialog("key")}>
            <KeyRoundIcon />
            {account.hasKey ? "Replace API key…" : "Add API key…"}
          </DropdownMenuItem>
          {account.hasKey && (
            <DropdownMenuItem onClick={() => window.location.assign(connectHref(account.id))}>
              <LogInIcon />
              {linked ? "Connect again" : "Connect to Etsy"}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={switchRole}>
            <ArrowLeftRightIcon />
            {account.role === "upload" ? "Use for analysis only" : "Use for uploads"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {linked && (
            <DropdownMenuItem onClick={() => setDialog("disconnect")}>
              <UnplugIcon />
              Disconnect from Etsy…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onClick={() => setDialog("remove")}>
            <Trash2Icon />
            Remove account…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <KeyDialog account={account} open={dialog === "key"} onOpenChange={close} />
      <Confirm
        open={dialog === "disconnect"}
        onOpenChange={close}
        title={`Disconnect ${account.label}?`}
        action="Disconnect"
        onConfirm={async () => {
          await patchAccount(account.id, { disconnect: true })
          toast(`${account.label} is disconnected`)
        }}
      >
        The shop owner&apos;s grant is forgotten here. Uploads and the sales sync stop until it&apos;s connected again.
      </Confirm>
      <Confirm
        open={dialog === "remove"}
        onOpenChange={close}
        title={`Remove ${account.label}?`}
        action="Remove"
        onConfirm={async () => {
          await deleteAccount(account.id)
          toast(`Removed ${account.label}`)
        }}
      >
        Its settings, key and Etsy connection are deleted from this app. The shop and its listings on Etsy stay as they
        are.
      </Confirm>
    </>
  )
}

function Confirm({
  open,
  onOpenChange,
  title,
  action,
  onConfirm,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  action: string
  onConfirm: () => Promise<void>
  children: React.ReactNode
}) {
  const [busy, setBusy] = React.useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-pretty">{children}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy} autoFocus className="active:scale-[0.97]">
            {busy && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
