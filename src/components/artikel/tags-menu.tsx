"use client"

import * as React from "react"
import { CheckIcon, MinusIcon, PlusIcon, Settings2Icon, TagIcon, TrashIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { assignTags, createTag, deleteTag, updateTag } from "@/hooks/use-artikel"
import { TAG_COLORS, type ArtikelRow, type InternalTag, type TagColor } from "@/lib/artikel/types"
import { cn } from "@/lib/utils"

import { plural, TAG_CLASS } from "./shared"

// Internal tags on the picked listings: a click puts a tag on all of them,
// or takes it off when all have it; typing a new name makes the tag. The
// manager renames, recolours and deletes them.

export function TagsPopover({ picked, rows, tags }: { picked: number[]; rows: ArtikelRow[]; tags: InternalTag[] }) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [managing, setManaging] = React.useState(false)
  const pickedSet = new Set(picked)
  const counts = new Map<string, number>()
  for (const r of rows) {
    if (!pickedSet.has(r.listingId)) continue
    for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  }

  async function toggle(tag: InternalTag) {
    const all = counts.get(tag.id) === picked.length
    try {
      await assignTags(picked, all ? { remove: [tag.id] } : { add: [tag.id] })
    } catch (error) {
      toast.error(`Couldn't change the tags: ${(error as Error).message}`)
    }
  }

  async function create() {
    const clean = name.trim()
    if (!clean) return
    try {
      const tag = await createTag(clean)
      if (tag) await assignTags(picked, { add: [tag.id] })
      setName("")
    } catch (error) {
      toast.error(`Couldn't make the tag: ${(error as Error).message}`)
    }
  }

  const matches = tags.filter((t) => t.name.toLowerCase().includes(name.trim().toLowerCase()))
  const exact = tags.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button variant="ghost" size="sm" />}>
          <TagIcon />
          Tags
        </PopoverTrigger>
        <PopoverContent side="top" align="center" className="w-64 gap-2 p-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                const only = matches.length === 1 ? matches[0] : null
                if (exact || only) void toggle(exact ? tags.find((t) => t.name.toLowerCase() === name.trim().toLowerCase())! : only!)
                else void create()
              }
            }}
            placeholder="Find or make a tag"
            className="h-7"
            aria-label="Tag name"
            maxLength={32}
            autoFocus
          />
          <ul className="flex max-h-60 flex-col overflow-y-auto" role="listbox" aria-label="Internal tags" aria-multiselectable>
            {matches.map((tag) => {
              const n = counts.get(tag.id) ?? 0
              const all = n === picked.length
              return (
                <li key={tag.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={all}
                    onClick={() => toggle(tag)}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm outline-none focus-visible:bg-accent [@media(hover:hover)]:hover:bg-accent"
                  >
                    <span className="grid size-4 shrink-0 place-items-center rounded-[4px] border">
                      {all ? <CheckIcon className="size-3" /> : n > 0 ? <MinusIcon className="size-3" /> : null}
                    </span>
                    <span className={cn("size-2 shrink-0 rounded-full", TAG_CLASS[tag.color].dot)} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                    {n > 0 && !all && <span className="text-[11px] text-muted-foreground tabular-nums">{n}</span>}
                  </button>
                </li>
              )
            })}
            {name.trim() && !exact && (
              <li>
                <button
                  type="button"
                  onClick={create}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm outline-none focus-visible:bg-accent [@media(hover:hover)]:hover:bg-accent"
                >
                  <PlusIcon className="size-4 text-muted-foreground" />
                  <span className="truncate">
                    Make “{name.trim()}”
                  </span>
                </button>
              </li>
            )}
            {!tags.length && !name.trim() && (
              <li className="px-1.5 py-1 text-xs text-muted-foreground">No tags yet: type a name to make one.</li>
            )}
          </ul>
          <div className="flex items-center justify-between border-t pt-1.5 text-[11px] text-muted-foreground">
            <span>On {plural(picked.length, "listing")}</span>
            {tags.length > 0 && (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => {
                  setOpen(false)
                  setManaging(true)
                }}
              >
                <Settings2Icon />
                Manage
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <TagManager open={managing} onOpenChange={setManaging} tags={tags} rows={rows} />
    </>
  )
}

export function TagManager({
  open,
  onOpenChange,
  tags,
  rows,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tags: InternalTag[]
  rows: ArtikelRow[]
}) {
  const used = new Map<string, number>()
  for (const r of rows) for (const t of r.tags) used.set(t, (used.get(t) ?? 0) + 1)
  const [name, setName] = React.useState("")

  async function run(what: string, work: () => Promise<unknown>) {
    try {
      await work()
    } catch (error) {
      toast.error(`Couldn't ${what}: ${(error as Error).message}`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Internal tags</DialogTitle>
          <DialogDescription>Ours only: Etsy never sees them. Filter Artikel by them and aim bulk actions at them.</DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-[50svh] flex-col gap-1 overflow-y-auto">
          {tags.map((tag) => (
            <TagLine key={tag.id} tag={tag} count={used.get(tag.id) ?? 0} run={run} />
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!name.trim()) return
            void run("make the tag", async () => {
              await createTag(name)
              setName("")
            })
          }}
        >
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="New tag" className="h-8" maxLength={32} aria-label="New tag" />
          <Button type="submit" variant="outline" disabled={!name.trim()}>
            <PlusIcon />
            Add
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TagLine({
  tag,
  count,
  run,
}: {
  tag: InternalTag
  count: number
  run: (what: string, work: () => Promise<unknown>) => Promise<void>
}) {
  const [name, setName] = React.useState(tag.name)
  const [confirm, setConfirm] = React.useState(false)
  return (
    <li className="flex items-center gap-2">
      <ColorPicker value={tag.color} onChange={(color) => run("recolour it", () => updateTag(tag.id, { color }))} />
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => name.trim() && name.trim() !== tag.name && run("rename it", () => updateTag(tag.id, { name }))}
        onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        className="h-7 flex-1"
        maxLength={32}
        aria-label={`Name of ${tag.name}`}
      />
      <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{plural(count, "listing")}</span>
      {confirm ? (
        <Button variant="destructive" size="sm" onClick={() => run("delete it", () => deleteTag(tag.id))} onBlur={() => setConfirm(false)} autoFocus>
          Delete
        </Button>
      ) : (
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Delete ${tag.name}`} onClick={() => setConfirm(true)}>
          <TrashIcon />
        </Button>
      )}
    </li>
  )
}

function ColorPicker({ value, onChange }: { value: TagColor; onChange: (color: TagColor) => void }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Colour"
            className="grid size-7 shrink-0 place-items-center rounded-md border outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:bg-muted"
          />
        }
      >
        <span className={cn("size-3 rounded-full", TAG_CLASS[value].dot)} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-1.5">
        <div className="grid grid-cols-5 gap-1">
          {TAG_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              aria-pressed={color === value}
              onClick={() => onChange(color)}
              className={cn(
                "grid size-6 place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:bg-muted",
                color === value && "bg-muted"
              )}
            >
              <span className={cn("size-3 rounded-full", TAG_CLASS[color].dot)} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
