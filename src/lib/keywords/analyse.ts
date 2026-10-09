import { askJson } from "@/lib/mockups/gemini"

import { analysisDigest, saveAnalysis } from "./library"
import type { KeywordAnalysis } from "./types"

// Gemini reads the library's strongest keywords and titles (and a few that
// barely sell, for contrast) and says what works. The answer is held to a
// schema, so the page can lay it out and the upload pipeline can quote it.

const text = { type: "STRING" }
const list = (items: object) => ({ type: "ARRAY", items })
const object = (properties: Record<string, object>) => ({
  type: "OBJECT",
  properties,
  required: Object.keys(properties),
})

const SCHEMA = object({
  summary: text,
  winningPatterns: list(object({ title: text, detail: text, examples: list(text) })),
  titleStructures: list(object({ pattern: text, why: text, example: text })),
  tagStrategies: list(object({ strategy: text, detail: text, tags: list(text) })),
  gaps: list(object({ opportunity: text, detail: text, keywords: list(text) })),
  avoid: list(object({ pattern: text, why: text })),
})

const PROMPT = `You are an Etsy SEO strategist for a shop that sells printable wall-art posters. Below is a keyword library built from competitor shops: their tags and title phrases with how the listings using them sell (sales are estimates from public signals, so read them as relative strength, not exact numbers).

Work out what actually drives sales here. Be concrete and specific to this data — quote real keywords and phrases from it, never generic SEO advice.
- summary: 2–3 sentences, the most important takeaways.
- winningPatterns: 4–6 themes, subjects, styles or buyer intents that sell well, each with example keywords from the data.
- titleStructures: 3–5 title formulas the best sellers follow (e.g. "[Subject] Print | [Style] Wall Art | [Room] Decor"), why they work, and a fresh example title written in that structure (not copied from the data).
- tagStrategies: 3–5 ways the strongest listings use their 13 tags (mix of broad and long-tail, room, gift, style, colour…), with example tags.
- gaps: 3–5 keyword opportunities — strong demand signals that few listings or shops cover yet.
- avoid: 2–4 keyword habits common among listings that barely sell.

LIBRARY
`

/** Runs the analysis on the library as it is now and stores it. */
export async function analyseLibrary() {
  const { stats, text: digest } = await analysisDigest()
  if (stats.listings === 0) throw new Error("Add a shop to the library first")
  const insights = await askJson<KeywordAnalysis>(`${PROMPT}${digest}`, [], {
    schema: SCHEMA,
    temperature: 0.4,
  })
  return saveAnalysis(insights)
}
