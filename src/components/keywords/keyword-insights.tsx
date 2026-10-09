"use client"

import * as React from "react"
import { BanIcon, LoaderCircleIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { analyseLibrary } from "@/hooks/use-keyword-library"
import { formatDate, formatNumber } from "@/lib/etsy/format"
import type { KeywordAnalysis, LibraryOverview } from "@/lib/keywords/types"
import { cn } from "@/lib/utils"

// Gemini's read of the library: a summary, then what sells, the title
// formulas to copy, tag strategies, gaps and what to avoid. Every keyword it
// quotes looks itself up in the table below.

type Section = { value: string; label: string; count: (a: KeywordAnalysis) => number }

const SECTIONS: Section[] = [
  { value: "patterns", label: "What sells", count: (a) => a.winningPatterns.length },
  { value: "titles", label: "Title formulas", count: (a) => a.titleStructures.length },
  { value: "tags", label: "Tag strategy", count: (a) => a.tagStrategies.length },
  { value: "gaps", label: "Gaps", count: (a) => a.gaps.length },
  { value: "avoid", label: "Avoid", count: (a) => a.avoid.length },
]

export function KeywordInsights({
  library,
  onKeyword,
}: {
  library: LibraryOverview
  onKeyword: (keyword: string) => void
}) {
  const [pending, setPending] = React.useState(false)
  const analysis = library.analysis
  const outdated =
    !!analysis &&
    (analysis.basis.shops !== library.stats.shops || analysis.basis.listings !== library.stats.listings)

  async function analyse() {
    setPending(true)
    try {
      await analyseLibrary()
      toast.success("The library has a fresh AI read")
    } catch (error) {
      toast.error(`Couldn't analyse the library: ${(error as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <section
      aria-labelledby="keyword-insights"
      aria-busy={pending}
      className="relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-lg border p-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2
          id="keyword-insights"
          className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase"
        >
          <SparklesIcon className="size-3.5 text-brand" />
          AI read
        </h2>
        {analysis && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {formatDate(analysis.createdAt)} · {analysis.basis.shops === 1 ? "1 shop" : `${analysis.basis.shops} shops`},{" "}
            {formatNumber(analysis.basis.listings)} listings
          </span>
        )}
        {outdated && !pending && (
          <span className="rounded-full bg-amber-500/12 px-1.5 py-px text-[11px] font-medium text-amber-700 dark:text-amber-400">
            Library changed since
          </span>
        )}
        {analysis && (
          <Button
            variant={outdated ? "outline" : "ghost"}
            size="xs"
            className="ml-auto active:scale-[0.97]"
            disabled={pending}
            onClick={analyse}
          >
            {pending ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <SparklesIcon />}
            {pending ? "Reading…" : "Analyse again"}
          </Button>
        )}
      </div>

      {analysis ? (
        <div className={cn("flex flex-col gap-3 transition-opacity duration-200 ease-out", pending && "opacity-50")}>
          <p className="max-w-3xl text-[15px] leading-relaxed text-pretty">{analysis.insights.summary}</p>
          <AnalysisTabs insights={analysis.insights} onKeyword={onKeyword} />
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 py-2">
          <div className="flex max-w-xl flex-col gap-1">
            <p className="text-sm font-medium">What sells here, in words</p>
            <p className="text-sm text-pretty text-muted-foreground">
              Gemini reads the strongest tags, title phrases and best sellers — and listings that barely
              sell, for contrast — then says what works, which title formulas to copy and where the gaps
              are. The upload pipeline uses it too.
            </p>
          </div>
          <Button className="active:scale-[0.97]" disabled={pending} onClick={analyse}>
            {pending ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <SparklesIcon />}
            {pending ? "Reading the library…" : "Analyse the library"}
          </Button>
        </div>
      )}

      {pending && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Reading {formatNumber(library.stats.listings)} listings — usually 15–40 seconds.
        </p>
      )}
      {pending && <Indeterminate />}
    </section>
  )
}

function AnalysisTabs({ insights, onKeyword }: { insights: KeywordAnalysis; onKeyword: (keyword: string) => void }) {
  const sections = SECTIONS.filter((s) => s.count(insights) > 0)
  if (sections.length === 0) return null
  return (
    <Tabs defaultValue={sections[0].value} className="gap-3">
      <TabsList variant="line" className="-ml-1 max-w-full overflow-x-auto [scrollbar-width:none]">
        {sections.map((s) => (
          <TabsTrigger key={s.value} value={s.value} className="px-2">
            {s.label}
            <span className="text-[11px] text-muted-foreground tabular-nums">{s.count(insights)}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="patterns">
        <Items>
          {insights.winningPatterns.map((p, i) => (
            <Item key={i} title={p.title} detail={p.detail}>
              <Chips keywords={p.examples} onKeyword={onKeyword} />
            </Item>
          ))}
        </Items>
      </TabsContent>

      <TabsContent value="titles">
        <Items>
          {insights.titleStructures.map((t, i) => (
            <li key={i} className="flex flex-col gap-1.5">
              <p className="rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs leading-relaxed text-pretty">
                {t.pattern}
              </p>
              <p className="text-sm text-pretty text-muted-foreground">{t.why}</p>
              {t.example && (
                <p className="text-xs text-pretty">
                  <span className="text-muted-foreground">e.g. </span>
                  <q className="italic">{t.example}</q>
                </p>
              )}
            </li>
          ))}
        </Items>
      </TabsContent>

      <TabsContent value="tags">
        <Items>
          {insights.tagStrategies.map((t, i) => (
            <Item key={i} title={t.strategy} detail={t.detail}>
              <Chips keywords={t.tags} onKeyword={onKeyword} />
            </Item>
          ))}
        </Items>
      </TabsContent>

      <TabsContent value="gaps">
        <Items>
          {insights.gaps.map((g, i) => (
            <Item key={i} title={g.opportunity} detail={g.detail}>
              <Chips keywords={g.keywords} onKeyword={onKeyword} accent />
            </Item>
          ))}
        </Items>
      </TabsContent>

      <TabsContent value="avoid">
        <Items>
          {insights.avoid.map((a, i) => (
            <li key={i} className="flex gap-2">
              <BanIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium text-pretty">{a.pattern}</p>
                <p className="text-sm text-pretty text-muted-foreground">{a.why}</p>
              </div>
            </li>
          ))}
        </Items>
      </TabsContent>
    </Tabs>
  )
}

function Items({ children }: { children: React.ReactNode }) {
  return <ol className="grid gap-x-6 gap-y-4 @3xl/main:grid-cols-2">{children}</ol>
}

function Item({ title, detail, children }: { title: string; detail: string; children?: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-1">
      <p className="text-sm font-medium text-pretty">{title}</p>
      <p className="text-sm text-pretty text-muted-foreground">{detail}</p>
      {children}
    </li>
  )
}

/** Keywords the AI quoted; each finds itself in the table. */
function Chips({
  keywords,
  onKeyword,
  accent = false,
}: {
  keywords: string[]
  onKeyword: (keyword: string) => void
  accent?: boolean
}) {
  if (keywords.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1 pt-0.5">
      {keywords.map((keyword) => (
        <button
          key={keyword}
          type="button"
          onClick={() => onKeyword(keyword)}
          title="Find in the keyword table"
          className={cn(
            "max-w-full truncate rounded-full border px-2 py-0.5 text-xs outline-none transition-[background-color,transform] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
            accent
              ? "border-brand/30 bg-brand/8 text-brand [@media(hover:hover)]:hover:bg-brand/15"
              : "bg-background [@media(hover:hover)]:hover:bg-muted"
          )}
        >
          {keyword}
        </button>
      ))}
    </span>
  )
}

// A sliver moving along the bottom edge while Gemini reads; still for reduced motion.
function Indeterminate() {
  return (
    <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-brand/15">
      <div className="h-full w-1/3 animate-[keyword-read_1.4s_ease-in-out_infinite] bg-brand motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40" />
      <style>{`@keyframes keyword-read { from { transform: translateX(-100%) } to { transform: translateX(300%) } }`}</style>
    </div>
  )
}
