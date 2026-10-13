import { askJson } from "@/lib/mockups/gemini"
import { getSet, newId, readSetFile, updateOutput, updateSet } from "@/lib/generation/storage"
import type { AutoCheck, Output } from "@/lib/generation/types"

import { getStyle } from "./storage"

// Every Autonomous scale poster is looked at once it's painted, the way an
// art director would before it goes on the wall with the series: Gemini
// compares it with its anchor and refs for the hand (paint handling, detail,
// palette, light), the feeling and the poster itself. What it says stays on
// the output, and one that misses the series is painted once more with
// its notes (see `retakeOf`), so what reaches review is the series.

/**
 * Calibrated on the dopamin runs (13 Oct) against my own look: Gemini gives
 * 9–10 to posters that hang with the series, 6–7 to ones a little tighter or
 * cleaner than their anchor (often still good), 5 and below to clear misses
 * (another hand, a near copy gone graphic). Painting a 6 again from scratch
 * came back a 6 (the same refining), so only a clear miss is set aside as
 * rejected and repainted once in its anchor's hand (see `retakeOf`).
 */
export const MISS = { style: 5, feeling: 5, appeal: 4 }

const SCHEMA = {
  type: "OBJECT",
  properties: {
    differences: { type: "STRING" },
    style: { type: "INTEGER" },
    feeling: { type: "INTEGER" },
    appeal: { type: "INTEGER" },
    notes: { type: "STRING" },
  },
  required: ["differences", "style", "feeling", "appeal", "notes"],
  propertyOrdering: ["differences", "style", "feeling", "appeal", "notes"],
}

/** Gemini's look at a painted Autonomous scale poster, stored on it; null when it couldn't look. */
export async function checkAuto(setId: string, outputId: string): Promise<AutoCheck | null> {
  try {
    const set = await getSet(setId)
    const output = set.outputs.find((o) => o.id === outputId)
    if (!output?.auto || !output.file) return null
    const series = [output.poster, ...(output.refs ?? [])]
      .map((i) => set.posters.find((p) => p.index === i && p.file))
      .filter((p) => !!p)
    const images = await Promise.all([output.file, ...series.map((p) => p!.file!)].map((f) => readSetFile(setId, f)))
    const emotion = set.style ? (await getStyle(set.style.id).catch(() => null))?.study?.emotion : undefined
    const answer = await askJson<Partial<AutoCheck>>(checkPrompt(output, series.length, emotion), images, {
      schema: SCHEMA,
      temperature: 0.2,
    })
    const score = (v: unknown) => Math.max(1, Math.min(10, Math.round(Number(v) || 1)))
    const check: AutoCheck = {
      style: score(answer.style),
      feeling: score(answer.feeling),
      appeal: score(answer.appeal),
      notes: typeof answer.notes === "string" ? answer.notes.trim().slice(0, 600) : "",
    }
    await updateOutput(setId, outputId, { check })
    return check
  } catch (error) {
    console.error(`Generation ${setId}, checking ${outputId}:`, error)
    return null
  }
}

export const misses = (c: AutoCheck) => c.style <= MISS.style || c.feeling <= MISS.feeling || c.appeal <= MISS.appeal

function checkPrompt(output: Output, series: number, emotion?: string) {
  return `Image 1 is a NEW poster we painted to continue a best-selling series. ${series > 1 ? `Images 2–${series + 1} are` : "Image 2 is"} from that series; image 2 is the one it must match most closely. It was meant to show: "${output.brief ?? output.title ?? "a new poster"}".

Judge like a strict art director deciding whether a buyer would believe image 1 was painted by the same artist, for the same series. Image models usually fail by refining: tighter, finer, more detailed, smoother, cleaner or more saturated than the series — look for exactly that.
- differences: first, compare image 1 with image 2 point by point — stroke size and looseness, texture, edges and outlines, amount of detail (fur, faces, patterns, background), flatness, palette and saturation, light. Name every visible difference.
- style (1–10): 10 = indistinguishable from the series; 8 = the same hand, differences only an expert would see; 6 = the same idea but visibly another hand (any clear difference above: tighter, finer, more detailed, smoother, crisper texture, brighter or more muted); 3 = another style.
- feeling (1–10): the same emotion and energy as the series${emotion ? ` (${emotion})` : ""}: expressions, body language, warmth, humour. 10 = exactly; 5 = noticeably quieter, moodier, more serious or more dramatic.
- appeal (1–10): as a poster on its own: charming, instantly readable, well composed and clean (no garbled lettering, broken anatomy, extra limbs, melted objects or artefacts).
- notes: when anything is off, one to three short, concrete instructions for repainting it, naming no image numbers — say "the series" (e.g. "bigger, looser brush strokes, as in the series", "fewer background details", "the series' bright pink instead of a muted mauve", "the cat's eyes closed in bliss, as in the series"); otherwise "".`
}

/**
 * Whether a clear miss is rejected and tried once more. Off: on the dopamin
 * board (four families of competitors' posters) Gemini failed posters that
 * fit the series well, judged against one anchor, and neither a second try
 * from scratch (5 → 5) nor a repaint of the first (5 → 6, nearly the same
 * picture) changed Nano Banana's tidier hand. The scores stay on each output
 * for review.
 */
export const RETAKE = false

/**
 * Looks at a freshly painted Autonomous scale poster; a clear miss is set
 * aside as rejected and repainted once, in its anchor's hand, with the
 * check's notes (`queue` puts its set back in line).
 */
export async function reviewAuto(setId: string, outputId: string, queue: (id: string) => void) {
  const check = await checkAuto(setId, outputId)
  if (!check || !misses(check) || !RETAKE) return
  const set = await getSet(setId)
  const failed = set.outputs.find((o) => o.id === outputId)
  const again = failed && retakeOf({ ...failed, check })
  if (!again || failed.review) return
  await updateSet(setId, (s) => ({
    ...s,
    status: "queued",
    doneAt: undefined,
    outputs: [
      ...s.outputs.map((o) =>
        o.id === outputId
          ? { ...o, review: "rejected" as const, reviewedAt: new Date().toISOString(), note: `Auto check: ${scoreLine(check)}` }
          : o
      ),
      again,
    ],
  }))
  queue(setId)
}

export const scoreLine = (c: AutoCheck) =>
  `style ${c.style}, feeling ${c.feeling}, poster ${c.appeal}${c.notes ? ` — ${c.notes}` : ""}`

/** The output repainting `failed` in its anchor's hand, with its check's notes; null when it's already a second try. */
function retakeOf(failed: Output): Output | null {
  if (!failed.check || failed.from) return null
  return {
    id: newId(),
    status: "pending",
    file: null,
    batch: failed.batch,
    review: null,
    createdAt: new Date().toISOString(),
    poster: failed.poster,
    refs: failed.refs,
    mode: failed.mode,
    creativity: failed.creativity,
    auto: true,
    title: failed.title,
    brief: failed.brief,
    from: failed.id,
    feedback: failed.check.notes || "Match the series' hand and feeling exactly.",
  }
}
