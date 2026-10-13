"use client"

import * as React from "react"
import {
  ArrowUpToLineIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderInputIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FoldersIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { CategoryPicker } from "@/components/mockups/category-picker"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Input } from "@/components/ui/input"
import { createCategory } from "@/hooks/use-categories"
import { deleteSavedFolder, moveSavedFolder } from "@/hooks/use-saved"
import {
  ancestry,
  childFolder,
  describeFolder,
  folderName,
  isWithin,
  MAX_DEPTH,
  parentFolder,
  sameFolder,
  type FolderNode,
} from "@/lib/saved/folders"
import { cn } from "@/lib/utils"

// The Saved page's folders as a tree: a folder opens with a click, and
// shows the folders in it (a double folder icon says there are some; it
// turns into a chevron on hover to close or open them). A row's + makes a folder inside it, a
// right-click renames, moves or deletes it. Listings dragged from the grid
// file into the folder they're dropped on; a folder dragged onto another goes
// inside it, onto "Folders" back to the top. Which folders are open is
// remembered on this device; the open folder's parents always are.

/** What a dragged listing tile carries: the ids of the listings. */
export const LISTINGS_DRAG = "application/x-etsy-saved-listings"
const FOLDER_DRAG = "application/x-etsy-saved-folder"

/** The folder being dragged, for the drop targets to check against while hovering (data can't be read then). */
let draggedFolder: string | null = null

export function FolderTree({
  tree,
  busy,
  current,
  onOpen,
  onDropListings,
}: {
  tree: FolderNode[]
  /** Folders with something generating, lower-cased paths (their parents included). */
  busy: ReadonlySet<string>
  /** The open folder's path, if a folder is open. */
  current: string | null
  /** Opens the folder at the path, or every folder (null). */
  onOpen: (path: string | null) => void
  onDropListings: (ids: number[], to: string) => void
}) {
  const [expanded, setExpanded] = useExpanded()
  // Where a new folder is being named: at the top (null) or inside a folder.
  const [adding, setAdding] = React.useState<{ parent: string | null } | null>(null)
  const [renaming, setRenaming] = React.useState<string | null>(null)
  const [over, setOver] = React.useState<string | null>(null)

  // Opening a folder shows the folders in it, and keeps its parents open,
  // so the way deeper and back is always in view.
  React.useEffect(() => {
    if (current) for (const path of ancestry(current)) setExpanded(path, true)
  }, [current, setExpanded])

  const open = React.useMemo(() => {
    const set = new Set(expanded)
    if (current) for (const path of ancestry(current)) set.add(path.toLowerCase())
    if (adding?.parent) set.add(adding.parent.toLowerCase())
    return set
  }, [expanded, current, adding])

  function toggle(path: string, to = !open.has(path.toLowerCase())) {
    setExpanded(path, to)
  }

  async function move(from: string, to: string) {
    if (sameFolder(from, to)) return
    try {
      const name = await moveSavedFolder(from, to)
      if (current && isWithin(current, from)) onOpen(name + current.slice(from.length))
      toast.success(`Moved ${folderName(from)} to ${parentFolder(name) ? describeFolder(parentFolder(name)!) : "the top"}`, {
        action: { label: "Undo", onClick: () => moveSavedFolder(name, from).catch(() => {}) },
      })
    } catch (error) {
      toast.error(`Couldn't move ${folderName(from)}: ${(error as Error).message}`)
    }
  }

  async function rename(path: string, name: string) {
    setRenaming(null)
    const clean = name.trim()
    if (!clean || clean === folderName(path)) return
    const to = childFolder(parentFolder(path), clean)
    try {
      const stored = await moveSavedFolder(path, to)
      if (current && isWithin(current, path)) onOpen(stored + current.slice(path.length))
    } catch (error) {
      toast.error(`Couldn't rename ${folderName(path)}: ${(error as Error).message}`)
    }
  }

  async function remove(node: FolderNode) {
    try {
      await deleteSavedFolder(node.path)
      toast(`Deleted ${node.name}`)
      if (current && isWithin(current, node.path)) onOpen(parentFolder(node.path))
    } catch (error) {
      toast.error(`Couldn't delete ${node.name}: ${(error as Error).message}`)
    }
  }

  /** What a drag over `target` (null: the top) would do, if anything. */
  function dropKind(event: React.DragEvent, target: string | null): "listings" | "folder" | null {
    const types = event.dataTransfer.types
    if (types.includes(LISTINGS_DRAG)) return target ? "listings" : null
    if (!types.includes(FOLDER_DRAG) || !draggedFolder) return null
    // Not into itself, nor where it is already.
    if (target && isWithin(target, draggedFolder)) return null
    const parent = parentFolder(draggedFolder)
    if (target === null ? parent === null : parent !== null && sameFolder(parent, target)) return null
    if (target && ancestry(target).length >= MAX_DEPTH) return null
    return "folder"
  }

  function onDrop(event: React.DragEvent, target: string | null) {
    const kind = dropKind(event, target)
    setOver(null)
    if (!kind) return
    event.preventDefault()
    if (kind === "listings") {
      const ids = JSON.parse(event.dataTransfer.getData(LISTINGS_DRAG) || "[]") as number[]
      if (ids.length && target) onDropListings(ids, target)
    } else {
      const from = event.dataTransfer.getData(FOLDER_DRAG) || draggedFolder
      if (from) move(from, childFolder(target, folderName(from)))
    }
  }

  const dropProps = (target: string | null) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!dropKind(event, target)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = "move"
      setOver(target ?? TOP)
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver((o) => (o === (target ?? TOP) ? null : o))
    },
    onDrop: (event: React.DragEvent) => onDrop(event, target),
  })

  function rows(nodes: FolderNode[]): React.ReactNode {
    return nodes.map((node) => {
      const isOpen = open.has(node.path.toLowerCase())
      return (
        <li key={node.path} role="none" className="flex flex-col gap-0.5">
          {renaming && sameFolder(renaming, node.path) ? (
            <NameField
              depth={node.depth}
              initial={node.name}
              label={`New name for ${node.name}`}
              onDone={(name) => (name === null ? setRenaming(null) : rename(node.path, name))}
            />
          ) : (
            <FolderRow
              node={node}
              open={isOpen}
              current={!!current && sameFolder(current, node.path)}
              busy={busy.has(node.path.toLowerCase())}
              over={over === node.path}
              onOpen={() => onOpen(node.path)}
              onToggle={() => toggle(node.path)}
              onAdd={() => setAdding({ parent: node.path })}
              onRename={() => setRenaming(node.path)}
              onMove={(to) => move(node.path, childFolder(to, node.name))}
              onDelete={() => remove(node)}
              onHoverOpen={() => toggle(node.path, true)}
              dropProps={dropProps(node.path)}
            />
          )}
          {(isOpen || (adding?.parent && sameFolder(adding.parent, node.path))) && (
            <ul role="group" className="flex flex-col gap-0.5">
              {adding?.parent && sameFolder(adding.parent, node.path) && (
                <li role="none">
                  <NameField
                    depth={node.depth + 1}
                    label={`New folder inside ${node.name}`}
                    onDone={(name) => {
                      setAdding(null)
                      if (name) onOpen(createCategory("saved", childFolder(node.path, name)))
                    }}
                  />
                </li>
              )}
              {isOpen && rows(node.children)}
            </ul>
          )}
        </li>
      )
    })
  }

  return (
    <>
      <div
        {...dropProps(null)}
        className={cn(
          "mt-2 flex items-center justify-between rounded-md py-0.5 pr-0.5 pl-2 transition-colors",
          over === TOP && "bg-brand/10 ring-1 ring-brand/50"
        )}
      >
        <span className="text-xs font-medium text-muted-foreground">
          {over === TOP ? "Move to the top" : "Folders"}
        </span>
        <Button variant="ghost" size="icon-xs" aria-label="New folder" title="New folder" onClick={() => setAdding({ parent: null })}>
          <PlusIcon />
        </Button>
      </div>
      {adding?.parent === null && (
        <NameField
          depth={0}
          label="New folder name"
          onDone={(name) => {
            setAdding(null)
            if (name) onOpen(createCategory("saved", childFolder(null, name)))
          }}
        />
      )}
      <ul role="tree" aria-label="Folders" className="flex flex-col gap-0.5">
        {rows(tree)}
      </ul>
      {tree.length === 0 && !adding && (
        <p className="px-2 py-1.5 text-xs text-pretty text-muted-foreground">
          Select listings in a shop and right-click to file them into a folder.
        </p>
      )}
    </>
  )
}

const TOP = "\0top"
/** Indent per level, in px. */
const INDENT = 12

function FolderRow({
  node,
  open,
  current,
  busy,
  over,
  onOpen,
  onToggle,
  onAdd,
  onRename,
  onMove,
  onDelete,
  onHoverOpen,
  dropProps,
}: {
  node: FolderNode
  open: boolean
  current: boolean
  busy: boolean
  /** Something dragged is over it, and may be dropped. */
  over: boolean
  onOpen: () => void
  onToggle: () => void
  onAdd: () => void
  onRename: () => void
  /** Moves it inside the folder at that path, or to the top (null). */
  onMove: (to: string | null) => void
  onDelete: () => void
  onHoverOpen: () => void
  dropProps: Pick<React.HTMLAttributes<HTMLDivElement>, "onDragOver" | "onDragLeave" | "onDrop">
}) {
  const hasChildren = node.children.length > 0
  const deep = node.depth + 1 >= MAX_DEPTH
  // Dragging over a closed folder for a moment opens it, to drop deeper.
  const hoverOpen = React.useEffectEvent(onHoverOpen)
  React.useEffect(() => {
    if (!over || open || !hasChildren) return
    const timer = setTimeout(hoverOpen, 650)
    return () => clearTimeout(timer)
  }, [over, open, hasChildren])

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            role="treeitem"
            aria-level={node.depth + 1}
            aria-expanded={hasChildren ? open : undefined}
            aria-selected={current}
            draggable
            onDragStart={(event) => {
              draggedFolder = node.path
              event.dataTransfer.setData(FOLDER_DRAG, node.path)
              event.dataTransfer.effectAllowed = "move"
            }}
            onDragEnd={() => {
              draggedFolder = null
            }}
            {...dropProps}
            style={{ paddingLeft: 6 + node.depth * INDENT }}
            className={cn(
              "group/row relative flex h-8 shrink-0 items-center gap-0.5 rounded-lg pr-1 text-sm transition-[background-color,box-shadow] duration-150 ease-out",
              current
                ? "bg-background font-medium shadow-sm ring-1 ring-foreground/5"
                : "[@media(hover:hover)]:hover:bg-muted",
              over && "bg-brand/10 ring-1 ring-brand/60"
            )}
          />
        }
      >
        {node.depth > 0 && (
          // The line down from the parent, so levels read at a glance.
          <span
            aria-hidden
            className="absolute top-0 bottom-0 w-px bg-border"
            style={{ left: 6 + (node.depth - 1) * INDENT + 10 }}
          />
        )}
        {hasChildren ? (
          <button
            type="button"
            aria-label={open ? `Close ${node.name}` : `Show the folders in ${node.name}`}
            aria-expanded={open}
            onClick={onToggle}
            className="group/toggle grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:bg-foreground/10 [@media(hover:hover)]:hover:text-foreground"
          >
            <FoldersIcon className="size-4 group-hover/row:hidden group-focus-visible/toggle:hidden pointer-coarse:hidden" />
            <ChevronRightIcon
              className={cn(
                "hidden size-3.5 transition-transform duration-150 ease-out group-hover/row:block group-focus-visible/toggle:block pointer-coarse:block motion-reduce:transition-none",
                open && "rotate-90"
              )}
            />
          </button>
        ) : (
          <span aria-hidden className="grid size-5 shrink-0 place-items-center text-muted-foreground">
            {current ? <FolderOpenIcon className="size-4" /> : <FolderIcon className="size-4" />}
          </span>
        )}
        <button
          type="button"
          aria-current={current || undefined}
          onClick={onOpen}
          onDoubleClick={onRename}
          title={describeFolder(node.path)}
          className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pr-1 pl-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:active:scale-100"
        >
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        </button>
        {!deep && (
          <button
            type="button"
            onClick={onAdd}
            aria-label={`New folder inside ${node.name}`}
            title="New folder inside"
            className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 outline-none group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:opacity-100 [@media(hover:hover)]:hover:bg-foreground/10 [@media(hover:hover)]:hover:text-foreground"
          >
            <PlusIcon className="size-3.5" />
          </button>
        )}
        <span className="w-6 shrink-0 text-right text-xs font-normal text-muted-foreground tabular-nums">
          {busy ? (
            <LoaderCircleIcon aria-label="Generating" className="ml-auto size-3.5 animate-spin" />
          ) : (
            node.total > 0 && node.total
          )}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuGroup>
          <ContextMenuLabel className="truncate">{describeFolder(node.path)}</ContextMenuLabel>
        </ContextMenuGroup>
        <ContextMenuItem onClick={onOpen}>
          <FolderOpenIcon />
          Open
        </ContextMenuItem>
        <ContextMenuItem disabled={deep} onClick={onAdd}>
          <FolderPlusIcon />
          New folder inside
        </ContextMenuItem>
        <ContextMenuItem onClick={onRename}>
          <PencilIcon />
          Rename
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderInputIcon />
            Move to
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-64 p-0">
            {node.depth > 0 && (
              <ContextMenuGroup className="border-b p-1">
                <ContextMenuItem onClick={() => onMove(null)}>
                  <ArrowUpToLineIcon className="text-muted-foreground" />
                  To the top
                </ContextMenuItem>
              </ContextMenuGroup>
            )}
            <CategoryPicker
              of="saved"
              onPick={(to) => onMove(to)}
              exclude={node.path}
              current={parentFolder(node.path)}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" disabled={node.total > 0} onClick={onDelete}>
          <Trash2Icon />
          {node.total > 0 ? "Delete (empty it first)" : "Delete folder"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Naming a folder in place: Enter takes it, Escape or leaving it empty doesn't. */
function NameField({
  depth,
  initial = "",
  label,
  onDone,
}: {
  depth: number
  initial?: string
  label: string
  onDone: (name: string | null) => void
}) {
  const [name, setName] = React.useState(initial)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onDone(name.trim() || null)
      }}
      className="py-0.5 pr-0.5"
      style={{ paddingLeft: 2 + depth * INDENT }}
    >
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={() => onDone(initial && name.trim() ? name.trim() : null)}
        onKeyDown={(event) => event.key === "Escape" && onDone(null)}
        placeholder="Folder name"
        aria-label={label}
        maxLength={40}
        className="h-8 bg-background"
      />
    </form>
  )
}

const EXPANDED_KEY = "etsy-research:folders-open"
const expandListeners = new Set<() => void>()
let expandedCache: { raw: string | null; set: ReadonlySet<string> } = { raw: null, set: new Set() }

function readExpanded(): ReadonlySet<string> {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(EXPANDED_KEY)
  } catch {
    // Not remembered: every folder starts closed.
  }
  if (raw !== expandedCache.raw) {
    let list: unknown = []
    try {
      list = JSON.parse(raw ?? "[]")
    } catch {
      list = []
    }
    expandedCache = { raw, set: new Set(Array.isArray(list) ? list.filter((p) => typeof p === "string") : []) }
  }
  return expandedCache.set
}

const NONE: ReadonlySet<string> = new Set()

/** Which folders show the folders in them (lower-cased paths), remembered on this device. */
function useExpanded() {
  const expanded = React.useSyncExternalStore(
    (notify) => {
      expandListeners.add(notify)
      return () => {
        expandListeners.delete(notify)
      }
    },
    readExpanded,
    () => NONE
  )
  const set = React.useCallback((path: string, open: boolean) => {
    const next = new Set(readExpanded())
    if (open) next.add(path.toLowerCase())
    else next.delete(path.toLowerCase())
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]))
    } catch {
      // Kept for this page only.
      expandedCache = { raw: expandedCache.raw, set: next }
    }
    expandListeners.forEach((notify) => notify())
  }, [])
  return [expanded, set] as const
}
