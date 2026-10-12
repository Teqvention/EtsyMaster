"use client"

import Image from "next/image"
import * as React from "react"
import { CheckIcon, ImageIcon, LoaderCircleIcon, PencilIcon, SearchCheckIcon, Trash2Icon, TriangleAlertIcon, Undo2Icon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useSeoRuns } from "@/hooks/use-city-seo"
import type { SeoBand, SeoChange, SeoProposal, SeoRun } from "@/lib/citys/seo"
import { cn } from "@/lib/utils"

import { plural } from "./shared"

// SEO for picked city listings: Gemini proposes a title and 13 tags for
// each, by the keyword strategy and what the place's listings in other shops
// use, changing little where a listing performs. Each proposal shows what
// changes (new words and tags marked, dropped tags struck), can be edited or
// left out, and the rest go to Etsy in one go.

const CHANGE: Record<SeoChange, { label: string; className: string }> = {
  rewrite: { label: "Rewrite", className: "bg-brand/10 text-brand dark:text-orange-300" },
  light: { label: "Light", className: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  keep: { label: "Keep", className: "bg-muted text-muted-foreground" },
}

const BAND: Record<SeoBand, { label: string; hint: string }> = {
  strong: { label: "Strong", hint: "Sells, or draws views and favourites: changed lightly" },
  some: { label: "Some", hint: "Seen, little else" },
  weak: { label: "Weak", hint: "Hardly seen: free to rewrite" },
}

const timeOf = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

const changes = (p: SeoProposal) => p.title !== p.before.title || p.tags.join("\n") !== p.before.tags.join("\n")
const applicable = (p: SeoProposal) => (p.status === "proposed" || p.status === "failed") && changes(p)

export function SeoSheet({ open, onOpenChange, picked }: { open: boolean; onOpenChange: (open: boolean) => void; picked: number[] }) {
  const seo = useSeoRuns(open)
  const [runId, setRunId] = React.useState<string | null>(null)
  const [starting, setStarting] = React.useState(false)
  const run = seo.runs?.find((r) => r.id === runId) ?? (runId === "new" ? null : (seo.runs?.[0] ?? null))
  const fresh = runId === "new" || (!run && picked.length > 0)

  async function analyse() {
    setStarting(true)
    try {
      const started = await seo.start(picked)
      setRunId(started.id)
    } catch (error) {
      toast.error(`Couldn't start: ${(error as Error).message}`)
    } finally {
      setStarting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="gap-1 border-b p-4 pr-12">
          <SheetTitle className="flex items-center gap-2 text-base">
            <SearchCheckIcon className="size-4 text-muted-foreground" />
            SEO
          </SheetTitle>
          <SheetDescription className="text-xs">
            Titles and tags by the keyword strategy and what other shops&apos; listings of the same place use. Listings that sell or draw views change little.
          </SheetDescription>
          {(seo.runs?.length ?? 0) > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Select
                value={fresh ? "new" : (run?.id ?? "")}
                items={[
                  ...(picked.length ? [{ value: "new", label: `New: ${plural(picked.length, "picked listing")}` }] : []),
                  ...(seo.runs ?? []).map((r) => ({ value: r.id, label: `${timeOf(r.createdAt)} · ${plural(r.total, "listing")}` })),
                ]}
                onValueChange={(value) => value && setRunId(value)}
              >
                <SelectTrigger size="sm" className="w-64" aria-label="Analysis">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {picked.length > 0 && <SelectItem value="new">New: {plural(picked.length, "picked listing")}</SelectItem>}
                  {(seo.runs ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {timeOf(r.createdAt)} · {plural(r.total, "listing")}
                      {r.status === "running" && " · analysing"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {run && !fresh && run.status !== "running" && !run.proposals.some((p) => p.status === "queued") && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label="Remove this analysis"
                  title="Remove this analysis (nothing changes on Etsy)"
                  onClick={async () => {
                    try {
                      await seo.remove(run.id)
                      setRunId(null)
                    } catch (error) {
                      toast.error((error as Error).message)
                    }
                  }}
                >
                  <Trash2Icon />
                </Button>
              )}
            </div>
          )}
        </SheetHeader>

        {!seo.runs ? (
          <div className="flex flex-col gap-3 p-4">
            {seo.error ? <p className="text-sm text-destructive">{seo.error}</p> : [0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
          </div>
        ) : fresh ? (
          <StartPanel count={picked.length} starting={starting} onStart={analyse} />
        ) : run ? (
          <RunView key={run.id} run={run} onEdit={seo.edit} onApply={seo.apply} />
        ) : (
          <div className="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">Pick city listings in the table, then open SEO.</div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function StartPanel({ count, starting, onStart }: { count: number; starting: boolean; onStart: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-muted">
        <SearchCheckIcon className="size-5 text-muted-foreground" />
      </div>
      <div className="flex max-w-sm flex-col gap-1.5">
        <p className="text-sm font-medium">Analyse {plural(count, "city listing")}</p>
        <p className="text-xs text-pretty text-muted-foreground">
          Listings of one place are worked on together, so they cover different searches. Nothing changes on Etsy until you apply it.
        </p>
      </div>
      <Button onClick={onStart} disabled={!count || starting} className="active:scale-[0.97]">
        {starting ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <SearchCheckIcon />}
        Analyse SEO
      </Button>
    </div>
  )
}

type Filter = "all" | SeoChange | "applied"

function RunView({ run, onEdit, onApply }: { run: SeoRun; onEdit: ReturnType<typeof useSeoRuns>["edit"]; onApply: ReturnType<typeof useSeoRuns>["apply"] }) {
  const [filter, setFilter] = React.useState<Filter>("all")
  const [left, setLeft] = React.useState<Set<number>>(new Set())
  const [confirming, setConfirming] = React.useState(false)
  const [applying, setApplying] = React.useState(false)

  const counts = { rewrite: 0, light: 0, keep: 0, applied: 0 }
  for (const p of run.proposals) {
    counts[p.change]++
    if (p.status === "applied") counts.applied++
  }
  const shown = run.proposals.filter((p) => (filter === "all" ? true : filter === "applied" ? p.status === "applied" : p.change === filter))
  const toApply = run.proposals.filter((p) => applicable(p) && !left.has(p.listingId))
  const queued = run.proposals.filter((p) => p.status === "queued").length

  async function apply() {
    setApplying(true)
    try {
      await onApply(run.id, toApply.map((p) => p.listingId))
      setConfirming(false)
    } catch (error) {
      toast.error(`Couldn't apply: ${(error as Error).message}`)
    } finally {
      setApplying(false)
    }
  }

  if (run.status === "running" && !run.proposals.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-muted-foreground">{run.step}</p>
        <Progress value={run.total ? (run.done / run.total) * 100 : 0} className="w-56" />
        <p className="text-xs text-muted-foreground tabular-nums">
          {run.done} of {run.total}
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <ToggleGroup value={[filter]} onValueChange={(v) => v[0] && setFilter(v[0] as Filter)} variant="outline" size="sm">
          <ToggleGroupItem value="all">All {run.proposals.length}</ToggleGroupItem>
          {(["rewrite", "light", "keep"] as const).map((c) => (
            <ToggleGroupItem key={c} value={c} disabled={!counts[c]}>
              {CHANGE[c].label} {counts[c]}
            </ToggleGroupItem>
          ))}
          {counts.applied > 0 && <ToggleGroupItem value="applied">Applied {counts.applied}</ToggleGroupItem>}
        </ToggleGroup>
        {run.status === "running" && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
            <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
            {run.done} of {run.total}
          </span>
        )}
      </div>
      {run.error && (
        <p className="flex items-center gap-1.5 border-b px-4 py-2 text-xs text-destructive">
          <TriangleAlertIcon className="size-3.5" />
          {run.error}
        </p>
      )}
      {run.note && <p className="border-b px-4 py-2 text-xs text-amber-700 dark:text-amber-400">{run.note}</p>}

      <ul className="flex-1 overflow-y-auto">
        {shown.map((p) => (
          <ProposalRow
            key={p.listingId}
            proposal={p}
            included={!left.has(p.listingId)}
            onInclude={(include) =>
              setLeft((s) => {
                const next = new Set(s)
                if (include) next.delete(p.listingId)
                else next.add(p.listingId)
                return next
              })
            }
            onEdit={(edit) => onEdit(run.id, { listingId: p.listingId, ...edit })}
          />
        ))}
      </ul>

      <SheetFooter className="flex-row items-center justify-between gap-2 border-t p-3">
        <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {queued ? `Applying on Etsy · ${queued} left` : toApply.length ? `${plural(toApply.length, "change")} ready` : "Nothing left to apply"}
        </span>
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-xs">Change {plural(toApply.length, "listing")} on Etsy?</span>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={apply} disabled={applying} className="active:scale-[0.97]">
              {applying ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <CheckIcon />}
              Apply
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={() => setConfirming(true)} disabled={!toApply.length || run.status === "running" || queued > 0} className="active:scale-[0.97]">
            Apply {toApply.length ? plural(toApply.length, "change") : ""} on Etsy
          </Button>
        )}
      </SheetFooter>
    </>
  )
}

/** The words of `next` that `before` doesn't have, marked. */
function NewWords({ next, before }: { next: string; before: string }) {
  const known = new Set(before.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean))
  return (
    <>
      {next.split(/([^\p{L}\p{N}']+)/u).map((word, i) =>
        word && /[\p{L}\p{N}]/u.test(word) && !known.has(word.toLowerCase()) ? (
          <mark key={i} className="rounded-sm bg-emerald-500/15 px-px text-inherit">
            {word}
          </mark>
        ) : (
          <React.Fragment key={i}>{word}</React.Fragment>
        )
      )}
    </>
  )
}

function ProposalRow({
  proposal: p,
  included,
  onInclude,
  onEdit,
}: {
  proposal: SeoProposal
  included: boolean
  onInclude: (include: boolean) => void
  onEdit: (edit: { title?: string; tags?: string[]; status?: "proposed" | "dropped" }) => Promise<void>
}) {
  const [editing, setEditing] = React.useState(false)
  const [title, setTitle] = React.useState(p.title)
  const [tags, setTags] = React.useState(p.tags.join(", "))
  const [saving, setSaving] = React.useState(false)
  const changed = changes(p)
  const removed = p.before.tags.filter((t) => !p.tags.includes(t))
  const added = new Set(p.tags.filter((t) => !p.before.tags.includes(t)))
  const draftTags = tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
  const dropped = p.status === "dropped"

  async function save() {
    setSaving(true)
    try {
      await onEdit({ title, tags: draftTags })
      setEditing(false)
    } catch (error) {
      toast.error(`Couldn't save: ${(error as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className={cn("flex gap-3 border-b px-4 py-3", dropped && "opacity-50")}>
      <div className="flex shrink-0 flex-col items-center gap-2 pt-0.5">
        <Checkbox
          checked={included && applicable(p)}
          disabled={!applicable(p)}
          onCheckedChange={(checked) => onInclude(!!checked)}
          aria-label={`Apply the proposal for ${p.before.title}`}
        />
      </div>
      <span className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
        {p.thumb ? <Image src={p.thumb} alt="" fill unoptimized sizes="56px" className="object-cover" /> : <ImageIcon className="size-4 text-muted-foreground" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className={cn("inline-flex h-[18px] items-center rounded px-1.5 font-medium", CHANGE[p.change].className)}>{CHANGE[p.change].label}</span>
          <span className="text-muted-foreground" title={`${BAND[p.band].hint}: ${p.numbers}`}>
            {BAND[p.band].label} · {p.numbers}
          </span>
          <span className="ml-auto flex items-center gap-1">
            {p.status === "applied" && (
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <CheckIcon className="size-3" />
                On Etsy
              </span>
            )}
            {p.status === "queued" && <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Applying" />}
            {p.status === "failed" && p.error && (
              <span className="text-destructive" title={p.error}>
                Failed
              </span>
            )}
            {(p.status === "proposed" || p.status === "failed" || dropped) && !editing && (
              <>
                {!dropped && (
                  <Button variant="ghost" size="icon-xs" aria-label="Edit" title="Edit the title and tags" onClick={() => setEditing(true)}>
                    <PencilIcon />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={dropped ? "Take it back" : "Leave it out"}
                  title={dropped ? "Take it back" : "Leave this listing as it is"}
                  onClick={() => void onEdit({ status: dropped ? "proposed" : "dropped" })}
                >
                  {dropped ? <Undo2Icon /> : <XIcon />}
                </Button>
              </>
            )}
          </span>
        </div>

        {editing ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" className="h-8 text-[13px]" maxLength={160} />
              <span className={cn("self-end text-[10px] tabular-nums", title.length > 140 ? "text-destructive" : "text-muted-foreground")}>{title.length}/140</span>
            </div>
            <div className="flex flex-col gap-1">
              <Textarea value={tags} onChange={(e) => setTags(e.target.value)} aria-label="Tags, separated by commas" rows={3} className="text-xs" />
              <span className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
                <span className="text-destructive">{draftTags.filter((t) => t.length > 20).map((t) => `“${t}” is over 20`).join(" · ")}</span>
                <span className={cn(draftTags.length > 13 && "text-destructive")}>{draftTags.length}/13 tags</span>
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving || title.length > 140 || !title.trim()} className="active:scale-[0.97]">
                {saving && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
                Save
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[13px] leading-snug text-pretty">{changed ? <NewWords next={p.title} before={p.before.title} /> : p.title}</p>
            {p.title !== p.before.title && <p className="text-[11px] leading-snug text-muted-foreground line-through decoration-muted-foreground/40">{p.before.title}</p>}
            <div className="flex flex-wrap gap-1">
              {p.tags.map((t) => (
                <span
                  key={t}
                  className={cn(
                    "inline-flex h-5 items-center rounded px-1.5 text-[11px]",
                    added.has(t) && changed ? "bg-emerald-500/12 text-emerald-800 dark:text-emerald-300" : "bg-muted text-muted-foreground"
                  )}
                >
                  {t}
                </span>
              ))}
              {changed &&
                removed.map((t) => (
                  <span key={`-${t}`} className="inline-flex h-5 items-center rounded px-1.5 text-[11px] text-muted-foreground/70 line-through" title="Dropped">
                    {t}
                  </span>
                ))}
            </div>
            {p.why && <p className="text-[11px] leading-snug text-pretty text-muted-foreground">{p.why}</p>}
            {p.error && <p className="text-[11px] text-destructive">{p.error}</p>}
          </>
        )}
      </div>
    </li>
  )
}
