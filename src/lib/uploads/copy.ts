import type { PosterAnalysis } from "@/lib/generation/types"
import type { KeywordInsight } from "@/lib/keywords/types"
import { askJson } from "@/lib/mockups/gemini"

import { adoption, cleanTag, cleanTags, cleanTitle, words } from "./text"
import { TAG_COUNT, TAG_MAX, TITLE_MAX, type DraftDesign, type DraftSource, type ListingCopy } from "./types"

// The copywriter: Gemini looks at our poster and writes its Etsy title, 13
// tags and description. The stolen listing is the main inspiration — it sells,
// so most of its wording stays — but the copy has to describe what OUR poster
// shows, read as a listing of its own, and lean on keywords the library has
// seen selling. It picks one of several keyword strategies each time, steered
// away from the ones used lately, so a shop's listings don't all read alike.

export const STRATEGIES = {
  "Long-tail niche": "specific multi-word phrases a buyer types when they know exactly what they want; less competition, high intent",
  "Broad + room": "high-volume poster/wall art terms paired with the room or spot it hangs in (kitchen, nursery, bathroom, office…)",
  "Gift angle": "who it's a gift for and the occasion (housewarming, birthday, for coffee lovers…), plus the subject",
  "Style-led": "the art style, movement and medium (mid century, japanese woodblock, gouache, maximalist…) leading the subject",
  "Subject-first": "the depicted subject in its many phrasings and synonyms, so every way of searching for it is covered",
  "Colour & mood": "colour and vibe terms buyers decorate by (pink, sage green, retro, moody, cheerful, funky…)",
  "Trend phrase": "current decor aesthetics and trending phrases that fit (dopamine decor, eclectic, retro kitchen, preppy…)",
} as const

export type Strategy = keyof typeof STRATEGIES

const NAMES = Object.keys(STRATEGIES) as Strategy[]

export type CopyInput = {
  source: DraftSource
  design: DraftDesign
  analysis?: PosterAnalysis
  /** The steal's category, e.g. "Funky". */
  folder: string
  /** Our poster, so nothing is claimed it doesn't show. */
  image?: Buffer
  keywords: KeywordInsight[]
  insights: string | null
  /** The shop's latest listings, newest first: to not sound like them. */
  recent: { title: string; strategy?: string }[]
  /** What to do differently this time, in the user's words. */
  hint?: string
}

const text = { type: "STRING" }
const SCHEMA = {
  type: "OBJECT",
  properties: {
    strategy: { type: "STRING", enum: NAMES },
    strategyWhy: text,
    title: text,
    tags: { type: "ARRAY", items: text, minItems: TAG_COUNT, maxItems: 18 },
    description: text,
    adoption: { type: "NUMBER" },
    reasoning: text,
  },
  required: ["strategy", "strategyWhy", "title", "tags", "description", "adoption", "reasoning"],
}

type Answer = ListingCopy

/** Strategies least used in `recent`, the next ones to lean towards. */
function freshStrategies(recent: CopyInput["recent"]) {
  const uses = new Map<string, number>(NAMES.map((n) => [n, 0]))
  // Recent uses weigh more than older ones.
  recent.forEach((r, i) => r.strategy && uses.set(r.strategy, (uses.get(r.strategy) ?? 0) + (recent.length - i)))
  return [...NAMES].sort((a, b) => uses.get(a)! - uses.get(b)! || Math.random() - 0.5).slice(0, 3)
}

const round = (n: number) => Math.round(n * 100) / 100

function keywordLines(keywords: KeywordInsight[]) {
  if (!keywords.length) return "(The library is empty — rely on the source listing and your own Etsy knowledge.)"
  return keywords
    .slice(0, 40)
    .map(
      (k) =>
        `- "${k.keyword}" (${k.kind}) · score ${Math.round(k.score)} · ${k.shops} shop${k.shops === 1 ? "" : "s"}, ${k.listings} listings · avg ${round(k.avgSalesPerMonth)} sales/mo · ${Math.round(k.topShare * 100)}% top sellers`
    )
    .join("\n")
}

function designLines({ design, analysis }: CopyInput) {
  const lines = [
    `Kind: ${design.mode === "idea" ? "a NEW IDEA on the source's concept — a different scene, so much of the source's subject wording no longer fits" : "a VARIANT of the source poster — same subject and concept, redrawn"}`,
  ]
  if (design.title) lines.push(`Name: ${design.title}`)
  if (design.summary) lines.push(`Shows: ${design.summary}`)
  if (analysis) {
    lines.push(
      `Reference poster read: ${analysis.summary}`,
      `Subject: ${analysis.subject} · setting: ${analysis.setting} · action: ${analysis.action}`,
      `Style: ${analysis.style} · mood: ${analysis.mood} · palette: ${analysis.palette.join(", ")}`,
      `Why it sells: ${analysis.hook} · buyers: ${analysis.audience}`
    )
    if (analysis.typography) lines.push(`Lettering: ${analysis.typography}`)
  }
  return lines.join("\n")
}

function prompt(input: CopyInput, retry?: string) {
  const { source, folder, recent, hint, design } = input
  const fresh = freshStrategies(recent)
  const [low, high] = design.mode === "idea" ? [0.3, 0.6] : [0.5, 0.85]
  return `You are the Etsy SEO copywriter for a shop selling printable wall-art posters. Write the listing for OUR poster (the image attached; that is what the buyer gets).

THE STOLEN SOURCE LISTING — a competitor's best seller our poster was inspired by. Its wording is proven to sell, so it is your biggest inspiration:
Title: ${source.title}
Tags: ${source.tags.length ? source.tags.join(", ") : "(unknown)"}

OUR POSTER
${designLines(input)}
Shop category: ${folder}

KEYWORD LIBRARY — keywords from competitor shops, with how the listings using them sell (estimates; read as relative strength). Prefer strong, relevant ones:
${keywordLines(input.keywords)}
${input.insights ? `\nWHAT THE LIBRARY ANALYSIS FOUND\n${input.insights}\n` : ""}
OUR LATEST LISTINGS — don't sound like these; vary phrasing, order and angle:
${recent.length ? recent.slice(0, 15).map((r) => `- ${r.title}${r.strategy ? `  [${r.strategy}]` : ""}`).join("\n") : "(none yet)"}

KEYWORD STRATEGIES — pick the ONE that best fits this poster and its buyers:
${NAMES.map((n) => `- ${n}: ${STRATEGIES[n]}`).join("\n")}
Lately used least (lean towards one of these unless another clearly fits better): ${fresh.join(", ")}.

RULES
- Carry over roughly ${Math.round(low * 100)}–${Math.round(high * 100)} % of the source's wording (title words and tags) — never copy it as is, and never statically: decide per keyword what to keep, rephrase, reorder or replace with a stronger library keyword or your own variant. Report the share you chose as "adoption" (0–1).
- Describe only what OUR poster really shows. Drop source keywords about things our poster doesn't have.
- Title: max ${TITLE_MAX} characters, the most important search phrase first, then 3–5 further keyword phrases separated by " | ". Natural, readable, title case. No word repeated more than needed. Use "&", ":" and "%" at most once each.
- Tags: give ${TAG_COUNT}–16 candidates ranked best first. Each max ${TAG_MAX} characters, lower case, no duplicates, mostly 2–3 word long-tail phrases; cover subject, style, room, gift and mood angles; don't waste tags on words that are only in the category.
- Never use trademarks, brand names, artist names, copyrighted characters, or the competitor's shop name.
- Description: 3 short paragraphs, plain text, benefit-led: a hook line, what it shows and its style, where it shines and who it's for. No sizes, prices, file formats, shipping or placeholders — those are added separately.
- reasoning: one or two sentences on the choices (what you kept from the source, what you changed and why).
${hint ? `\nTHE SHOP OWNER ASKS: ${hint}\n` : ""}${retry ? `\n${retry}\n` : ""}`
}

/** Share of the title's words already in one of `titles`, the most similar one. */
function similarity(title: string, titles: string[]) {
  const own = new Set(words(title))
  if (!own.size) return 0
  return Math.max(0, ...titles.map((t) => {
    const other = new Set(words(t))
    const shared = [...own].filter((w) => other.has(w)).length
    return shared / new Set([...own, ...other]).size
  }))
}

/** Up to 13 tags: the model's, then strong library keywords and the source's that fit. */
function topUp(tags: string[], input: CopyInput) {
  if (tags.length >= TAG_COUNT) return tags
  const extra = [
    ...input.keywords.filter((k) => k.kind === "tag").map((k) => k.keyword),
    ...input.source.tags,
  ].filter((t) => cleanTag(t).length <= TAG_MAX)
  return cleanTags([...tags, ...extra])
}

/** The listing copy for one poster: one Gemini call, two when it came out too close to a recent title. */
export async function writeListing(input: CopyInput): Promise<ListingCopy> {
  const ask = (retry?: string) =>
    askJson<Answer>(prompt(input, retry), input.image ? [input.image] : [], {
      schema: SCHEMA,
      temperature: 0.9,
    })

  let answer = await ask()
  const recentTitles = input.recent.map((r) => r.title)
  if (similarity(answer.title, recentTitles) > 0.7) {
    answer = await ask(
      `Your first title was too close to one of our latest listings ("${answer.title}"). Write a clearly different one — different lead phrase and structure.`
    )
  }

  const title = cleanTitle(answer.title)
  const tags = topUp(cleanTags(answer.tags ?? []), input)
  return {
    title,
    tags,
    description: (answer.description ?? "").trim(),
    strategy: NAMES.includes(answer.strategy as Strategy) ? answer.strategy : "Subject-first",
    strategyWhy: (answer.strategyWhy ?? "").trim(),
    // What was really carried over, not what the model says it did.
    adoption: round(adoption(input.source, { title, tags })),
    reasoning: (answer.reasoning ?? "").trim(),
  }
}
