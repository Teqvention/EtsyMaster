"use client"

import { ChevronRightIcon } from "lucide-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { CityGuide } from "@/lib/citys/studio-types"
import type { StyleGuide } from "@/lib/styles/types"

// A city style's guide, read-only: its art (what any poster in it shares)
// and how it shows a place. Folded into sections, so the lab stays about
// the pictures.

export function CityGuideView({ guide, city }: { guide: StyleGuide | null; city: CityGuide | null }) {
  if (!guide) return <p className="text-xs text-muted-foreground">Not read yet: add images, the board is read a moment later.</p>
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="text-sm text-pretty">{guide.summary}</p>
      <div className="flex gap-1">
        {guide.palette.map((p) => (
          <span key={p.hex + p.role} title={`${p.hex} · ${p.role}`} className="h-4 flex-1 rounded-sm first:rounded-l-md last:rounded-r-md" style={{ background: p.hex }} />
        ))}
      </div>
      <Section title="The art">
        <Row label="Medium" value={guide.medium} />
        <Row label="Technique" value={guide.technique} />
        <Row label="Light" value={guide.lighting} />
        <Row label="Composition" value={guide.composition} />
        <Row label="Detail" value={guide.detail} />
        {guide.typography && <Row label="Lettering" value={guide.typography} />}
        <Row label="Mood" value={guide.mood} />
        {guide.do.length > 0 && <Row label="Do" value={guide.do.join(" · ")} />}
        {guide.dont.length > 0 && <Row label="Don't" value={guide.dont.join(" · ")} />}
      </Section>
      {city && (
        <Section title="How it shows a place" open>
          <Row label="Depiction" value={city.depiction} />
          <Row label="Landmarks" value={city.landmarks} />
          <Row label="Framing" value={city.composition} />
          <Row label="Buildings" value={city.architecture} />
          <Row label="Sky" value={city.sky} />
          <Row label="Surroundings" value={city.surroundings} />
          <Row label="People" value={city.people} />
          <Row label="Lettering" value={city.lettering} />
          <Row label="Balance" value={city.balance} />
          {city.avoid.length > 0 && <Row label="Avoid" value={city.avoid.join(" · ")} />}
        </Section>
      )}
    </div>
  )
}

function Section({ title, open = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <Collapsible defaultOpen={open}>
      <CollapsibleTrigger className="group/s flex w-full items-center gap-1 py-1 text-xs font-medium outline-none hover:text-foreground focus-visible:underline">
        <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform duration-150 ease-out group-data-panel-open/s:rotate-90" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="flex flex-col gap-1.5 pt-1 pb-2 pl-4">{children}</dl>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-pretty">{value}</dd>
    </div>
  )
}
