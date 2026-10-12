import { askJson } from "@/lib/mockups/gemini"
import { withoutDashes } from "@/lib/uploads/description"

import type { PlaceFacts } from "./composition/model"
import { countryName } from "./geo"
import { fill, type KeywordStrategy, type PlaceKeywords } from "./keywords"
import { cleanTags, cleanTitle } from "./seo"
import type { Place } from "./types"

// The city copywriter: title, 13 tags and the story that opens the
// description of a new city poster listing, by the keyword strategy (core
// patterns, the turn this listing takes, the place-free pool, never the
// avoided words), the place's own words in other shops, the title formula
// this listing's turn falls on, and the style's own keywords. Our other
// listings of the place are shown so this one covers other searches. The
// story is about the place and what this picture of it shows, never sizes,
// paper or shipping (the shop's blocks follow it), never a dash.

export type CityCopyInput = {
  /** The ranking's place: a city, a park, a region. */
  place: Place
  /** What the poster shows, in words: "Bondi Beach at sunrise, the ocean pool in front". */
  shows: string
  facts: PlaceFacts | null
  /** How it looks: "a real photo, golden hour" or the style's name and summary. */
  look: string
  /** The style's own keywords, from the strategy. */
  styleKeywords: string[]
  /** Our listings of the place, live or on their way: this one differs from them. */
  siblings: { title: string; tags: string[] }[]
  words: PlaceKeywords | null
  plan: KeywordStrategy
  /** How our latest stories opened, to open differently. */
  openings: string[]
  /** Which title formula this listing's turn falls on. */
  turn: number
}

export type CityCopy = { title: string; tags: string[]; description: string; reasoning: string; strategy: string }

const SCHEMA = {
  type: "OBJECT",
  properties: {
    plan: { type: "STRING" },
    title: { type: "STRING" },
    tags: { type: "ARRAY", items: { type: "STRING" } },
    description: { type: "STRING" },
  },
  required: ["plan", "title", "tags", "description"],
  propertyOrdering: ["plan", "title", "tags", "description"],
}

/** What machine-written copy gives itself away with. */
const CLICHE = /\b(captur(e|es|ing) the (essence|spirit|charm|magic)|timeless|breathtaking|stunning|nestled|vibrant tapestry|bustling|iconic beauty|transport(s)? you|a must have|perfect addition|elevate your|whether you|look no further|wanderlust)\b/gi

function prompt(input: CityCopyInput) {
  const { place, plan } = input
  const names = { city: place.name, region: place.region, country: countryName(place.country) }
  const formula = plan.titles.length ? plan.titles[input.turn % plan.titles.length] : "{city} Travel Poster, {landmark} Print, {country} Wall Art"
  const rotate = plan.rotate.length ? plan.rotate.filter((_, i) => (i + input.turn) % 3 === 0) : []
  return [
    "You write the Etsy listing for a new travel poster: an unframed print of a real place. The shop sells many places in several styles and wants to rank broadly, each listing covering its own searches.",
    "",
    `The place: ${place.name} (${place.kind}${place.region ? `, ${place.region}` : ""}, ${names.country}).`,
    `The poster shows: ${input.shows}.`,
    `How it looks: ${input.look}.`,
    input.facts?.landmark ? `Best known sight: ${input.facts.landmark}.` : "",
    input.facts?.description ? `About the place: ${input.facts.description}` : "",
    "",
    "Keywords ({city} the city or place, {landmark} a sight or district the poster shows, {region} the state or region buyers search, {country}, {demonym} its adjective, {style} a word for the look):",
    `- Strongest patterns, carry at least three: ${plan.core.join(", ") || "{city} poster, {city} print, {city} wall art, {city} art"}`,
    `- This listing's turn of the rotating patterns: ${rotate.join(", ") || plan.rotate.slice(0, 6).join(", ") || "{country} poster, {landmark} print"}`,
    `- Place-free keywords to vary from: ${plan.generic.join(", ") || "travel poster, wall art, travel gift, housewarming gift"}`,
    input.styleKeywords.length ? `- The style's own words: ${input.styleKeywords.join(", ")}` : "",
    `- Never: ${plan.avoid.join(", ") || "framed, original painting, digital download"}`,
    input.words?.tags.length ? `- What other shops' listings for ${input.words.name} use as tags, strongest first: ${input.words.tags.slice(0, 25).map((t) => t.keyword).join(", ")}` : "",
    input.words?.titles.length ? `- Their best selling titles:\n${input.words.titles.slice(0, 5).map((t) => `  ${t.title}`).join("\n")}` : "",
    "",
    input.siblings.length ? "Our other listings of this place (this one must differ: another title formula, at least 6 other tags):" : "",
    ...input.siblings.slice(0, 10).map((s) => `- ${s.title} | ${s.tags.join(", ")}`),
    "",
    "Write:",
    `- "plan": one sentence: the searches this listing goes for.`,
    `- "title": at most 140 characters, Title Case, parts apart by commas, never a dash or hyphen. Build it on this formula, filled in naturally: ${fill(formula, { ...names, landmark: "{landmark}" }) ?? formula}. Lead with the place and what it is ("${place.name} Travel Poster"); only when the picture is about one famous sight above all (Golden Gate Bridge, Eiffel Tower, Bondi Beach) may that sight lead. No word more than twice, no ALL CAPS.`,
    `- "tags": exactly 13, lower case, each at most 20 characters including spaces, no hyphens, no two alike, phrases buyers search.`,
    `- "description": the story only: 2 or 3 short paragraphs, 60 to 110 words in all, plain and warm English, about ${place.name} and what this picture of it shows, the way a friend who knows the place would put it. No sizes, paper, frames, shipping, printing or gifting lists (the shop adds those below), no exclamation marks, no dashes, no stock phrases (capturing the essence, timeless, breathtaking, nestled, bustling, wanderlust).`,
    input.openings.length ? `Our latest stories opened with: ${input.openings.map((o) => `"${o}…"`).join(", ")}. Open differently.` : "",
  ]
    .filter((l) => l !== "")
    .join("\n")
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length

/** Writes the copy; a story that breaks the rules is asked for again once, with what was wrong. */
export async function writeCityCopy(input: CityCopyInput): Promise<CityCopy> {
  const base = prompt(input)
  let issues: string[] = []
  let best: CityCopy | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = issues.length ? `${base}\n\nThe last try had these problems, fix them:\n${issues.map((i) => `- ${i}`).join("\n")}` : base
    const answer = await askJson<{ plan?: string; title?: string; tags?: string[]; description?: string }>(text, [], { schema: SCHEMA, temperature: 0.8 })
    const place = input.place
    const fallback = [...input.plan.core, ...input.plan.rotate]
      .map((p) => fill(p, { city: place.name.toLowerCase(), region: place.region?.toLowerCase(), country: countryName(place.country).toLowerCase() }))
      .filter((x): x is string => !!x)
    const story = withoutDashes(answer.description ?? "").trim()
    const copy: CityCopy = {
      title: cleanTitle(answer.title ?? `${place.name} Travel Poster`),
      tags: cleanTags(answer.tags ?? [], [...fallback, ...input.plan.generic]),
      description: story,
      reasoning: (answer.plan ?? "").trim().slice(0, 300),
      strategy: "City keyword strategy",
    }
    best = copy
    issues = []
    const count = words(story)
    if (count < 40 || count > 160) issues.push(`The story has ${count} words: keep it to 60 to 110.`)
    if (story.split(/\n\s*\n/).length < 2) issues.push("Split the story into 2 or 3 short paragraphs.")
    const cliches = [...new Set((story.match(CLICHE) ?? []).map((c) => c.toLowerCase()))]
    if (cliches.length) issues.push(`It uses stock phrases: ${cliches.join(", ")}. Say it plainly.`)
    if (/!/.test(story)) issues.push("No exclamation marks.")
    if (input.plan.avoid.some((a) => copy.tags.includes(a) || copy.title.toLowerCase().includes(a))) issues.push(`Leave out: ${input.plan.avoid.join(", ")}.`)
    if (!issues.length) break
  }
  return best!
}
