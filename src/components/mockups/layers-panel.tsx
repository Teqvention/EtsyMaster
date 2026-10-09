"use client"

import * as React from "react"
import {
  ArrowUpFromLineIcon,
  BlendIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FrameIcon,
  ImageIcon,
  ImagePlusIcon,
  LayersIcon,
  PlusIcon,
  SparklesIcon,
  SquareDashedIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AnyLayer } from "@/lib/mockups/edit"
import type { Scene } from "@/lib/mockups/types"

const BLEND_LABEL: Record<string, string> = {
  multiply: "Multiply",
  screen: "Screen",
  add: "Add",
  overlay: "Overlay",
  "soft-light": "Soft light",
  "linear-burn": "Linear burn",
}

function LayerIcon({ layer }: { layer: AnyLayer }) {
  if (layer.kind === "poster") return <FrameIcon />
  switch (layer.role) {
    case "light":
      return <SunIcon />
    case "shine":
      return <SparklesIcon />
    case "front":
      return <LayersIcon />
    case "lift":
      return <ArrowUpFromLineIcon />
    case "overlay":
      return <BlendIcon />
    default:
      return <ImageIcon />
  }
}

// The stack as Photoshop shows it: top layer first, poster children
// indented under their poster.
export function LayersPanel({
  scene,
  selected,
  onSelect,
  onToggle,
  onMove,
  onDuplicate,
  onDelete,
  onAddImage,
  onAddPoster,
  onAddFront,
}: {
  scene: Scene
  selected: string | null
  onSelect: (id: string | null) => void
  onToggle: (id: string, visible: boolean) => void
  onMove: (id: string, by: 1 | -1) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onAddImage: (file: File) => void
  onAddPoster: () => void
  onAddFront: () => void
}) {
  const fileInput = React.useRef<HTMLInputElement>(null)
  const rows: { layer: AnyLayer; depth: number; parentHidden: boolean }[] = []
  for (const layer of [...scene.layers].reverse()) {
    rows.push({ layer, depth: 0, parentHidden: false })
    if (layer.kind === "poster") {
      for (const child of [...layer.children].reverse()) {
        rows.push({ layer: child, depth: 1, parentHidden: !layer.visible })
      }
    }
  }
  const hasPoster = scene.layers.some((l) => l.kind === "poster")

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-sm font-medium">Layers</span>
        <div className="flex">
          <IconButton label="Add image layer" onClick={() => fileInput.current?.click()}>
            <ImagePlusIcon />
          </IconButton>
          <IconButton label="Add poster slot" onClick={onAddPoster}>
            <PlusIcon />
          </IconButton>
          <IconButton label="Add front layer (paint what stands before the poster)" onClick={onAddFront} disabled={!hasPoster}>
            <SquareDashedIcon />
          </IconButton>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onAddImage(file)
            e.target.value = ""
          }}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col gap-px px-1.5 pb-2" role="listbox" aria-label="Layers">
          {rows.map(({ layer, depth, parentHidden }) => (
            <li
              key={layer.id}
              role="option"
              aria-selected={layer.id === selected}
              onClick={() => onSelect(layer.id)}
              className={cn(
                "group flex h-9 cursor-default items-center gap-2 rounded-md pr-1 text-sm [&_svg]:size-4 [&_svg]:shrink-0",
                depth ? "pl-7" : "pl-2",
                layer.id === selected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
                (!layer.visible || parentHidden) && "text-muted-foreground"
              )}
            >
              <span className="text-muted-foreground">
                <LayerIcon layer={layer} />
              </span>
              <span className="min-w-0 flex-1 truncate">{layer.name}</span>
              {(layer.blend !== "normal" || layer.opacity < 1) && (
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {layer.blend !== "normal" && BLEND_LABEL[layer.blend]}
                  {layer.opacity < 1 && ` ${formatOpacity(layer.opacity)}`}
                </span>
              )}
              <button
                type="button"
                aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle(layer.id, !layer.visible)
                }}
              >
                {layer.visible ? <EyeIcon /> : <EyeOffIcon />}
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
      <div className="flex items-center justify-end gap-0.5 border-t px-2 py-1.5">
        <IconButton label="Move up" disabled={!selected} onClick={() => selected && onMove(selected, 1)}>
          <ChevronUpIcon />
        </IconButton>
        <IconButton label="Move down" disabled={!selected} onClick={() => selected && onMove(selected, -1)}>
          <ChevronDownIcon />
        </IconButton>
        <IconButton label="Duplicate" disabled={!selected} onClick={() => selected && onDuplicate(selected)}>
          <CopyIcon />
        </IconButton>
        <IconButton label="Delete" disabled={!selected} onClick={() => selected && onDelete(selected)}>
          <Trash2Icon />
        </IconButton>
      </div>
    </div>
  )
}

function formatOpacity(o: number) {
  const p = o * 100
  return `${p < 10 ? p.toFixed(1) : Math.round(p)} %`
}

export function IconButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={label} {...props} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
