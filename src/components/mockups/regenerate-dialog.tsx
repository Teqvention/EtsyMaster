"use client"

import { useRouter } from "next/navigation"
import * as React from "react"
import { LoaderCircleIcon, PlusIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { DeliveryField, useDelivery } from "@/components/generation/generate-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { isActive, regenerateMockup, useGenerations } from "@/hooks/use-generations"

// A mockup's blank made again, with a few words on what should be different.
// One stolen from a listing photo goes back to its generation set (now or in
// a batch job); any other is redrawn now from what it is. Either way the new
// blank goes under the same scene, so its place, chains and clips stay.

/** Mockups without a set, being redrawn by this tab. */
const redrawing = new Set<string>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((notify) => notify())

/** Whether the mockup's blank is being made again. */
export function useRemaking(sceneId: string) {
  const sets = useGenerations()
  const here = React.useSyncExternalStore(
    (notify) => {
      listeners.add(notify)
      return () => {
        listeners.delete(notify)
      }
    },
    () => redrawing.has(sceneId),
    () => false
  )
  return here || !!sets?.some((s) => s.kind === "mockup" && s.sceneId === sceneId && isActive(s))
}

const IDEAS = [
  "Keep the frame straight and the same size",
  "Keep everything in front of the frame",
  "A clean white sheet, nothing of the old print",
  "Don't change the room or the light",
]

export function RegenerateMockupDialog({
  open,
  onOpenChange,
  sceneId,
  name,
  image,
  onRedrawn,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sceneId: string
  name: string
  /** What it looks like now. */
  image?: string | null
  /** A mockup without a set has its new blank. */
  onRedrawn?: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        {open && (
          <Form
            sceneId={sceneId}
            name={name}
            image={image}
            onRedrawn={onRedrawn}
            onStarted={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Form({
  sceneId,
  name,
  image,
  onRedrawn,
  onStarted,
}: {
  sceneId: string
  name: string
  image?: string | null
  onRedrawn?: () => void
  onStarted: () => void
}) {
  const router = useRouter()
  const sets = useGenerations()
  const set = sets?.find((s) => s.kind === "mockup" && s.sceneId === sceneId)
  const [feedback, setFeedback] = React.useState("")
  const [delivery, setDelivery] = useDelivery()
  const [busy, setBusy] = React.useState(false)
  const field = React.useRef<HTMLTextAreaElement>(null)

  function add(idea: string) {
    setFeedback((text) => (text.trim() ? `${text.trim().replace(/[.,;]?$/, ".")} ${idea}` : idea))
    field.current?.focus()
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    const asked = feedback.trim()
    if (!set) {
      // Redrawn now, about a minute: the dialog needn't wait for it.
      redrawing.add(sceneId)
      changed()
      onStarted()
      const request = regenerateMockup(sceneId, asked, "now").finally(() => {
        redrawing.delete(sceneId)
        changed()
      })
      toast.promise(request, {
        loading: `Making ${name} again…`,
        success: (result) => {
          onRedrawn?.()
          return result.scene?.located === false
            ? `${name} is made again: set the four corners in the editor, the sheet wasn't found`
            : `${name} is made again`
        },
        error: (error: Error) => `Couldn't make ${name} again: ${error.message}`,
      })
      return
    }
    setBusy(true)
    try {
      await regenerateMockup(sceneId, asked, delivery)
      onStarted()
      toast.success(`Making ${name} again`, {
        description:
          delivery === "batch"
            ? "In a batch job: back in minutes to a few hours, then it replaces this one."
            : "In about a minute it replaces this one.",
        action: { label: "View", onClick: () => router.push("/generation?kind=mockup") },
      })
    } catch (error) {
      toast.error(`Couldn't make ${name} again: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col">
      <DialogHeader className="gap-1 p-5 pr-12 pb-4">
        <DialogTitle className="text-base">Regenerate mockup</DialogTitle>
        <DialogDescription className="truncate">{name}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3 px-5 pb-5">
        <div className="flex gap-3">
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="size-24 shrink-0 rounded-lg border bg-muted object-cover" />
          )}
          <Textarea
            ref={field}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit()
            }}
            placeholder="What should be different? E.g. the frame is crooked, the plant in front is gone, there's still some of the print…"
            aria-label="What should be different"
            autoFocus
            maxLength={2000}
            className="min-h-24 resize-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="Ideas">
          {IDEAS.map((idea) => (
            <Button key={idea} type="button" variant="outline" size="xs" onClick={() => add(idea)}>
              <PlusIcon />
              {idea}
            </Button>
          ))}
        </div>
        {set && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <DeliveryField value={delivery} onChange={setDelivery} />
          </div>
        )}
      </div>

      <DialogFooter className="m-0 flex-row items-center gap-2 border-t bg-muted/50 px-5 py-3">
        <p className="mr-auto text-xs text-pretty text-muted-foreground">
          {set ? "Painted again from the listing photo" : "Redrawn now, about a minute"}; it keeps its chains and animations.
        </p>
        <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
        <Button type="submit" disabled={busy} className="active:scale-[0.97] motion-reduce:active:scale-100">
          {busy ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
          Regenerate
        </Button>
      </DialogFooter>
    </form>
  )
}
