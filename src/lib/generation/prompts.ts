import { askJson } from "@/lib/mockups/gemini"
import type { StyleGuide } from "@/lib/styles/types"

import type { Creativity, OutputMode, PosterAnalysis } from "./types"

// Two steps per batch. Gemini Flash, as art director, first looks at the
// reference and writes one distinct brief per image (so twenty variants are
// twenty different takes, not one prompt rolled twenty times); Nano Banana
// then paints each brief from the reference (and the style's moodboard).

// Ideas, themes and styles are free to use; drawings, characters and words
// are someone's work. Every prompt carries these rules.
const RULES = `Rules:
- Original work: draw every element new. Never trace or reproduce the reference's exact composition, characters, mascots, linework or wording, and never include logos, brands, trademarks, signatures, watermarks, artist names or copyrighted characters.
- Any text must be new wording, spelled correctly, cleanly lettered and legible at print size; leave text out unless the brief asks for it.
- Output only the flat artwork, front-on, filling the canvas edge to edge: no frame, mat, wall, room, mockup, hands, drop shadow or border that isn't part of the art.
- Print quality: sharp, rich in detail where it matters, clean edges, no artefacts, no muddy colours, coherent anatomy and perspective. It must look like a best-selling poster a buyer would hang at home.`

// Variants keep the reference's art style, palette and rendering at every
// level; only composition and layout move, further at each step.
const VARIANT_LEVELS: Record<Creativity, string> = {
  minimal: "minimal — very close to the reference: the same subject, elements, layout and framing, freshly redrawn, but never a copy — make two or three subtle yet visible changes (a pose or expression, the shape or position of a small element, a slightly shifted crop, a swapped minor detail), so it reads as the same poster's sibling, not its duplicate.",
  subtle: "subtle — close to the reference: the same subject, elements and overall layout, with a few small changes to the arrangement (order, count or spacing of elements, a slightly different crop or angle) and one or two new details; side by side it is clearly a different print of the same poster.",
  low: "low — still close to the reference: the same subject, elements and kind of layout, gently recomposed — one noticeable change to the arrangement, balance or framing (e.g. the main subject moved or turned, elements regrouped, a tighter or wider crop) while everything else stays near the original.",
  medium: "medium — the same subject in a new composition and layout: a different viewpoint, scale, framing or grouping, with new supporting elements that fit the theme.",
  high: "high — the most inventive composition and layout: a bold, surprising arrangement or framing that reinterprets the subject playfully, while the art style and palette stay exactly the reference's.",
}

const STYLED_LEVELS: Record<Creativity, string> = {
  minimal: "minimal — the same picture (subject, composition, story) re-rendered in the style as faithfully as possible; change nothing else.",
  subtle: "subtle — the same picture in the style, with only small changes to the arrangement and details.",
  low: "low — the same picture (subject, composition, story) faithfully re-rendered in the style: apply the style's medium, palette, lighting and finish exactly.",
  medium: "medium — the same subject and story in the style, with a composition the style would naturally choose; interpret the style with some freedom.",
  high: "high — the reference's theme only, reimagined as a piece the style's artist would make from it; a bold, personal interpretation of the style.",
}

const IDEA_LEVELS: Record<Creativity, string> = {
  minimal: "minimal — change one small thing about the scene (a prop, a detail or the wording) and keep everything else as it is.",
  subtle: "subtle — change one thing about the scene (a character, a prop or the place) in a small way and keep everything else close.",
  low: "low — change one thing about the scene (a different character, OR a different place, OR a different prop/activity) and keep everything else close.",
  medium: "medium — change two or three things (e.g. new character in a new place) and compose a new scene; same joke or feeling.",
  high: "high — a bold new scenario on the same hook: anything can change except the art style and the reason people buy it.",
}

export type BriefRequest = {
  mode: OutputMode
  levels: Creativity[]
  analysis?: PosterAnalysis
  title: string
  style?: StyleGuide | null
  feedback?: string
  /** Briefs already made for this poster: new ones must differ from them. */
  avoid: string[]
  /** One of our outputs these develop further (its image is the second one). */
  base?: Brief
  /** Our approved outputs these ideas take after (their images follow the reference). */
  inspiration?: Brief[]
}

export type Brief = { title: string; brief: string }

const BRIEFS_SCHEMA = {
  type: "OBJECT",
  properties: {
    briefs: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { title: { type: "STRING" }, brief: { type: "STRING" } },
        required: ["title", "brief"],
      },
    },
  },
  required: ["briefs"],
}

/** Plans larger batches in chunks, so each answer stays short and careful. */
const CHUNK = 12

/** One brief per level in `request.levels`, in that order; `extra` are the images `request.base` or `request.inspiration` name. */
export async function planBriefs(reference: Buffer, request: BriefRequest, extra: Buffer[] = []): Promise<Brief[]> {
  const briefs: Brief[] = []
  for (let at = 0; at < request.levels.length; at += CHUNK) {
    const levels = request.levels.slice(at, at + CHUNK)
    const avoid = [...request.avoid, ...briefs.map((b) => `${b.title}: ${b.brief}`)]
    const answer = await askJson<{ briefs: Brief[] }>(
      briefPrompt({ ...request, levels, avoid }),
      [reference, ...extra],
      { schema: BRIEFS_SCHEMA, temperature: 1 }
    )
    const got = answer.briefs ?? []
    // A short answer is padded with plain briefs rather than failing the batch.
    for (let i = 0; i < levels.length; i++) {
      briefs.push(got[i]?.brief ? got[i] : { title: "Variation", brief: fallback(request, levels[i]) })
    }
  }
  return briefs
}

function briefPrompt({ mode, levels, analysis, title, style, feedback, avoid, base, inspiration }: BriefRequest) {
  const levelText = mode === "idea" ? IDEA_LEVELS : style ? STYLED_LEVELS : VARIANT_LEVELS
  const lines = levels.map((level, i) => `${i + 1}. creativity ${levelText[level]}`)
  return [
    `You are the art director of a successful Etsy wall-art shop. The image is a best-selling poster from another shop (listing: "${title}"). We make new, original posters inspired by what makes it sell.`,
    analysis && `What the reference is:\n${describe(analysis)}`,
    mode === "idea"
      ? `Task: write ${levels.length} NEW IDEAS. Each keeps the reference's art style, palette, rendering and — most important — its selling hook (${analysis?.hook ?? "the reason people buy it"}), but tells a new picture: a different character, place, prop or activity, as the creativity level allows. Think like a buyer: each idea must be instantly charming, funny or beautiful, and work as a standalone best seller. Vary them widely — different animals/characters, places (pool, beach, luxury car, bathtub, rooftop, diner…), props and activities; never repeat a combination.`
      : style
        ? `Task: write ${levels.length} briefs that redraw the reference's picture in the style below, each at its creativity level. Describe concretely how the style's medium, palette, lighting and texture apply to this picture.`
        : `Task: write ${levels.length} briefs for new posters that redraw the reference at the given creativity levels. Every brief keeps the reference's art style, medium, rendering, texture, palette and lighting exactly — only the composition and layout change, as far as its level allows. Each must differ from every other brief.`,
    base &&
      `Start from our own earlier poster, the second image ("${base.title}": ${base.brief}). The shop owner liked enough of it to want more: each brief develops it further — keep what works, change what the notes ask for, and at higher creativity move further away from it.`,
    inspiration?.length &&
      `Images 2–${inspiration.length + 1} are our own posters from this reference that the shop owner approved:\n${inspiration.map((b, i) => `${i + 2}. ${b.title}: ${b.brief}`).join("\n")}\nWork out what they have in common — the kind of characters, places, activities, humour and finish the owner picks — and write new ideas in that spirit. Each must be a new picture of its own, never a copy or small edit of one of them.`,
    style && `Style to use:\n${styleText(style)}`,
    feedback && `The shop owner asked for this — follow it in every brief: ${feedback}`,
    `Creativity per brief, in order:\n${lines.join("\n")}`,
    avoid.length > 0 && `Already made — make each new brief clearly different from these:\n${avoid.slice(-30).map((a) => `- ${a}`).join("\n")}`,
    `Each brief: 3–6 sentences an illustrator can paint from — subject and what it does, setting, composition and framing, palette (name colours), rendering and texture, lighting, any lettering (new words only, or none). Be specific and visual; no vague adjectives. Each "title" is 2–5 words naming the picture.`,
    `Never name the original artist, shop, brands or copyrighted characters.`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

function fallback(request: BriefRequest, level: Creativity) {
  const text = request.mode === "idea" ? IDEA_LEVELS : request.style ? STYLED_LEVELS : VARIANT_LEVELS
  return `New poster after the reference, creativity ${text[level]}`
}

function describe(a: PosterAnalysis) {
  return [
    `Shows: ${a.summary}`,
    `Style: ${a.style}`,
    `Palette: ${a.palette.join(", ")}`,
    `Composition: ${a.composition}`,
    a.typography && `Text: ${a.typography}`,
    `Mood: ${a.mood}`,
    `Buyers: ${a.audience}`,
    `Why it sells: ${a.hook}`,
  ]
    .filter(Boolean)
    .join("\n")
}

function styleText(s: StyleGuide) {
  return [
    s.prompt,
    `Medium: ${s.medium}. Technique: ${s.technique}.`,
    `Palette: ${s.palette.map((p) => `${p.hex} (${p.role})`).join(", ")}.`,
    `Lighting: ${s.lighting}. Composition: ${s.composition}. Detail: ${s.detail}.`,
    s.typography && `Lettering: ${s.typography}.`,
    `Mood: ${s.mood}.`,
    s.do.length > 0 && `Do: ${s.do.join("; ")}.`,
    s.dont.length > 0 && `Don't: ${s.dont.join("; ")}.`,
  ]
    .filter(Boolean)
    .join("\n")
}

/** What Nano Banana is told for one output; images go in the order the text names them. */
export function paintPrompt({
  mode,
  brief,
  style,
  moodboard,
  feedback,
  previous,
  inspiration = 0,
}: {
  mode: OutputMode
  brief: string
  style?: StyleGuide | null
  /** How many moodboard images follow the reference. */
  moodboard: number
  feedback?: string
  /** A previous attempt is the last image. */
  previous: boolean
  /** How many approved posters of ours follow the reference (and moodboard), as inspiration. */
  inspiration?: number
}) {
  const images = [
    "Image 1 is a best-selling poster from another shop — the reference.",
    moodboard > 0 && `Images 2–${moodboard + 1} are a moodboard: they define the visual style to paint in (medium, palette, texture, lighting). Take only their style, never their subjects.`,
    inspiration > 0 &&
      `The next ${inspiration === 1 ? "image is one" : `${inspiration} images are`} of our own approved posters: match their art style, finish and quality bar, but paint the new idea below — never copy their scenes.`,
    previous && `The last image is our previous attempt: keep what works in it and change what the notes ask for.`,
  ].filter(Boolean)
  return [
    ...images,
    mode === "idea"
      ? "Paint a NEW, ORIGINAL poster on the reference's concept: keep its art style, rendering, palette and selling hook, but show the new idea below — not the reference's scene."
      : style
        ? "Paint a NEW, ORIGINAL poster after the reference, as the art direction below says."
        : "Paint a NEW, ORIGINAL poster after the reference, as the art direction below says. Match the reference's art style, medium, rendering, texture, palette and lighting exactly; change only the composition and layout.",
    `Art direction: ${brief}`,
    style && `Style: ${styleText(style)}`,
    feedback && `Notes from the shop owner (most important): ${feedback}`,
    RULES,
  ]
    .filter(Boolean)
    .join("\n\n")
}
