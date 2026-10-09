"use client"

import * as React from "react"
import { BookmarkPlusIcon, CopyIcon, FilmIcon, Trash2Icon, XIcon } from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"

import { IconButton } from "@/components/mockups/layers-panel"
import { ScrollArea } from "@/components/ui/scroll-area"
import { deleteTemplate, fetchTemplates, postTemplate, putTemplate } from "@/lib/mockups/client"
import { frameAt, motionOf, type Frame } from "@/lib/mockups/motion"
import { BUILT_IN } from "@/lib/mockups/templates"
import type { Clip, Motion, PosterLayer, Scene, Template } from "@/lib/mockups/types"

/** The templates the user saved, and saving more. */
export function useTemplates() {
  const [saved, setSaved] = React.useState<Template[] | null>(null)

  React.useEffect(() => {
    let alive = true
    fetchTemplates()
      .then((list) => alive && setSaved(list))
      .catch(() => alive && setSaved([]))
    return () => {
      alive = false
    }
  }, [])

  /** Same name as a saved one updates it rather than adding a twin. */
  const save = async (clip: Clip) => {
    const name = clip.name.trim() || "Untitled"
    const twin = saved?.find((t) => t.name.toLowerCase() === name.toLowerCase())
    const template = twin
      ? await putTemplate(twin.id, { name, ...motionOf(clip) })
      : await postTemplate({ name, ...motionOf(clip) })
    setSaved((list) =>
      twin ? (list ?? []).map((t) => (t.id === twin.id ? template : t)) : [...(list ?? []), template]
    )
    toast.success(twin ? `Updated template “${name}”` : `Saved “${name}” to your templates`)
  }

  const remove = async (template: Template) => {
    await deleteTemplate(template.id)
    setSaved((list) => (list ?? []).filter((t) => t.id !== template.id))
    toast(`Deleted “${template.name}”`, {
      action: {
        label: "Undo",
        onClick: () =>
          postTemplate({ name: template.name, ...motionOf(template) })
            .then((back) => setSaved((list) => [...(list ?? []), back]))
            .catch((e: Error) => toast.error(e.message)),
      },
    })
  }

  return { saved, save, remove }
}

// Left column in Animate mode: this mockup's animations, then the templates
// to start new ones from. Hovering a template plays it on this mockup.
export function ClipsPanel({
  scene,
  selected,
  still,
  saved,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
  onSaveTemplate,
  onRemoveTemplate,
}: {
  scene: Scene
  selected: string | null
  /** The mockup as it looks now, for the template tiles. */
  still: string | null
  saved: Template[] | null
  onSelect: (id: string) => void
  onAdd: (template: Template) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onSaveTemplate: (id: string) => void
  onRemoveTemplate: (template: Template) => void
}) {
  const clips = scene.clips ?? []

  return (
    <div className="flex min-h-0 flex-col">
      <div className="px-3 py-2 text-sm font-medium">Animations</div>
      <ul className="flex max-h-[40%] flex-col gap-px overflow-y-auto px-1.5 pb-2" role="listbox" aria-label="Animations">
        {clips.map((clip) => (
          <li
            key={clip.id}
            role="option"
            aria-selected={clip.id === selected}
            onClick={() => onSelect(clip.id)}
            className={cn(
              "flex h-9 shrink-0 cursor-default items-center gap-2 rounded-md px-2 text-sm [&_svg]:size-4 [&_svg]:shrink-0",
              clip.id === selected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60"
            )}
          >
            <FilmIcon className={clip.listing ? "text-foreground" : "text-muted-foreground"} />
            <span className="min-w-0 flex-1 truncate">{clip.name}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {clip.listing && <span className="font-medium text-foreground">Listing · </span>}
              {formatSeconds(clip.duration)}
            </span>
          </li>
        ))}
        {!clips.length && <li className="px-2 py-1.5 text-xs text-muted-foreground">No animations yet.</li>}
      </ul>
      <div className="flex items-center justify-end gap-0.5 border-y px-2 py-1.5">
        <IconButton label="Save as template" disabled={!selected} onClick={() => selected && onSaveTemplate(selected)}>
          <BookmarkPlusIcon />
        </IconButton>
        <IconButton label="Duplicate" disabled={!selected} onClick={() => selected && onDuplicate(selected)}>
          <CopyIcon />
        </IconButton>
        <IconButton label="Delete" disabled={!selected} onClick={() => selected && onDelete(selected)}>
          <Trash2Icon />
        </IconButton>
      </div>
      <div className="px-3 pt-3 pb-1 text-sm font-medium">Templates</div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-3 pt-1 pb-3">
          {!!saved?.length && (
            <TileGroup label="Yours">
              {saved.map((t) => (
                <TemplateTile
                  key={t.id}
                  template={t}
                  scene={scene}
                  still={still}
                  onPick={() => onAdd(t)}
                  onRemove={() => onRemoveTemplate(t)}
                />
              ))}
            </TileGroup>
          )}
          <TileGroup label={saved?.length ? "Built-in" : null}>
            {BUILT_IN.map((t) => (
              <TemplateTile key={t.id} template={t} scene={scene} still={still} onPick={() => onAdd(t)} />
            ))}
          </TileGroup>
        </div>
      </ScrollArea>
    </div>
  )
}

function TileGroup({ label, children }: { label: string | null; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      {label && <h3 className="text-xs text-muted-foreground">{label}</h3>}
      <div className="grid grid-cols-2 gap-x-2 gap-y-2.5">{children}</div>
    </section>
  )
}

const PAPER = "#f3f1ec"
const PLAYBACK_RATE = 1.5

// A template on this mockup: at rest its first frame, on hover the whole move
// in CSS (WAAPI), from the same camera maths the renderer uses.
function TemplateTile({
  template,
  scene,
  still,
  onPick,
  onRemove,
}: {
  template: Template
  scene: Scene
  still: string | null
  onPick: () => void
  onRemove?: () => void
}) {
  const box = React.useRef<HTMLDivElement>(null)
  const playing = React.useRef<Animation[]>([])
  const posters = scene.layers.filter((l): l is PosterLayer => l.kind === "poster" && l.visible)
  const rest = pose(frameAt(scene, template, 0), scene, posters, 0)

  const start = (event: React.PointerEvent | React.FocusEvent) => {
    if ("pointerType" in event && event.pointerType !== "mouse") return
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || playing.current.length) return
    const el = box.current
    if (!el) return
    const tile = Math.min(el.clientWidth, el.clientHeight)
    const tracks = keyframes(scene, template, posters, tile)
    const timing = { duration: template.duration * 1000, iterations: Infinity }
    playing.current = [...el.querySelectorAll<HTMLElement>("[data-track]")].flatMap((node) => {
      const frames = tracks[node.dataset.track!]
      if (!frames) return []
      const animation = node.animate(frames, timing)
      animation.playbackRate = PLAYBACK_RATE
      return [animation]
    })
  }
  const stop = () => {
    // Back to the first frame at once, as Etsy cuts back to the photo.
    playing.current.forEach((a) => a.cancel())
    playing.current = []
  }

  return (
    <div className="group relative flex min-w-0 flex-col gap-1">
      <button
        type="button"
        onClick={onPick}
        onPointerEnter={start}
        onPointerLeave={stop}
        onFocus={start}
        onBlur={stop}
        aria-label={`Add “${template.name}”`}
        className="flex min-w-0 flex-col gap-1 rounded-md text-left outline-none transition-transform duration-150 ease-out-strong active:scale-[0.97] focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div
          ref={box}
          className="relative w-full overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10 transition-shadow group-hover:ring-foreground/30"
          style={{ aspectRatio: `${scene.width} / ${scene.height}` }}
        >
          <div data-track="frame" className="absolute inset-0 origin-top-left" style={rest.frame}>
            {still && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={still} alt="" draggable={false} className="size-full" />
            )}
            {posters.map((p, i) => (
              <div key={p.id} className="absolute overflow-hidden" style={rest.posters[i].box}>
                <div data-track={`veil-${i}`} className="absolute inset-0" style={{ background: PAPER, ...rest.posters[i].veil }} />
                <div
                  data-track={`glint-${i}`}
                  className="absolute inset-y-0 -left-full w-[300%]"
                  style={rest.posters[i].glint}
                />
              </div>
            ))}
          </div>
          <div
            data-track="vignette"
            className="absolute inset-0 bg-[radial-gradient(transparent_45%,rgb(0_0_0/0.22)_70%,rgb(0_0_0/0.5)_85%,rgb(0_0_0/0.8))]"
            style={rest.vignette}
          />
        </div>
        <span className="flex items-baseline gap-1 px-0.5 text-xs">
          <span className="min-w-0 flex-1 truncate">{template.name}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {formatSeconds(template.duration)}
          </span>
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label={`Delete template “${template.name}”`}
          onClick={onRemove}
          className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-3"
        >
          <XIcon />
        </button>
      )}
    </div>
  )
}

type Styles = Record<string, string | number>

/** CSS for one frame; `tile` is the tile's short side in px (for blur). */
function pose(frame: Frame, scene: Scene, posters: PosterLayer[], tile: number) {
  const { x, y, zoom, rotate } = frame.camera
  const transform =
    `translate(50%, 50%) rotate(${rotate}rad) scale(${zoom}) ` +
    `translate(${(-x / scene.width) * 100}%, ${(-y / scene.height) * 100}%)`
  const filters = []
  if (frame.exposure || frame.warmth) {
    filters.push(`brightness(${2 ** frame.exposure})`)
    if (frame.warmth > 0) filters.push(`sepia(${frame.warmth * 0.3})`)
    filters.push(`saturate(${1 + frame.warmth * 0.15})`)
  }
  // The renderer blurs on screen; CSS blurs before the zoom, so divide it out.
  if (frame.blur > 0.005 && tile) filters.push(`blur(${(frame.blur * 0.012 * tile) / zoom}px)`)
  const design = Math.min(1, Math.max(0, frame.design))
  return {
    frame: { transform, filter: filters.join(" ") || "none" } as Styles,
    vignette: { opacity: frame.vignette } as Styles,
    posters: posters.map(({ quad }) => {
      const xs = quad.map((p) => p[0])
      const ys = quad.map((p) => p[1])
      const left = Math.min(...xs)
      const top = Math.min(...ys)
      const width = Math.max(...xs) - left || 1
      const height = Math.max(...ys) - top || 1
      const points = quad.map(([px, py]) => `${((px - left) / width) * 100}% ${((py - top) / height) * 100}%`)
      // Matches the renderer's sweep: a band across the quad's diagonal, glint 0 … 1.
      const angle = 90 + (Math.atan2(0.5 / height, 1 / width) * 180) / Math.PI
      return {
        box: {
          left: `${(left / scene.width) * 100}%`,
          top: `${(top / scene.height) * 100}%`,
          width: `${(width / scene.width) * 100}%`,
          height: `${(height / scene.height) * 100}%`,
          clipPath: `polygon(${points.join(", ")})`,
        } as Styles,
        veil: { opacity: 1 - design } as Styles,
        glint: {
          backgroundImage: `linear-gradient(${angle}deg, transparent 45%, rgb(255 255 255 / 0.45) 50%, transparent 55%)`,
          transform: `translateX(${(frame.glint - 0.5) * 50}%)`,
        } as Styles,
      }
    }),
  }
}

const SAMPLES_PER_SECOND = 15

/** WAAPI keyframes per track; tracks that hold still are left out. */
function keyframes(scene: Scene, motion: Motion, posters: PosterLayer[], tile: number) {
  const n = Math.max(2, Math.ceil(motion.duration * SAMPLES_PER_SECOND) + 1)
  const poses = Array.from({ length: n }, (_, i) =>
    pose(frameAt(scene, motion, (i / (n - 1)) * motion.duration), scene, posters, tile)
  )
  const tracks: Record<string, Keyframe[]> = {}
  const add = (name: string, frames: Styles[]) => {
    const first = JSON.stringify(frames[0])
    if (frames.some((f) => JSON.stringify(f) !== first)) tracks[name] = frames
  }
  const filtered = poses.some((p) => p.frame.filter !== "none")
  add("frame", poses.map((p) => (filtered ? p.frame : { transform: p.frame.transform })))
  add("vignette", poses.map((p) => p.vignette))
  posters.forEach((_, i) => {
    add(`veil-${i}`, poses.map((p) => p.posters[i].veil))
    add(`glint-${i}`, poses.map((p) => ({ transform: p.posters[i].glint.transform })))
  })
  return tracks
}

export const formatSeconds = (s: number) => `${Math.round(s * 10) / 10} s`
