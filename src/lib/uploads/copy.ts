
import { EtsyApiError, etsyGet, type ApiListing } from "@/lib/etsy/client"
import { getSet, readSetFile } from "@/lib/generation/storage"
import type { PosterAnalysis } from "@/lib/generation/types"
import { checkDemand } from "@/lib/keywords/demand"
import { keywordContext, libraryInsights, normalise } from "@/lib/keywords/library"
import type { KeywordDemand, KeywordInsight } from "@/lib/keywords/types"
import { askJson } from "@/lib/mockups/gemini"

import { withoutDashes } from "./description"
import { adoption, cleanTag, cleanTitle, words } from "./text"
import { TAG_COUNT, TAG_MAX, TITLE_MAX, type Draft, type DraftDesign, type DraftSource, type ListingCopy } from "./types"

// The copywriter: Gemini looks at our poster and writes its Etsy title, 13
// tags and the story that opens its description. The stolen listing is the
// main inspiration (it sells, so part of its wording stays, and its
// description's voice colours ours) but the copy has to describe what OUR
// poster shows, read as a listing of its own, and lean on keywords that sell
// for strong shops. Each listing gets the keyword strategy, title shape and
// way into the story our latest listings used least, and tags those listings
// already crowd are kept to two, so a shop's listings neither read nor
// compete alike. The lead phrases it proposes are checked against Etsy's live
// search; a look over the answer (stock phrases, a title too close to
// another, missing tag angles, a lead nobody searches) may send it back once.

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

/** How a title strings its phrases together; `share` is how often, relative to the others. */
const SHAPES = {
  commas: {
    share: 4,
    rule: "3 to 5 keyword phrases separated by commas",
    example: "Lemon Tree Art Print, Mediterranean Kitchen Poster, Yellow Botanical Wall Art, Housewarming Gift",
  },
  colon: {
    share: 2.5,
    rule: "the lead phrase, a colon, then 2 or 3 phrases separated by commas",
    example: "Lemon Tree Print: Mediterranean Kitchen Wall Art, Yellow Botanical Poster",
  },
  short: {
    share: 2,
    rule: "short and calm, 2 phrases separated by a comma, 45 to 85 characters",
    example: "Lemon Tree Art Print, Mediterranean Kitchen Decor",
  },
  pipes: {
    share: 1.5,
    rule: '3 or 4 keyword phrases separated by " | "',
    example: "Lemon Tree Art Print | Mediterranean Kitchen Poster | Yellow Botanical Wall Art",
  },
} as const

type Shape = keyof typeof SHAPES

/** Ways into the story. */
const OPENINGS = {
  scene: "Open on what is happening in the picture, plainly, the way you'd tell a friend.",
  detail: "Open on one small detail of the picture that people only catch on a second look.",
  wall: "Open on the wall it hangs on and what it does to that room.",
  person: "Open on one particular person it suits, in a single sentence.",
  maker: "Open in first person on why this picture exists: the idea or the joke behind it, or what changed until it worked.",
} as const

type Opening = keyof typeof OPENINGS

const ANGLES = ["subject", "style", "room", "gift", "colour", "mood", "occasion"] as const

/** What listing copy written by a machine gives itself away with; never in a story. */
const CLICHES = [
  "indulge", "elevate", "dive into", "embrace", "unleash", "immerse", "whether you", "perfect for", "perfect gift",
  "perfect addition", "the perfect", "conversation starter", "statement piece", "a touch of", "pop of color", "pops",
  "brighten", "breathe new life", "look no further", "is sure to", "are sure to", "must have", "showstopper", "eye catching",
  "effortless", "testament", "tapestry", "captivating", "stunning", "main character", "unapologetic", "vibe",
  "vibrant", "whimsical", "whimsy", "transform", "infuse", "bring joy", "brings joy", "feast for", "in a world",
  "say hello", "this piece", "masterpiece", "timeless", "nestled", "evoke", "invites you", "delightful", "charming",
  "exquisite", "speaks to", "journey", "you'll love", "add character", "adds character", "imagine", "for anyone who",
  "too seriously", "embracing", "indulging", "elevating", "evoking", "infusing",
]

// With the endings they take ("whimsically", "transformed"), but whole words: "pops" isn't "popsicle".
const cliche = new RegExp(`\\b(?:${CLICHES.join("|").replace(/[.*+?^${}()[\]\\]/g, "\\$&")})(?:s|d|ly|ed|ing|al|ally)?\\b`, "gi")

/** The maker claiming handwork: "I painted", "my brushstrokes". */
const CLAIM = /\b(?:I|we)\s+(?:\w+\s+)?(?:painted|drew|sketched|brushed|inked|illustrated|used (?:thick |heavy )?(?:paint|brush|impasto|ink))|\bmy (?:brush|paint|own hand)/i

/** What the blocks below the story cover, or what it must not claim. */
const OFF_STORY: [RegExp, string][] = [
  [/\b(?:\d+(?:[.,]\d+)?\s*[x×]\s*\d+|cm|inch(?:es)?|a[1-5]|sizes?)\b/i, "sizes"],
  [/\b(?:ship(?:s|ped|ping)?|deliver(?:y|ed)?)\b/i, "shipping"],
  [/\bframe[sd]?\b/i, "frames"],
  [/\b(?:digital|download|printable)\b/i, "downloads (it is a printed poster)"],
  [/\b(?:ai|artificial intelligence|generated)\b/i, "how it was made"],
  [/\b(?:hand ?painted|hand ?made|original (?:painting|artwork)|canvas)\b/i, "handwork it isn't"],
  [CLAIM, "that you painted or drew it yourself (an AI image model made it, you directed it)"],
]

/** Words most wall art keywords have: they don't tell what a poster shows. */
const GENERIC = new Set(["print", "poster", "wall", "decor", "artwork", "gift", "home", "picture", "illustration", "painting"])

/** Colours are what the image shows best; a brief's "white robes" shouldn't pull in "black and white art". */
const COLOURS = new Set([
  "white", "black", "blue", "red", "green", "pink", "teal", "yellow", "orange", "purple", "grey", "gray", "brown", "gold",
  "golden", "silver", "beige", "cream", "dark", "light", "bright", "navy", "turquoise", "mint", "sage", "coral", "lilac",
])

/** How many of our latest listings to keep apart from. */
const RECENT = 20
/** Tags on this many of the latest listings are crowded; a new one gets two of them at most. */
const CROWDED = 3

/** One of our latest listings, newest first. */
export type RecentListing = {
  title: string
  tags?: string[]
  strategy?: string
  form?: ListingCopy["form"]
  description?: string
}

/**
 * The listings being written now, as planned (their form and the strategy
 * they lean to first), oldest first: written side by side, they aren't among
 * each other's recent listings yet, so each new plan counts them as the newest.
 */
const global = globalThis as typeof globalThis & { __copyWriting?: Set<RecentListing> }
const writing = (global.__copyWriting ??= new Set())

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
  recent: RecentListing[]
  /** What to do differently this time, in the user's words. */
  hint?: string
}

const text = { type: "STRING" }
const SCHEMA = {
  type: "OBJECT",
  properties: {
    strategy: { type: "STRING", enum: NAMES },
    strategyWhy: text,
    leadOptions: { type: "ARRAY", items: text, minItems: 3, maxItems: 4 },
    lead: text,
    title: text,
    tags: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { tag: text, angle: { type: "STRING", enum: ANGLES } },
        required: ["tag", "angle"],
      },
      minItems: TAG_COUNT,
      maxItems: 16,
    },
    description: text,
    reasoning: text,
  },
  required: ["strategy", "strategyWhy", "leadOptions", "lead", "title", "tags", "description", "reasoning"],
  propertyOrdering: ["strategy", "strategyWhy", "leadOptions", "lead", "title", "tags", "description", "reasoning"],
}

type Answer = {
  strategy: string
  strategyWhy: string
  leadOptions: string[]
  lead: string
  title: string
  tags: { tag: string; angle: string }[]
  description: string
  reasoning: string
}

/** What this listing is steered towards, from our latest ones. */
type Plan = {
  strategies: Strategy[]
  shape: Shape
  opening: Opening
  /** Tag → on how many of the latest listings. */
  crowded: Map<string, number>
  /** The source's subject words our poster doesn't show. */
  exclude: string[]
}

/** Strategies least used in `recent`, the next ones to lean towards. */
function freshStrategies(recent: CopyInput["recent"]) {
  const uses = new Map<string, number>(NAMES.map((n) => [n, 0]))
  // Recent uses weigh more than older ones.
  recent.forEach((r, i) => r.strategy && uses.set(r.strategy, (uses.get(r.strategy) ?? 0) + (recent.length - i)))
  return [...NAMES].sort((a, b) => uses.get(a)! - uses.get(b)! || Math.random() - 0.5).slice(0, 3)
}

/** The option used least in `used` (newest first, so newer uses weigh more) for its share. */
function leastUsed<T extends string>(shares: Record<T, number>, used: (string | undefined)[]): T {
  const options = Object.keys(shares) as T[]
  const uses = new Map<string, number>(options.map((o) => [o, 0]))
  used.forEach((u, i) => u && uses.has(u) && uses.set(u, uses.get(u)! + (used.length - i)))
  return [...options].sort((a, b) => uses.get(a)! / shares[a] - uses.get(b)! / shares[b] || Math.random() - 0.5)[0]
}

function shapeOf(title: string): Shape {
  if (title.includes("|")) return "pipes"
  if (title.includes(":")) return "colon"
  return title.length <= 85 ? "short" : "commas"
}

/** The source's subject words our poster doesn't show (its ducks on our pig poster). */
function offSubject({ source, design, analysis }: Pick<CopyInput, "source" | "design" | "analysis">) {
  if (!analysis) return []
  const ours = new Set(words(`${design.title ?? ""} ${design.summary ?? ""}`))
  const named = new Set(words(`${source.title} ${source.tags.join(" ")}`))
  return [...new Set(words(analysis.subject))].filter((w) => named.has(w) && !ours.has(w) && !GENERIC.has(w))
}

function planFor(input: CopyInput): Plan {
  const recent = input.recent.slice(0, RECENT)
  const latest = [...[...writing].reverse(), ...recent]
  const crowded = new Map<string, number>()
  for (const r of recent) {
    for (const tag of new Set((r.tags ?? []).map(cleanTag))) crowded.set(tag, (crowded.get(tag) ?? 0) + 1)
  }
  return {
    strategies: freshStrategies(latest),
    shape: leastUsed(
      Object.fromEntries(Object.entries(SHAPES).map(([k, s]) => [k, s.share])) as Record<Shape, number>,
      latest.map((r) => r.form?.title ?? shapeOf(r.title))
    ),
    opening: leastUsed(
      Object.fromEntries(Object.keys(OPENINGS).map((k) => [k, 1])) as Record<Opening, number>,
      latest.map((r) => r.form?.story)
    ),
    crowded: new Map([...crowded].filter(([, n]) => n >= CROWDED).sort((a, b) => b[1] - a[1])),
    exclude: offSubject(input),
  }
}

const round = (n: number) => Math.round(n * 100) / 100

function keywordLines(keywords: KeywordInsight[], crowded: Plan["crowded"]) {
  if (!keywords.length) return "(The library is empty: rely on the source listing and your own Etsy knowledge.)"
  return keywords
    .slice(0, 40)
    .map((k) => {
      const notes = [
        `score ${Math.round(k.score)}`,
        k.lift !== undefined && `${round(k.lift)}×avg`,
        k.trend !== undefined && (k.trend >= 1.1 ? "rising" : k.trend <= 0.9 ? "fading" : null),
        `${k.shops} shop${k.shops === 1 ? "" : "s"}, ${k.listings} listings, ${round(k.avgSalesPerMonth)} sales/mo each`,
        `${Math.round(k.topShare * 100)}% top sellers`,
        crowded.has(k.keyword) && `on ${crowded.get(k.keyword)} of our latest listings`,
      ].filter(Boolean)
      return `- "${k.keyword}" (${k.kind}): ${notes.join(" · ")}`
    })
    .join("\n")
}

/** A brief without its colour codes: "teal table (#16A075)" → "teal table". */
const plainBrief = (brief: string) => brief.replace(/\s*\(?#[0-9a-f]{3,8}\b\)?/gi, "").trim()

function designLines({ design, analysis }: CopyInput, plan: Plan) {
  const lines = [
    design.mode === "idea"
      ? "Kind: a NEW IDEA on the source's concept, a different scene, so much of the source's subject wording no longer fits"
      : "Kind: a VARIANT of the source poster, same subject and concept, redrawn",
  ]
  if (design.title) lines.push(`Name: ${design.title}`)
  if (design.summary) lines.push(`Shows: ${plainBrief(design.summary)}`)
  if (plan.exclude.length) lines.push(`Not on our poster, though the source has it: ${plan.exclude.join(", ")}`)
  if (analysis) {
    lines.push(
      `The source poster as read (${design.mode === "idea" ? "its subject is not ours" : "ours redraws it"}): ${analysis.summary}`,
      `Its style: ${analysis.style} · mood: ${analysis.mood}`,
      `Why it sells: ${analysis.hook} · buyers: ${analysis.audience}`
    )
    if (analysis.typography) lines.push(`Its lettering: ${analysis.typography}`)
  }
  return lines.join("\n")
}

/** Where a description's shop notes start (sizes, shipping, notes): the story ends before. */
const BOILERPLATE =
  /\b(?:sizes?|cm|inch(?:es)?|shipping|ships|delivery|frames?|framed|download|printable|paper|gsm|returns?|refunds?|copyright|please|note|monitor|screen)\b/i

/** The opening of the source's description, its story, up to `max` characters. */
function storyOf(description: string, max = 700) {
  const kept: string[] = []
  for (const paragraph of description.split(/\n\s*\n|\n(?=\P{L})/u)) {
    const line = paragraph.replace(/\s+/g, " ").trim()
    if (!line) continue
    if (BOILERPLATE.test(line) || !/\p{L}{3}/u.test(line)) {
      if (kept.length) break
      continue
    }
    kept.push(line)
    if (kept.join(" ").length >= max) break
  }
  const story = kept.join("\n")
  if (story.length <= max) return story
  const cut = story.slice(0, max)
  return cut.slice(0, Math.max(cut.lastIndexOf(". ") + 1, cut.lastIndexOf(" "))).trim()
}

function prompt(input: CopyInput, plan: Plan, retry?: string) {
  const { source, folder, recent, hint, design } = input
  const [low, high] = design.mode === "idea" ? [30, 60] : [50, 85]
  const shape = SHAPES[plan.shape]
  const story = storyOf(source.description ?? "")
  const crowded = [...plan.crowded].map(([tag, n]) => `${tag} (${n})`).join(", ")
  return `You write the Etsy listings of a small shop selling wall art posters. Write the listing for OUR poster: the attached image is exactly what the buyer gets.

THE SOURCE LISTING
A competitor's best seller our poster was inspired by. Its wording is proven to sell, so it is your biggest inspiration.
Title: ${source.title}
Tags: ${source.tags.length ? source.tags.join(", ") : "(unknown)"}
${story ? `How its description begins (the voice its buyers respond to):\n"""\n${story}\n"""\n` : ""}
OUR POSTER
${designLines(input, plan)}
Shop category: ${folder}

KEYWORDS THAT SELL FOR STRONG SHOPS
From our library of competitor shops with thousands of sales. The score (0 to 100) weighs the sales a keyword carries, how often top sellers and established shops use it, and over how many listings those sales spread. "×avg" is how its listings sell against the rest of their shop; rising or fading compares the listings of the last year. Prefer strong, rising keywords that truly fit OUR poster:
${keywordLines(input.keywords, plan.crowded)}
${input.insights ? `\nWHAT THE LIBRARY ANALYSIS FOUND\n${input.insights}\n` : ""}
OUR LATEST TITLES (sound different: another lead phrase, other words, another order)
${recent.length ? recent.slice(0, 15).map((r) => `- ${r.title}${r.strategy ? `  [${r.strategy}]` : ""}`).join("\n") : "(none yet)"}
${crowded ? `\nTAGS ALREADY ON MANY OF OUR LATEST ${Math.min(recent.length, RECENT)} LISTINGS: ${crowded}.\nWith them our own listings compete for the same searches. Use at most 2 of these, and only where they clearly fit.\n` : ""}
KEYWORD STRATEGIES (pick the ONE that best fits this poster and its buyers)
${NAMES.map((n) => `- ${n}: ${STRATEGIES[n]}`).join("\n")}
Used least lately (lean towards one of these unless another clearly fits better): ${plan.strategies.join(", ")}.

TITLE
- First list in "leadOptions" 3 or 4 search phrases of 2 to 4 words, lower case, that a buyer would really type into Etsy search and that OUR poster answers: specific ones, and at least one broader one for its subject (like "llama print"). We check them against Etsy's live search.
- Open the title with one of them (adding "Art Print", "Print", "Poster" or "Wall Art" is fine) and put that phrase in "lead".
- Shape: ${shape.rule}, like "${shape.example}" (the shape, not these words).
- At most ${TITLE_MAX} characters, title case, easy to read, no word repeated without need, "&", ":", "%" and "+" at most once each.

TAGS
- ${TAG_COUNT} to 16 candidates, best first, each at most ${TAG_MAX} characters counting spaces, lower case.
- Give each its angle: ${ANGLES.join(", ")}. Cover subject, style, room, gift, and colour or mood at least once each.
- Mostly 2 or 3 word phrases buyers type. No word in more than 3 tags (art, print, poster, decor aside); don't spend a tag on the shop category alone.
- Carry over roughly ${low} to ${high} % of the source's wording (title words and tags), never all of it and never by rote: per keyword, keep it, rephrase it, or replace it with a stronger library keyword or your own variant.

STORY (the "description" field)
- Only the story of the picture: 2 or 3 short paragraphs, 60 to 120 words in all. Sizes, paper, frames, shipping and how it was made follow below it separately, so leave all of that out.
- ${OPENINGS[plan.opening]}
- Let the source description's vibe show through, subtly: its tone, how playful or calm it is, the kind of thing it notices. Your own sentences, in your own order.
- Sound like the person who made it, talking to someone at a market stall: plain words, concrete things one can see in the picture, sentences of different lengths, a dry joke if the picture has one. "I" at most twice, and no made up stories about your life: the idea or the joke of the picture is enough.
- Never write: ${CLICHES.join(", ")}.
- No exclamation marks, emojis, lists or hashtags.
- Don't call it hand painted, handmade, an original painting or a canvas, and never say you painted or drew it: an AI image model made it, directed and chosen by the shop. What the picture looks like ("thick paint texture") is fine.

EVERYWHERE
- Describe only what OUR poster shows; drop source keywords about things it doesn't have.
- Never a hyphen or dash of any kind: write "mid century", "hand drawn", "1 to 3".
- Never trademarks, brand names, artist names, copyrighted characters, or the competitor's shop name.
- reasoning: one or two sentences on what you kept from the source, what you changed and why.
${hint ? `\nTHE SHOP OWNER ASKS: ${hint}\n` : ""}${retry ? `\n${retry}\n` : ""}`
}

/** The recent title sharing most of this one's words, and the share. */
function closest(title: string, titles: string[]) {
  const own = new Set(words(title))
  let best = { title: "", share: 0 }
  for (const t of own.size ? titles : []) {
    const other = new Set(words(t))
    const shared = [...own].filter((w) => other.has(w)).length
    const share = shared / new Set([...own, ...other]).size
    if (share > best.share) best = { title: t, share }
  }
  return best
}

const cliches = (story: string) => [...new Set((withoutDashes(story).match(cliche) ?? []).map((c) => c.toLowerCase()))]

const wordCount = (story: string) => story.split(/\s+/).filter(Boolean).length

const opening = (story: string) => story.toLowerCase().split(/\s+/).slice(0, 3).join(" ")

/**
 * Live search phrases with listings that sell, best first; only those naming
 * the poster's subject, as "pink swan poster" sells swans, not our llama on one.
 */
function selling(demand: KeywordDemand[], design: DraftDesign) {
  const subject = new Set(words(design.title ?? "").filter((w) => !GENERIC.has(w) && !COLOURS.has(w)))
  return demand
    .filter((d) => d.results >= 50 && d.salesPerMonth >= 0.1)
    .filter((d) => !subject.size || words(d.phrase).some((w) => subject.has(w)))
    .sort((a, b) => b.score - a.score)
}

/** A lead option Etsy's live search clearly favours over the lead: hardly listed, or far weaker. */
function strongerLead(lead: string, demand: KeywordDemand[], design: DraftDesign) {
  const own = demand.find((d) => d.phrase === normalise(lead))
  const best = selling(demand, design)[0]
  if (!own || !best || best.phrase === own.phrase) return null
  return best.score >= own.score * (own.results < 50 ? 1.5 : 2) ? { own, best } : null
}

/** What's wrong with an answer, as instructions for the second try. */
function problems(answer: Answer, input: CopyInput, plan: Plan, demand: KeywordDemand[]) {
  const issues: string[] = []
  const story = answer.description ?? ""
  const tags = (answer.tags ?? []).map((t) => ({ tag: cleanTag(t.tag), angle: t.angle }))

  const near = closest(answer.title ?? "", input.recent.map((r) => r.title))
  if (near.share > 0.7) issues.push(`The title is too close to our listing "${near.title}": use another lead phrase, other words, another order.`)
  const lead = strongerLead(answer.lead ?? "", demand, input.design)
  const unlisted = demand.find((d) => d.phrase === normalise(answer.lead ?? "") && d.results < 20)
  if (lead) {
    issues.push(
      `On Etsy's live search "${lead.best.phrase}" does far better than "${lead.own.phrase}" (${lead.best.results} against ${lead.own.results} listings; their best sellers sell about ${lead.best.salesPerMonth} against ${lead.own.salesPerMonth} a month each). Open the title with "${lead.best.phrase}" and set it as "lead".`
    )
  } else if (unlisted) {
    issues.push(
      `Hardly any listing on Etsy uses your lead "${unlisted.phrase}" (${unlisted.results}), so few buyers search it. Open the title with a broader phrase buyers type for this subject, 2 or 3 words, and set it as "lead".`
    )
  }

  const found = cliches(story)
  if (found.length) issues.push(`The story uses stock phrases buyers skip: ${found.join(", ")}. Say it plainly, in your own words.`)
  const off = OFF_STORY.filter(([pattern]) => pattern.test(story)).map(([, what]) => what)
  if (off.length) issues.push(`Leave ${off.join(", ")} out of the story.`)
  const count = wordCount(story)
  if (count < 40 || count > 170) issues.push(`The story has ${count} words; keep it to 60 to 120.`)
  if (story.trim().split(/\n\s*\n/).length < 2) issues.push("Split the story into 2 or 3 short paragraphs.")
  if ((story.match(/!/g) ?? []).length > 1) issues.push("No exclamation marks.")
  const start = opening(story)
  if (input.recent.some((r) => r.description && opening(r.description) === start)) {
    issues.push(`The story opens like one of our latest ("${start}…"): open another way.`)
  }

  const angles = new Set(tags.map((t) => t.angle))
  const missing = ["subject", "style", "room", "gift"].filter((a) => !angles.has(a))
  if (!angles.has("colour") && !angles.has("mood")) missing.push("colour or mood")
  if (missing.length) issues.push(`No tag covers the ${missing.join(", ")} angle.`)
  const crowded = tags.filter((t) => plan.crowded.has(t.tag)).map((t) => t.tag)
  if (crowded.length > 2) {
    issues.push(`${crowded.length} tags are on many of our latest listings (${crowded.join(", ")}): keep at most 2, replace the rest with other phrases that fit.`)
  }
  const uses = new Map<string, number>()
  for (const { tag } of tags) {
    for (const w of new Set(words(tag))) if (!GENERIC.has(w)) uses.set(w, (uses.get(w) ?? 0) + 1)
  }
  const repeated = [...uses].filter(([, n]) => n > 3).map(([w, n]) => `"${w}" in ${n}`)
  if (repeated.length) issues.push(`Words in too many tags (${repeated.join(", ")}): vary them, so more searches are covered.`)
  const long = tags.filter((t) => t.tag.length > TAG_MAX).map((t) => t.tag)
  if (long.length && tags.length - long.length < TAG_COUNT) issues.push(`Tags over ${TAG_MAX} characters can't be used: ${long.join(", ")}.`)
  return issues
}

function revision(answer: Answer, issues: string[], demand: KeywordDemand[]) {
  const searched = demand.length
    ? `\nETSY'S LIVE SEARCH FOR YOUR LEAD OPTIONS (listings competing · what their five best sellers sell a month, each):\n${demand.map((d) => `- "${d.phrase}": ${d.results} · ${d.salesPerMonth}`).join("\n")}\n`
    : ""
  const first = { leadOptions: answer.leadOptions, lead: answer.lead, title: answer.title, tags: answer.tags, description: answer.description }
  return `YOUR FIRST ANSWER\n${JSON.stringify(first)}\n${searched}\nWrite the whole answer again. Fix these, and keep what was good:\n${issues.map((i) => `- ${i}`).join("\n")}`
}

/**
 * Up to 13 tags: the model's in its order, then `extra` where it falls short.
 * Too long ones are left out rather than cut, crowded ones kept to two.
 */
function pickTags(candidates: string[], extra: string[], crowded: Plan["crowded"]) {
  const out: string[] = []
  let crowding = 0
  for (const raw of [...candidates, ...extra]) {
    const tag = cleanTag(raw)
    if (tag.length < 2 || tag.length > TAG_MAX || out.includes(tag)) continue
    if (crowded.has(tag) && ++crowding > 2) continue
    out.push(tag)
    if (out.length === TAG_COUNT) break
  }
  return out
}

/**
 * The story without dashes, and without a sentence still built on a stock
 * phrase or claiming handwork when enough is left; one long paragraph is
 * split in two.
 */
function tidyStory(story: string) {
  const text = withoutDashes(story.trim()).replace(/\n{3,}/g, "\n\n")
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.split(/(?<=[.!?…])\s+/).filter((s) => !cliches(s).length && !CLAIM.test(s)))
    .filter((p) => p.length)
  if (paragraphs.length === 1 && paragraphs[0].length >= 5) {
    const [sentences] = paragraphs
    paragraphs.splice(0, 1, sentences.slice(0, Math.ceil(sentences.length / 2)), sentences.slice(Math.ceil(sentences.length / 2)))
  }
  const kept = paragraphs.map((p) => p.join(" ")).join("\n\n")
  return wordCount(kept) >= 35 ? kept : text
}

/**
 * The listing copy for one poster: one Gemini call, and a second when the
 * first answer has something to fix. Then repaired to Etsy's rules.
 */
export async function writeListing(input: CopyInput): Promise<ListingCopy> {
  const plan = planFor(input)
  const planned: RecentListing = { title: "", strategy: plan.strategies[0], form: { title: plan.shape, story: plan.opening } }
  writing.add(planned)
  try {
    return await written(input, plan)
  } finally {
    writing.delete(planned)
  }
}

async function written(input: CopyInput, plan: Plan): Promise<ListingCopy> {
  const ask = (retry?: string) =>
    askJson<Answer>(prompt(input, plan, retry), input.image ? [input.image] : [], {
      schema: SCHEMA,
      temperature: retry ? 0.7 : 0.9,
    })

  let answer = await ask()
  const demand = await checkDemand([...(answer.leadOptions ?? []), answer.lead ?? ""], 5).catch(() => [])
  const issues = problems(answer, input, plan, demand)
  if (issues.length) answer = await ask(revision(answer, issues, demand)).catch(() => answer)

  const title = cleanTitle(answer.title ?? "")
  const fits = (tag: string) => !words(tag).some((w) => plan.exclude.includes(w))
  const extra = [
    ...selling(demand, input.design).map((d) => d.phrase),
    ...input.keywords.filter((k) => k.kind === "tag" && k.score >= 20).map((k) => k.keyword),
    ...input.source.tags,
  ]
  const tags = pickTags((answer.tags ?? []).map((t) => t.tag).filter(fits), extra.filter(fits), plan.crowded)
  return {
    title,
    tags,
    description: tidyStory(answer.description ?? ""),
    strategy: NAMES.includes(answer.strategy as Strategy) ? answer.strategy : "Subject-first",
    strategyWhy: (answer.strategyWhy ?? "").trim(),
    // What was really carried over, not what the model says it did.
    adoption: round(adoption(input.source, { title, tags })),
    reasoning: (answer.reasoning ?? "").trim(),
    form: { title: shapeOf(title), story: plan.opening },
    demand: demand.length ? demand : undefined,
  }
}

/** Everything the copywriter needs for a draft, gathered: then its copy, written. */
export async function draftCopy(draft: Draft, recent: RecentListing[]): Promise<ListingCopy> {
  const { source, design } = draft
  const set = await getSet(draft.generationId)
  const output = set.outputs.find((o) => o.id === draft.outputId)
  const analysis = set.posters.find((p) => p.index === output?.poster)?.analysis

  // What the poster shows, from its name and the brief's first sentence.
  const shown = [design.title, plainBrief(design.summary ?? "").split(/(?<=[.!?])\s/)[0]].filter(Boolean).join(" ")
  const query = {
    title: [source.title, design.title].filter(Boolean).join(" | "),
    tags: source.tags,
    focus: words(shown).filter((w) => !COLOURS.has(w)).join(" "),
    exclude: offSubject({ source, design, analysis }),
  }
  const [image, keywords, insights] = await Promise.all([
    output?.file ? readSetFile(set.id, output.file).catch(() => undefined) : undefined,
    keywordContext(query, 40),
    libraryInsights(),
  ])
  return writeListing({ source, design, analysis, folder: draft.folder, image, keywords, insights, recent, hint: draft.hint })
}

// --- The source listing ---

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " }

/** Etsy's description text with its HTML entities decoded. */
function plain(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (entity, name) => ENTITIES[name] ?? entity)
    .replace(/\r\n?/g, "\n")
    .trim()
}

const reading = new Map<number, Promise<{ description: string; tags: string[] }>>()

/**
 * The source listing's description and tags, read from Etsy (one call, shared
 * by drafts asking at once); description "" when Etsy no longer has it.
 */
export function sourceDetails(listingId: number) {
  let read = reading.get(listingId)
  if (!read) {
    read = etsyGet<ApiListing & { description?: string }>(`/listings/${listingId}`)
      .then((l) => ({ description: plain(l.description ?? ""), tags: l.tags ?? [] }))
      .catch((error) => {
        if (error instanceof EtsyApiError && error.status === 404) return { description: "", tags: [] }
        throw error
      })
      .finally(() => reading.delete(listingId))
    reading.set(listingId, read)
  }
  return read
}
