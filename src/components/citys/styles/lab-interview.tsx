"use client"

import * as React from "react"
import { CheckIcon, LightbulbIcon, LoaderCircleIcon, MessageCircleQuestionIcon, SparklesIcon, WandSparklesIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { Interview, Suggestion } from "@/lib/citys/studio-types"
import { cn } from "@/lib/utils"

// What to change about a style, two ways. The interview asks a handful of
// questions about the latest round, five answers each from one end to the
// other, 3 keeping it as it is, the lab's pick marked; the answers make
// the guide's next version. The suggestions are five one-liners, any of
// which can be tried as a variant of its own (they come back as 1–5 at the
// top), alone or several at once, with an idea of one's own besides.

export function InterviewPanel({
  interview,
  canAsk,
  onAsk,
  onApply,
}: {
  interview: Interview | undefined
  canAsk: boolean
  onAsk: () => Promise<void>
  onApply: (answers: Record<string, number>, notes: string) => Promise<void>
}) {
  const [answers, setAnswers] = React.useState<Record<string, number>>({})
  const [notes, setNotes] = React.useState("")
  const [busy, setBusy] = React.useState<"ask" | "apply" | null>(null)
  // A new interview: no answers yet.
  const [answersFor, setAnswersFor] = React.useState(interview?.at)
  if (answersFor !== interview?.at) {
    setAnswersFor(interview?.at)
    setAnswers({})
  }
  const changes = Object.values(answers).filter((v) => v !== 3).length

  async function run(kind: "ask" | "apply", work: () => Promise<void>) {
    setBusy(kind)
    try {
      await work()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Interview">
      <header className="flex items-center gap-2">
        <MessageCircleQuestionIcon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Interview</h3>
        <Button variant="outline" size="xs" className="ml-auto" disabled={!canAsk || busy !== null} onClick={() => run("ask", onAsk)}>
          {busy === "ask" ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
          {interview ? "Ask again" : "Ask me"}
        </Button>
      </header>
      {!interview ? (
        <p className="text-xs text-pretty text-muted-foreground">
          After a round, the lab looks at the test posters next to the board and asks what to change: composition, colour, material, lines, people, sky, landmarks.
        </p>
      ) : (
        <>
          <ol className="flex flex-col gap-3">
            {interview.questions.map((q) => {
              const picked = answers[q.id] ?? 3
              return (
                <li key={q.id} className="flex flex-col gap-1.5">
                  <p className="text-xs">
                    <span className="mr-1 rounded bg-muted px-1 py-px text-[10px] tracking-wide text-muted-foreground uppercase">{q.aspect}</span>
                    {q.question}
                  </p>
                  <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label={q.question}>
                    {q.options.map((option, i) => {
                      const value = i + 1
                      const on = picked === value
                      return (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          title={option}
                          onClick={() => setAnswers((a) => ({ ...a, [q.id]: value }))}
                          className={cn(
                            "relative flex min-h-12 flex-col items-center justify-center rounded-md border px-1 py-1 text-center text-[10px] leading-tight outline-none transition-[border-color,background-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97]",
                            on ? (value === 3 ? "border-foreground/40 bg-muted" : "border-brand bg-brand/10 text-foreground") : "border-border text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <span className="line-clamp-3">{option}</span>
                          {q.recommended === value && (
                            <span className="absolute -top-1 -right-1 size-2 rounded-full bg-brand ring-2 ring-background" title="The lab would pick this" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                  {q.why && <p className="text-[11px] text-pretty text-muted-foreground">{q.why}</p>}
                </li>
              )
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="xs" onClick={() => setAnswers(Object.fromEntries(interview.questions.map((q) => [q.id, q.recommended])))}>
              Take the lab&apos;s picks
            </Button>
          </div>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else to change (optional)" className="min-h-14 text-xs" />
          <Button size="sm" disabled={busy !== null || (!changes && !notes.trim())} onClick={() => run("apply", () => onApply(answers, notes))} className="self-start active:scale-[0.97]">
            {busy === "apply" ? <LoaderCircleIcon className="animate-spin" /> : <WandSparklesIcon />}
            {changes ? `Apply ${changes} ${changes === 1 ? "change" : "changes"}` : "Apply"}
          </Button>
        </>
      )}
    </section>
  )
}

export function SuggestionsPanel({
  suggestions,
  room,
  onTry,
}: {
  suggestions: Suggestion[] | undefined
  /** How many more variants fit next to those being tried. */
  room: number
  onTry: (ids: string[], free: string) => Promise<void>
}) {
  const [picked, setPicked] = React.useState<string[]>([])
  const [free, setFree] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  // New suggestions: none picked.
  const [pickedFor, setPickedFor] = React.useState(suggestions)
  if (pickedFor !== suggestions) {
    setPickedFor(suggestions)
    setPicked([])
  }
  const count = picked.length + (free.trim() ? 1 : 0)

  return (
    <section className="flex flex-col gap-2.5" aria-label="Suggestions">
      <header className="flex items-center gap-2">
        <LightbulbIcon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Try a variant</h3>
        <span className="ml-auto text-[11px] text-muted-foreground">{room} of 5 free</span>
      </header>
      {suggestions?.length ? (
        <ul className="flex flex-col gap-1">
          {suggestions.map((s) => {
            const on = picked.includes(s.id)
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked((list) => (on ? list.filter((x) => x !== s.id) : [...list, s.id]))}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-xs outline-none transition-[border-color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
                    on ? "border-brand/60 bg-brand/10" : "border-border hover:border-foreground/25"
                  )}
                >
                  <span className={cn("mt-px grid size-3.5 shrink-0 place-items-center rounded-[4px] border", on ? "border-brand bg-brand text-white" : "border-input")}>{on && <CheckIcon className="size-2.5" />}</span>
                  <span className="text-pretty">{s.text}</span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">The interview brings five suggestions along.</p>
      )}
      <Input value={free} onChange={(e) => setFree(e.target.value)} placeholder="Or an idea of your own" className="h-8 text-xs" />
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !count || count > room}
        onClick={async () => {
          setBusy(true)
          try {
            await onTry(picked, free)
            setFree("")
          } catch (error) {
            toast.error((error as Error).message)
          } finally {
            setBusy(false)
          }
        }}
        className="self-start active:scale-[0.97]"
      >
        {busy ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
        {count > 1 ? `Try ${count} variants` : "Try it"}
      </Button>
      {count > room && <p className="text-[11px] text-amber-700 dark:text-amber-400">Only {room} more fit: adopt or drop a variant first.</p>}
    </section>
  )
}
