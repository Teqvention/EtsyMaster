import { readDoc, writeDoc } from "@/lib/db/documents"

import { writePlaceBrief } from "./prompts"
import type { PlaceBrief } from "./studio-types"

// What makes a place itself (landmarks, poster motifs, geography,
// viewpoints), written once per place by Gemini and kept as
// citys/briefs/<placeId>, so every brief and prompt about the place knows
// London means Big Ben and a red bus.

const DOC = (placeId: string) => `citys/briefs/${placeId}`
const writing = new Map<string, Promise<PlaceBrief | null>>()

export async function placeBrief(placeId: string, place: string, country = "", kind = ""): Promise<PlaceBrief | null> {
  const held = await readDoc<PlaceBrief | null>(DOC(placeId), null)
  if (held) return held
  let pending = writing.get(placeId)
  if (!pending) {
    pending = writePlaceBrief(place, country, kind)
      .then(async (brief) => {
        if (!brief.landmarks.length) return null
        await writeDoc(DOC(placeId), brief)
        return brief
      })
      .catch((error) => {
        console.warn(`Place brief ${place}:`, (error as Error).message)
        return null
      })
      .finally(() => writing.delete(placeId))
    writing.set(placeId, pending)
  }
  return pending
}

/** A line on the place for the image model: its leading landmarks and what must be right. */
export const placeLine = (b: PlaceBrief | null) => (b ? [b.landmarks.slice(0, 6).join("; "), b.geography].filter(Boolean).join(". ") : undefined)
