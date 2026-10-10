"use client"

import Link from "next/link"
import * as React from "react"
import {
  ChevronDownIcon,
  CircleAlertIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  RotateCwIcon,
  Settings2Icon,
  SparklesIcon,
  StoreIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"

import { AdoptionBadge } from "@/components/uploads/adoption"
import { exportPackage } from "@/components/uploads/export-package"
import { TagEditor } from "@/components/uploads/tag-editor"
import { UploadBadge } from "@/components/uploads/upload-status"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { deleteDraft, isWriting, patchDraft, restorePosters, rewriteDraft } from "@/hooks/use-uploads"
import type { MockupChain } from "@/lib/mockups/chain-types"
import { posterKey, type PosterStatus, type PosterUpload } from "@/lib/uploads/groups"
import { TITLE_MAX, type DraftStatus, type DraftView } from "@/lib/uploads/types"
import { cn } from "@/lib/utils"

// One draft on the Uploads page: the poster on the left; its listing copy
// (title, tags, description), editable in place, on the right; and below,
// the mockup chain, the package export, where the draft stands and its
// upload to Etsy.

export const STATUS_LABELS: Record<DraftStatus, string> = { draft: "Draft", ready: "Ready", uploaded: "Uploaded" }

const NO_CHAIN = "none"

const HINTS = [
  "More gift-focused",
  "Closer to the source",
  "More of our own words",
  "Lead with the style",
  "Room & decor angle",
  "Shorter, punchier title",
]

/** The draft's poster against the upload pipeline. */
export type DraftUpload = {
  /** Its newest real upload. */
  upload?: PosterUpload
  uploadStatus?: PosterStatus
  /** May go into a new upload. */
  uploadable?: boolean
  onUpload?: () => void
}

export function DraftRow({
  draft,
  chains,
  upload,
  uploadStatus,
  uploadable = false,
  onUpload,
}: { draft: DraftView; chains: MockupChain[] } & DraftUpload) {
  const writing = isWriting(draft)
  const hasCopy = !!draft.title
  const locked = writing || draft.status === "uploaded"

  function save(patch: Parameters<typeof patchDraft>[1]) {
    patchDraft(draft.id, patch).catch((error) => toast.error(`Couldn't save: ${error.message}`))
  }

  return (
    <article aria-label={draft.title ?? draft.source.title} className="grid grid-cols-[5.5rem_1fr] gap-3 @2xl/main:grid-cols-[9rem_1fr] @2xl/main:gap-4">
      <Poster draft={draft} />

      <div className="flex min-w-0 flex-col gap-3">
        <Meta draft={draft} upload={upload} uploadStatus={uploadStatus} />

        {!hasCopy && writing ? (
          <WritingSkeleton />
        ) : !hasCopy && draft.copy === "error" ? (
          <Failed draft={draft} />
        ) : (
          <div className={cn("flex flex-col gap-3 transition-opacity duration-200", writing && "opacity-60")}>
            {draft.copy === "error" && <Failed draft={draft} />}
            <TitleField draft={draft} disabled={locked} onSave={(title) => save({ title })} />
            <TagEditor draft={draft} disabled={locked} onChange={(tags) => save({ tags })} />
            <Description draft={draft} disabled={locked} onSave={(description) => save({ description })} />
          </div>
        )}

        <Actions
          draft={draft}
          chains={chains}
          writing={writing}
          onSave={save}
          uploadable={uploadable}
          onUpload={onUpload}
        />
      </div>
    </article>
  )
}

// --- Poster and what it came from ---

function Poster({ draft }: { draft: DraftView }) {
  const ratio = draft.posterWidth && draft.posterHeight ? `${draft.posterWidth} / ${draft.posterHeight}` : "2 / 3"
  return (
    <Link
      href={`/generation/${draft.generationId}${draft.posterIndex !== undefined ? `?poster=${draft.posterIndex + 1}` : ""}`}
      className="group/poster relative self-start overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      style={{ aspectRatio: ratio }}
      aria-label="Open its steal on Generation"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={draft.poster}
        alt=""
        loading="lazy"
        draggable={false}
        className="size-full object-cover transition-transform duration-300 ease-out-strong motion-reduce:transition-none [@media(hover:hover)]:group-hover/poster:scale-[1.03]"
      />
      <span className="absolute inset-x-1.5 bottom-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-center text-[11px] font-medium text-white opacity-0 backdrop-blur-sm transition-opacity duration-150 group-focus-visible/poster:opacity-100 [@media(hover:hover)]:group-hover/poster:opacity-100">
        Open steal
      </span>
    </Link>
  )
}

function Meta({
  draft,
  upload,
  uploadStatus,
}: { draft: DraftView } & Pick<DraftUpload, "upload" | "uploadStatus">) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <div className="flex min-w-0 flex-1 basis-72 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
        <a
          href={draft.source.url}
          target="_blank"
          rel="noreferrer"
          title={draft.source.title}
          className="inline-flex min-w-0 items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:text-foreground [&_svg]:size-3 [&_svg]:shrink-0"
        >
          <StoreIcon />
          <span className="truncate">
            {draft.source.shop ? `${draft.source.shop} · ` : ""}
            {draft.source.title}
          </span>
          <ExternalLinkIcon />
        </a>
        <span aria-hidden>·</span>
        <span>{draft.folder}</span>
        <span aria-hidden>·</span>
        <span>{draft.design.mode === "idea" ? "New idea" : "Variant"}</span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <UploadBadge status={uploadStatus} upload={upload} />
        {draft.strategy && (
          <Tooltip>
            <TooltipTrigger render={<Badge variant="secondary" className="cursor-default" />}>
              <SparklesIcon />
              {draft.strategy}
            </TooltipTrigger>
            <TooltipContent className="max-w-72">{draft.strategyWhy || "The keyword strategy this copy follows"}</TooltipContent>
          </Tooltip>
        )}
        <AdoptionBadge draft={draft} />
        {isWriting(draft) && (
          <Badge variant="outline" className="text-muted-foreground">
            <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
            {draft.copy === "queued" ? "Queued" : draft.title ? "Rewriting" : "Writing"}
          </Badge>
        )}
      </div>
    </div>
  )
}

function WritingSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-label="Writing the listing" aria-busy>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: 13 }, (_, i) => (
          <Skeleton key={i} className="h-6 rounded-md" style={{ width: `${4 + ((i * 37) % 5)}rem` }} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Reading the poster, the source listing and the keyword library…
      </p>
    </div>
  )
}

function Failed({ draft }: { draft: DraftView }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0">
      <CircleAlertIcon />
      <p className="min-w-0 flex-1">
        Couldn&apos;t write the listing{draft.title ? " again" : ""}: {draft.error ?? "unknown error"}
      </p>
      <Button
        size="xs"
        variant="outline"
        onClick={() => rewriteDraft(draft.id, draft.hint).catch((e) => toast.error(e.message))}
      >
        <RotateCwIcon />
        Try again
      </Button>
    </div>
  )
}

// --- The copy ---

/** Text that's edited locally and saved on blur; follows the draft while not focused. */
function useDraftText(value: string, onSave: (value: string) => void) {
  const [text, setText] = React.useState(value)
  const [editing, setEditing] = React.useState(false)
  const shown = editing ? text : value
  return {
    value: shown,
    onFocus: () => {
      setText(value)
      setEditing(true)
    },
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value),
    onBlur: () => {
      setEditing(false)
      if (text.trim() !== value.trim()) onSave(text)
    },
    revert: () => setText(value),
  }
}

function TitleField({ draft, disabled, onSave }: { draft: DraftView; disabled: boolean; onSave: (title: string) => void }) {
  const { revert, ...field } = useDraftText(draft.title ?? "", onSave)
  const length = field.value.length
  const over = length > TITLE_MAX
  const id = `title-${draft.id}`
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs">
        <label htmlFor={id} className="font-medium">
          Title
        </label>
        <span className={cn("ml-auto tabular-nums", over ? "font-medium text-destructive" : "text-muted-foreground")}>
          {length}/{TITLE_MAX}
        </span>
      </div>
      <textarea
        id={id}
        {...field}
        rows={1}
        disabled={disabled}
        spellCheck
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            event.currentTarget.blur()
          } else if (event.key === "Escape") {
            revert()
            requestAnimationFrame(() => (event.target as HTMLTextAreaElement).blur())
          }
        }}
        aria-invalid={over}
        className="field-sizing-content w-full resize-none rounded-lg border border-transparent bg-transparent px-2 py-1 -mx-2 text-[15px] leading-snug font-medium text-balance transition-colors duration-150 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default aria-invalid:border-destructive [@media(hover:hover)]:hover:enabled:border-input"
      />
      {over && (
        <p className="text-xs text-destructive">
          Etsy allows {TITLE_MAX} characters — it&apos;s saved up to the last whole phrase that fits.
        </p>
      )}
    </div>
  )
}

function Description({ draft, disabled, onSave }: { draft: DraftView; disabled: boolean; onSave: (text: string) => void }) {
  const { revert, ...field } = useDraftText(draft.description ?? "", onSave)
  const preview = (draft.description ?? "").split("\n")[0]
  return (
    <Collapsible className="group/description flex flex-col gap-1.5">
      <CollapsibleTrigger className="flex min-w-0 items-center gap-2 rounded-sm text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:[&>span:first-child]:underline">
        <span className="font-medium">Description</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground transition-opacity duration-150 group-data-open/description:opacity-0">
          {preview || "—"}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out-strong group-data-open/description:rotate-180 motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out-strong data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        <Textarea
          {...field}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              revert()
              requestAnimationFrame(() => (event.target as HTMLTextAreaElement).blur())
            }
          }}
          disabled={disabled}
          aria-label="Description"
          className="min-h-24 text-sm leading-relaxed"
        />
      </CollapsibleContent>
    </Collapsible>
  )
}

// --- Actions ---

function Actions({
  draft,
  chains,
  writing,
  onSave,
  uploadable,
  onUpload,
}: {
  draft: DraftView
  chains: MockupChain[]
  writing: boolean
  onSave: (patch: Parameters<typeof patchDraft>[1]) => void
  uploadable: boolean
  onUpload?: () => void
}) {
  const [progress, setProgress] = React.useState<string | null>(null)
  const chain = chains.find((c) => c.id === draft.chainId) ?? null
  const chainItems = [
    ...chains.map((c) => ({ value: c.id, label: c.isDefault ? `${c.name} (default)` : c.name })),
    { value: NO_CHAIN, label: "Poster only" },
  ]

  async function exportIt() {
    try {
      await exportPackage(draft, chain, setProgress)
    } catch (error) {
      toast.error(`Export failed: ${(error as Error).message}`)
    } finally {
      setProgress(null)
    }
  }

  function setStatus(status: DraftStatus) {
    const before = draft.status
    if (status === before) return
    patchDraft(draft.id, { status })
      .then(() =>
        toast(`Moved to ${STATUS_LABELS[status]}`, {
          action: { label: "Undo", onClick: () => onSave({ status: before }) },
        })
      )
      .catch((error) => toast.error(`Couldn't move it: ${error.message}`))
  }

  async function remove() {
    const key = posterKey(draft.generationId, draft.outputId)
    try {
      await deleteDraft(draft.id)
      toast("Poster deleted", {
        description: "Out of the uploads and no longer approved.",
        action: {
          label: "Undo",
          onClick: () => restorePosters([key]).catch((error) => toast.error(`Couldn't bring it back: ${error.message}`)),
        },
      })
    } catch (error) {
      toast.error(`Couldn't delete it: ${(error as Error).message}`)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
      <Select
        value={draft.chainId ?? NO_CHAIN}
        items={chainItems}
        onValueChange={(value) => onSave({ chainId: value && value !== NO_CHAIN ? value : null })}
        disabled={draft.status === "uploaded"}
      >
        <SelectTrigger size="sm" className="max-w-64 min-w-40" aria-label="Mockup chain">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {chainItems.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              nativeButton={false}
              render={<Link href="/mockups?tab=chains" />}
              aria-label="Edit chains in Mockups"
            />
          }
        >
          <Settings2Icon />
        </TooltipTrigger>
        <TooltipContent>Edit chains in Mockups</TooltipContent>
      </Tooltip>

      <Button variant="outline" size="sm" disabled={!draft.title || !!progress} onClick={exportIt} className="min-w-36">
        {progress ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <DownloadIcon />}
        <span className="tabular-nums">{progress ?? "Export package"}</span>
      </Button>
      <RewriteButton draft={draft} disabled={writing || draft.status === "uploaded"} />

      <div className="ml-auto flex items-center gap-2">
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[draft.status]}
          onValueChange={(value) => value[0] && setStatus(value[0] as DraftStatus)}
          aria-label="Status"
        >
          {(Object.keys(STATUS_LABELS) as DraftStatus[]).map((s) => (
            <ToggleGroupItem key={s} value={s} disabled={s !== "draft" && !draft.title} className="px-2.5">
              {STATUS_LABELS[s]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {onUpload && (uploadable || draft.status !== "uploaded") && (
          <Tooltip>
            <TooltipTrigger
              render={
                <span tabIndex={uploadable ? -1 : 0} className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
              }
            >
              <Button
                size="sm"
                disabled={!uploadable}
                tabIndex={uploadable ? 0 : -1}
                onClick={onUpload}
                className="transition-transform duration-150 ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
              >
                <UploadIcon />
                Upload…
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {uploadable ? "Choose the shop and send it to Etsy" : "On Etsy already, or its upload is under way"}
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="Delete poster" onClick={remove} />}
          >
            <Trash2Icon />
          </TooltipTrigger>
          <TooltipContent>Delete: out of the uploads and no longer approved</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

function RewriteButton({ draft, disabled }: { draft: DraftView; disabled: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [hint, setHint] = React.useState("")

  function submit() {
    setOpen(false)
    rewriteDraft(draft.id, hint.trim() || undefined).catch((error) => toast.error(`Couldn't rewrite: ${error.message}`))
    setHint("")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}>
        <RotateCwIcon />
        Rewrite
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-2.5">
        <div className="flex flex-col gap-0.5">
          <p className="font-medium">Write it again</p>
          <p className="text-xs text-muted-foreground">
            A fresh take with another strategy. Say what should change, or leave it empty.
          </p>
        </div>
        <Textarea
          value={hint}
          onChange={(event) => setHint(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder="e.g. more about the colours, aim at coffee lovers…"
          aria-label="What should change"
          maxLength={300}
          className="min-h-16 text-sm"
          autoFocus
        />
        <div className="flex flex-wrap gap-1">
          {HINTS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHint(h)}
              className={cn(
                "h-6 rounded-md border px-1.5 text-xs transition-[color,background-color,transform] duration-150 ease-out-strong outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97] motion-reduce:transition-none [@media(hover:hover)]:hover:bg-muted",
                hint === h ? "border-foreground/30 bg-muted text-foreground" : "text-muted-foreground"
              )}
            >
              {h}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={submit} className="self-end">
          Rewrite
          <Kbd className="bg-primary-foreground/15 text-primary-foreground">⌘↵</Kbd>
        </Button>
      </PopoverContent>
    </Popover>
  )
}
