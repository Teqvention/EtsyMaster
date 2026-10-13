"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { BadgeCheckIcon, ChevronRightIcon, FolderOpenIcon, ImagePlusIcon, LoaderCircleIcon, PaletteIcon, PlusIcon, SparklesIcon, SunIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { StyleCover, Swatches } from "@/components/styles/style-cover"
import { StyleFromSavedDialog } from "@/components/styles/style-from-saved"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { createCityStyle } from "@/hooks/use-city-style"
import { createCustomSky, deleteCustomSky, skyFileUrl, useCustomSkies } from "@/hooks/use-custom-skies"
import { POLL, refreshStyles, useStyles } from "@/hooks/use-styles"
import { SKIES } from "@/lib/citys/skies"
import type { StyleSummary } from "@/lib/styles/types"
import { cn } from "@/lib/utils"

// Citys → Styles: the styles city posters are made in, and the skies they
// can be asked for. A city style starts from a few inspiration images
// (uploaded, from Saved, from Generation) and goes through the lab before
// it's confirmed for scaling; styles can be grouped (cartoon, funky, drawn)
// and normal styles can make city posters too.

type Tab = "styles" | "skies"

export function CityStylesView() {
  const [tab, setTab] = React.useState<Tab>("styles")
  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex rounded-lg border p-0.5 self-start" role="tablist">
        <TabButton on={tab === "styles"} onClick={() => setTab("styles")} icon={<PaletteIcon />}>
          City styles
        </TabButton>
        <TabButton on={tab === "skies"} onClick={() => setTab("skies")} icon={<SunIcon />}>
          Skies
        </TabButton>
      </div>
      {tab === "styles" ? <Styles /> : <Skies />}
    </div>
  )
}

function TabButton({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4",
        on ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {children}
    </button>
  )
}

// --- City styles ---

function Styles() {
  const styles = useStyles()
  const [creating, setCreating] = React.useState(false)
  const [fromSaved, setFromSaved] = React.useState(false)
  const [group, setGroup] = React.useState<string | null>(null)

  React.useEffect(() => {
    refreshStyles()
  }, [])
  const busy = styles?.some((s) => s.guideStatus === "running" || s.incoming) ?? false
  React.useEffect(() => {
    if (!busy) return
    const timer = setInterval(refreshStyles, POLL)
    return () => clearInterval(timer)
  }, [busy])

  const city = (styles ?? []).filter((s) => s.kind === "city")
  const normal = (styles ?? []).filter((s) => s.kind !== "city")
  const groups = [...new Set(city.flatMap((s) => s.cityTags ?? []))].sort()
  const shown = group ? city.filter((s) => s.cityTags?.includes(group)) : city

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto max-w-2xl text-sm text-muted-foreground">
          Styles made for city posters: read for their art and for how they show a place, tried in the lab, then confirmed for scaling.
        </p>
        <Button size="sm" variant="outline" onClick={() => setFromSaved(true)} className="active:scale-[0.97]">
          <FolderOpenIcon />
          From Saved
        </Button>
        <Button size="sm" onClick={() => setCreating(true)} className="active:scale-[0.97]">
          <PlusIcon />
          New city style
        </Button>
      </div>
      {groups.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <GroupChip on={!group} onClick={() => setGroup(null)}>
            All
          </GroupChip>
          {groups.map((g) => (
            <GroupChip key={g} on={group === g} onClick={() => setGroup(group === g ? null : g)}>
              {g}
            </GroupChip>
          ))}
        </div>
      )}
      {styles === null ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/5] rounded-xl" />
          ))}
        </div>
      ) : city.length === 0 ? (
        <Empty className="min-h-[40svh] border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PaletteIcon />
            </EmptyMedia>
            <EmptyTitle>Make the first city style</EmptyTitle>
            <EmptyDescription>Collect 4–10 city posters with the look you want (cartoon, funky, drawn…), from Saved or uploaded. The lab paints test posters until it fits.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button size="sm" variant="outline" onClick={() => setFromSaved(true)}>
              <FolderOpenIcon />
              From Saved
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <PlusIcon />
              New city style
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
          {shown.map((s) => (
            <li key={s.id}>
              <CityStyleCard style={s} />
            </li>
          ))}
        </ul>
      )}
      {normal.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group/more flex items-center gap-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:underline">
            <ChevronRightIcon className="size-4 transition-transform duration-150 ease-out group-data-panel-open/more:rotate-90" />
            Normal styles ({normal.length}): their art can make city posters too
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
              {normal.map((s) => (
                <li key={s.id}>
                  <Link href={`/styles/${s.id}`} className="flex flex-col overflow-hidden rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:border-foreground/30">
                    <StyleCover covers={s.covers} width={320} className="aspect-square" />
                    <span className="truncate px-2 py-1.5 text-xs">{s.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
      <NewCityStyle open={creating} onOpenChange={setCreating} />
      <StyleFromSavedDialog open={fromSaved} onOpenChange={setFromSaved} navigate kind="city" />
    </>
  )
}

function GroupChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2.5 text-xs capitalize outline-none transition-[border-color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
        on ? "border-brand/60 bg-brand/10" : "border-border text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

function CityStyleCard({ style }: { style: StyleSummary }) {
  return (
    <Link
      href={`/citys/styles/${style.id}`}
      className="group/card flex flex-col overflow-hidden rounded-xl border bg-card outline-none transition-[border-color,transform] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99] [@media(hover:hover)]:hover:border-foreground/30"
    >
      <StyleCover covers={style.covers} width={480} className="aspect-square" />
      <div className="flex flex-col gap-1 px-3 py-2.5">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{style.name}</span>
          {style.cityStatus === "confirmed" && <BadgeCheckIcon className="size-4 shrink-0 text-emerald-600" aria-label="Confirmed" />}
        </span>
        <span className="flex h-4 items-center gap-2 text-xs text-muted-foreground tabular-nums">
          {style.cityStatus === "confirmed" ? "Confirmed" : "In the lab"}
          {style.cityVersion ? ` · v${style.cityVersion}` : ""}
          {style.guideStatus === "running" ? (
            <LoaderCircleIcon className="ml-auto size-3 animate-spin" />
          ) : style.guide ? (
            <Swatches palette={style.guide.palette} className="ml-auto" />
          ) : null}
        </span>
        {style.cityTags && style.cityTags.length > 0 && <span className="truncate text-[11px] text-muted-foreground capitalize">{style.cityTags.join(" · ")}</span>}
      </div>
    </Link>
  )
}

function NewCityStyle({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [group, setGroup] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!name.trim()) return
            setBusy(true)
            try {
              const style = await createCityStyle(name.trim(), group.trim() ? [group.trim()] : [])
              onOpenChange(false)
              router.push(`/citys/styles/${style.id}`)
            } catch (error) {
              toast.error(`Couldn't create it: ${(error as Error).message}`)
            } finally {
              setBusy(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>New city style</DialogTitle>
            <DialogDescription>Name the look; add its inspiration images next.</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bold cartoon skyline" maxLength={60} />
          <Input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Group (optional), e.g. cartoon" maxLength={24} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <LoaderCircleIcon className="animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// --- Skies ---

/** The skies a city poster can be asked for: the built-in ones, and the shop's own made from photos. */
function Skies() {
  const own = useCustomSkies()
  return (
    <>
      <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
        The skies real photos (and drawn ones) can be asked for, one per row of the creativity settings. Left open, we pick what makes each picture most beautiful, often the reference&apos;s own sky made prettier. Never dark or dramatic: no night, storms, heavy clouds or fiery sunsets.
      </p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
        <li>
          <NewSky />
        </li>
        {(own ?? []).map((sky) => (
          <li key={sky.id} className="group/sky relative overflow-hidden rounded-lg border">
            <div aria-hidden className="relative h-28" style={{ background: `linear-gradient(to top, ${sky.swatch.join(", ")})` }}>
              {sky.images[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={skyFileUrl(sky, sky.images[0])} alt="" className="absolute right-2 bottom-2 size-14 rounded-md object-cover shadow-sm ring-2 ring-white/70" />
              )}
            </div>
            <div className="flex flex-col gap-1 p-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                {sky.name}
                <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-normal text-muted-foreground">yours</span>
              </h3>
              <p className="text-xs text-pretty text-muted-foreground">{sky.prompt.charAt(0).toUpperCase() + sky.prompt.slice(1)}.</p>
              {sky.dark && <p className="text-[11px] text-amber-700 dark:text-amber-400">The photos were darker than the shop&apos;s taste: written as their brightest version.</p>}
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Delete ${sky.name}`}
              className="absolute top-2 right-2 bg-background/70 opacity-0 backdrop-blur-sm group-hover/sky:opacity-100 focus-visible:opacity-100"
              onClick={() => deleteCustomSky(sky.key).catch((e: Error) => toast.error(e.message))}
            >
              <Trash2Icon />
            </Button>
          </li>
        ))}
        {SKIES.map((sky) => (
          <li key={sky.id} className="overflow-hidden rounded-lg border">
            <div aria-hidden className="h-28" style={{ background: `linear-gradient(to top, ${sky.swatch.join(", ")})` }} />
            <div className="flex flex-col gap-1 p-3">
              <h3 className="text-sm font-semibold">{sky.name}</h3>
              <p className="text-xs text-pretty text-muted-foreground">{sky.prompt.charAt(0).toUpperCase() + sky.prompt.slice(1)}.</p>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

/** A new sky from one or more photos: picked, named (optional), read by Gemini. */
function NewSky() {
  const input = React.useRef<HTMLInputElement>(null)
  const [files, setFiles] = React.useState<File[]>([])
  const [name, setName] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  async function create() {
    setBusy(true)
    try {
      const sky = await createCustomSky(files, name)
      toast.success(`“${sky.name}” is one of your skies`, { description: "Pick it in the creativity settings, row by row." })
      setFiles([])
      setName("")
    } catch (error) {
      toast.error(`Couldn't make the sky: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-2 rounded-lg border border-dashed p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <ImagePlusIcon className="size-4 text-muted-foreground" />
        New sky from photos
      </h3>
      <p className="text-xs text-pretty text-muted-foreground">One to five photos with a sky you love; only the sky and its light are read, never the place.</p>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => {
          setFiles(Array.from(e.target.files ?? []).slice(0, 5))
          e.target.value = ""
        }}
      />
      <Button variant="outline" size="sm" onClick={() => input.current?.click()} className="justify-start">
        <ImagePlusIcon />
        {files.length ? `${files.length} ${files.length === 1 ? "photo" : "photos"} picked` : "Pick photos"}
      </Button>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className="h-8" />
      <Button size="sm" disabled={busy || !files.length} onClick={create} className="mt-auto active:scale-[0.97]">
        {busy ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
        Make the sky
      </Button>
    </div>
  )
}
