"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { CopyIcon, FileImageIcon, LayoutTemplateIcon, LoaderCircleIcon, MoreHorizontalIcon, PlusIcon, StarIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import type { CompositionSummary } from "@/lib/citys/composition/model"
import { cn } from "@/lib/utils"

// Citys → Compositions: the layouts city photos are set in for print, the
// place's name, country, coordinates and words around the photo. One starts
// from our starter layout or is rebuilt from a poster image; the upload
// picks one per group of posters. A star marks a good example (remixes learn
// from those), a percentage how alike a rebuilt one came out.

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result as T
}

export function CompositionsView() {
  const router = useRouter()
  const [list, setList] = React.useState<CompositionSummary[] | null>(null)
  const [busy, setBusy] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)

  const load = React.useCallback(() => json<CompositionSummary[]>("/api/citys/compositions").then(setList, () => setList([])), [])
  React.useEffect(() => {
    void load()
  }, [load])
  React.useEffect(() => {
    if (!list?.some((c) => c.busy)) return
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [list, load])

  async function create() {
    setBusy(true)
    try {
      const made = await json<{ id: string }>("/api/citys/compositions", { method: "POST", body: JSON.stringify({ name: "New composition" }) })
      router.push(`/citys/compositions/${made.id}`)
    } catch (error) {
      toast.error((error as Error).message)
      setBusy(false)
    }
  }

  async function fromImage(file: File) {
    setBusy(true)
    try {
      const made = await json<{ id: string }>("/api/citys/compositions", { method: "POST", body: JSON.stringify({ name: file.name.replace(/\.[a-z]+$/i, "").slice(0, 40) || "From an image" }) })
      const body = new FormData()
      body.append("file", file)
      await json(`/api/citys/compositions/${made.id}/import`, { method: "POST", body })
      router.push(`/citys/compositions/${made.id}`)
    } catch (error) {
      toast.error((error as Error).message)
      setBusy(false)
    }
  }

  const buttons = (
    <>
      <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy} className="active:scale-[0.97]">
        <FileImageIcon />
        From a poster image
      </Button>
      <Button size="sm" onClick={create} disabled={busy} className="active:scale-[0.97]">
        {busy ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
        New composition
      </Button>
    </>
  )

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto max-w-2xl text-sm text-muted-foreground">
          Layouts the city photos are printed in: the name, country, coordinates and words around the photo. Every print size is made from one layout, with the same air around everything.
        </p>
        {buttons}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void fromImage(file)
          e.target.value = ""
        }}
      />
      {list === null ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-[3/4] rounded-xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Empty className="min-h-[50svh] border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutTemplateIcon />
            </EmptyMedia>
            <EmptyTitle>No composition yet</EmptyTitle>
            <EmptyDescription>Start from our layout, or give it a poster you like: its text, fonts, rules and spacing are rebuilt as a layout of your own.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">{buttons}</EmptyContent>
        </Empty>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-4">
          {list.map((c) => (
            <li key={c.id} className="group/card relative">
              <Link
                href={`/citys/compositions/${c.id}`}
                className="flex flex-col overflow-hidden rounded-xl border bg-card outline-none transition-[border-color,transform] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99] [@media(hover:hover)]:hover:border-foreground/30"
              >
                <div className="relative bg-muted/40 p-3" style={{ aspectRatio: "3 / 4" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.preview} alt="" loading="lazy" className="absolute inset-3 m-auto max-h-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] object-contain shadow-sm" />
                  {c.busy && (
                    <span className="absolute inset-x-3 bottom-3 flex items-center justify-center gap-1.5 rounded-md bg-background/90 py-1 text-xs">
                      <LoaderCircleIcon className="size-3 animate-spin" />
                      {c.busy}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  {c.example && <StarIcon className="size-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label="Good example" />}
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  {c.score !== undefined && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums" title="How alike the poster it was rebuilt from">
                      {Math.round(c.score)} %
                    </span>
                  )}
                  <span className={cn("shrink-0 text-xs text-muted-foreground tabular-nums", c.score === undefined && "ml-auto")}>v{c.version}</span>
                </div>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="secondary" size="icon-xs" className="absolute top-2 right-2 opacity-0 group-hover/card:opacity-100 data-popup-open:opacity-100" aria-label="More" />}>
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() =>
                      json<{ id: string }>(`/api/citys/compositions/${c.id}`, { method: "POST", body: JSON.stringify({ action: "duplicate" }) }).then(
                        () => load(),
                        (e: Error) => toast.error(e.message)
                      )
                    }
                  >
                    <CopyIcon />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => json(`/api/citys/compositions/${c.id}`, { method: "DELETE" }).then(() => load(), (e: Error) => toast.error(e.message))}
                  >
                    <Trash2Icon />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
