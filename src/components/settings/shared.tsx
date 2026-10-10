"use client"

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { patchAccount } from "@/hooks/use-accounts"
import type { AccountView } from "@/lib/accounts/types"
import { cn } from "@/lib/utils"

// What every part of Settings is built from: panels with a small heading,
// label/value rows, inputs saved on blur, selects saved on change, status dots.

/** A panel of its own, e.g. the Gelato keys. */
export function Section({
  title,
  aside,
  className,
  children,
}: {
  title: string
  aside?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section aria-label={title} className={cn("flex min-w-0 flex-col gap-2 rounded-lg border p-3", className)}>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** The heading of a block inside a panel. */
export function BlockTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-2">
      <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{children}</h3>
      {aside}
    </div>
  )
}

/** Labels on the left, values on the right, lined up on their first line. */
export function Rows({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <dl className={cn("grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3 text-[13px]", className)}>
      {children}
    </dl>
  )
}

export function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}</dt>
      <dd className="flex min-w-0 flex-col items-start gap-1">{children}</dd>
    </>
  )
}

/** A hint under a value; `tone` colours it when something's off. */
export function Note({
  tone,
  className,
  children,
}: {
  tone?: "ok" | "warn" | "error"
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "text-xs text-pretty [&_svg]:mr-1 [&_svg]:inline [&_svg]:size-3 [&_svg]:align-[-0.125em]",
        tone === "ok"
          ? "text-emerald-700 dark:text-emerald-400"
          : tone === "warn"
            ? "text-amber-700 dark:text-amber-400"
            : tone === "error"
              ? "text-destructive"
              : "text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  )
}

const DOTS = {
  ok: "before:bg-emerald-500",
  warn: "before:bg-amber-500",
  error: "before:bg-destructive",
  off: "before:bg-muted-foreground/40",
}

/** A word or two with a coloured dot before it: how something stands. */
export function Status({
  tone,
  className,
  title,
  children,
}: {
  tone: keyof typeof DOTS
  className?: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <span
      title={title}
      className={cn(
        "before:mr-1.5 before:inline-block before:size-1.5 before:rounded-full before:align-middle",
        DOTS[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

/** Text edited in place and saved on blur or Enter; Escape puts the saved text back. */
export function SavedInput({
  value,
  onSave,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "onFocus" | "onBlur" | "onKeyDown"> & {
  value: string
  /** Gets the trimmed text when it changed; the text stays on screen until this settles. */
  onSave: (value: string) => unknown
}) {
  const [text, setText] = React.useState(value)
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState<string | null>(null)
  return (
    <Input
      {...props}
      value={editing ? text : (saving ?? value)}
      onFocus={() => {
        setText(value)
        setEditing(true)
      }}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        setEditing(false)
        const next = text.trim()
        if (next === value.trim()) return
        setSaving(next)
        Promise.resolve(onSave(next)).finally(() => setSaving(null))
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        else if (event.key === "Escape") {
          setText(value)
          requestAnimationFrame(() => (event.target as HTMLInputElement).blur())
        }
      }}
      className={cn("h-7 px-2 text-[13px] md:text-[13px]", className)}
    />
  )
}

/** A select saved on change; an item whose value is null names the empty choice. */
export function Choice<T extends string | number>({
  label,
  value,
  items,
  placeholder,
  disabled,
  className,
  onChange,
}: {
  label: string
  value: T | null
  items: { value: T | null; label: string }[]
  placeholder?: string
  disabled?: boolean
  className?: string
  onChange: (value: T | null) => void
}) {
  return (
    <Select
      value={value}
      items={items}
      onValueChange={(next) => next !== value && onChange(next as T | null)}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className={cn("w-full min-w-0 text-[13px]", className)} aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={String(item.value)} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Saves a change to an account; a failure is told in a toast. Resolves to the account, or null. */
export function saveAccount(id: string, patch: Parameters<typeof patchAccount>[1]) {
  return patchAccount(id, patch).catch((error: Error) => {
    toast.error(`Couldn't save: ${error.message}`)
    return null
  })
}

/** Where a sign-in with Etsy starts. A plain link: nothing may prefetch it. */
export const connectHref = (id: string) => `/api/accounts/${encodeURIComponent(id)}/connect`

/** Sends the browser to Etsy to connect the account. */
export function ConnectButton({
  account,
  ...props
}: { account: AccountView } & Omit<React.ComponentProps<typeof Button>, "render" | "nativeButton">) {
  return <Button nativeButton={false} render={<a href={connectHref(account.id)} />} {...props} />
}

export async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    toast.error("Couldn't copy to the clipboard")
  }
}
