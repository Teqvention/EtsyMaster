import { askJson } from "@/lib/mockups/gemini"
import type { StyleGuide } from "@/lib/styles/types"

import type { Creativity, OutputMode, PosterAnalysis } from "./types"

// Two steps per batch. Gemini Flash, as art director, first looks at the
// reference and writes one distinct brief per image (so twenty variants are
// twenty different takes, not one prompt rolled twenty times); Nano Banana
// then paints each brief from the reference (and the style's moodboard).

// Ideas, themes and styles are free to use; drawings, characters and words
// are someone's work. Every prompt carries these rules.
// What the canvas is gets said, not what it isn't: a list of what to leave
// out ("no frame, mat, wall…") named the very things Nano Banana then
// painted around the poster (Robin, 14 Oct).
const RULES = `Rules:
- Original work: draw every element new. Never trace or reproduce the reference's exact composition, characters, mascots, linework or wording, and never include logos, brands, trademarks, signatures, watermarks, artist names or copyrighted characters.
- Any text must be new wording, spelled correctly, cleanly lettered and legible at print size; leave text out unless the brief asks for it.
- The canvas is the print file itself: the artwork alone, flat and front-on, its own ground running to all four edges.
- Print quality: crisp at print size, no artefacts, coherent anatomy and perspective, and exactly as simple or as detailed as the reference. It must look like a best-selling poster a buyer would hang at home.`

// Variants keep the reference's art style, palette and rendering at every
// level; only composition and layout move, further at each step.
// The shower poster's variants lost its vibe (Robin, 14 Oct): a blocky square
// head for the small dome ("the shape of a small object" read as the main
// one), a dense spray for its few big drops, bigger text moved to the other
// side. The cups and the striped heart kept it: the same marks at the same
// size, the arrangement changed. So the low levels change details and
// arrangement, never the main subject's shape, the marks or the text's place.
const VARIANT_LEVELS: Record<Creativity, string> = {
  minimal: "minimal — the reference's sibling: the same subject, elements, layout and framing, the main subject in its shape and size, the text where it is — freshly redrawn, never a copy: two or three small but visible changes to details (a pattern, a small object added, moved or swapped, a background detail), so it reads as the same series' sibling print, not its duplicate. Characters keep their exact expression, gaze, pose and energy.",
  subtle: "subtle — close to the reference: the same subject and overall layout, the text where it is, with a few small changes to the arrangement (order, count or spacing of elements) and one or two new details; side by side it is clearly a different print of the same series.",
  low: "low — the same subject and kind of layout, gently recomposed: one noticeable change to the arrangement or framing (the main subject moved, turned or doubled, elements regrouped, a tighter or wider view) with the reference's balance, scale and empty space.",
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

// Every idea is a new print of the series, never the reference with one
// motif swapped: a Wild West doodle sheet with a llama for its horse is
// the competitor's poster again (Robin, 14 Oct: "ganz neue Kontexte und
// Objekte"). One new subject is a new poster when the reference shows one
// (the shower became a bathtub, a coffee mug); a sheet of many small motifs
// needs a new theme for all of them.
const IDEA_LEVELS: Record<Creativity, string> = {
  minimal: "minimal — the closest new print of the series: the reference's composition and look with new wording or a new main subject in place of its own (one shower → a bathtub); a poster made of many small motifs gets a new theme for all of them. The characters' expressions stay.",
  subtle: "subtle — a new subject or object on the reference's concept, in its kind of composition (a shower → a steaming coffee mug, \"this coffee is for surviving\"); a poster of many small motifs: a new theme, its motifs arranged the reference's way.",
  low: "low — a new context for the concept: another room, activity or theme with all-new objects, composed the reference's way (the same scale, empty space and text placement).",
  medium: "medium — a new scene on the hook: a new subject in a new place or situation, composed anew — new viewpoint or framing welcome; the same joke and the same feeling.",
  high: "high — a bold new scenario on the same hook: a surprising idea, scene, perspective or composition. The look and the feeling stay exactly the reference's — the creativity goes into the idea, never into a new style or mood.",
}

// Every level keeps how the reference feels and how it's painted: a new idea
// that drifts into a quieter, moodier or more detailed picture reads as
// another artist (Robin, 13 Oct: a lion in a dark library after a tiger in
// a sunny bar; a blissful cat turned grumpy at the lowest level).
const KEEP_FEELING = (analysis?: PosterAnalysis) =>
  `Keep the reference's feeling in every brief${analysis?.mood ? ` (${analysis.mood})` : ""}: the characters' expressions, body language and energy, the warmth of the light, the humour, and its dreaminess where it has any. Never a quieter, sadder, darker, moodier, more dramatic, more realistic or more serious picture. At minimal and subtle keep the reference's expressions and gazes; from low upwards play with them like an artist — sweet, sleepy, dreamy, eyes closed in bliss, smug and half-lidded, looking away — never the default of a character staring straight and seriously out of the picture. Keep its simplicity too: about as many elements as the reference, anything new simplified the way the reference simplifies (a library is a few shelves of colour blocks, not a hundred books). Keep its grammar, which is most of its vibe: its elements about as large on the canvas, as much empty space, its marks (drops, dots, stripes, strokes) the same size and kind, its lettering as large and in the same hand — below medium creativity where the reference has it. An outline drawing stays an outline drawing, flat colour stays flat colour, and a poster without lettering gets none. Describe things plainly — never words that ask for more detail or finish than the reference has (cluttered, intricate, detailed, ornate, glossy, realistic).`

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
    const ask = () =>
      askJson<{ briefs: Brief[] }>(briefPrompt({ ...request, levels, avoid }), [reference, ...extra], {
        schema: BRIEFS_SCHEMA,
        temperature: 1,
      })
    let answer = await ask()
    // Once in a while Gemini answers letter by letter ("T H I S  T O I L E T…", 14 Oct): asked again.
    if (answer.briefs?.some((b) => spaced(b.brief))) answer = await ask()
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
      ? `Task: write ${levels.length} NEW IDEAS. Each keeps the reference's art style, palette, rendering and — most important — its selling hook (${analysis?.hook ?? "the reason people buy it"}), but tells a new picture: new subjects, objects and contexts, as the creativity level allows — the next poster the same artist would make for the series, never the reference with one motif swapped. Think like a buyer: each idea must be instantly charming, funny or beautiful, and work as a standalone best seller. Vary them widely — different subjects, rooms, activities and themes; never repeat a combination.`
      : style
        ? `Task: write ${levels.length} briefs that redraw the reference's picture in the style below, each at its creativity level. Describe concretely how the style's medium, palette, lighting and texture apply to this picture.`
        : `Task: write ${levels.length} briefs for new posters that redraw the reference at the given creativity levels. Every brief keeps the reference's art style, medium, rendering, texture, palette and lighting exactly — only the composition and layout change, as far as its level allows. Each must differ from every other brief.`,
    !style && KEEP_FEELING(analysis),
    base &&
      `Start from our own earlier poster, the second image ("${base.title}": ${base.brief}). The shop owner liked enough of it to want more: each brief develops it further — keep what works, change what the notes ask for, and at higher creativity move further away from it.`,
    // "More like this" with notes ("without the right paw, everything else the same") turned a cake into a donut too (13 Oct).
    base &&
      feedback &&
      `The notes are the change. At minimal and subtle creativity, change exactly what they ask and keep everything else of the earlier poster as it is — the same subject, pose, props, food, colours and composition; no other new details. At higher creativity, apply them first, then move as far as the level allows.`,
    inspiration?.length &&
      `Images 2–${inspiration.length + 1} are our own posters from this reference that the shop owner approved:\n${inspiration.map((b, i) => `${i + 2}. ${b.title}: ${b.brief}`).join("\n")}\nWork out what they have in common — the kind of characters, places, activities, humour and finish the owner picks — and write new ideas in that spirit. Each must be a new picture of its own, never a copy or small edit of one of them.`,
    style && `Style to use:\n${styleText(style)}`,
    feedback && `The shop owner asked for this — follow it in every brief: ${feedback}`,
    `Creativity per brief, in order:\n${lines.join("\n")}`,
    avoid.length > 0 && `Already made — make each new brief clearly different from these:\n${avoid.slice(-30).map((a) => `- ${a}`).join("\n")}`,
    style
      ? `Each brief: 3–6 sentences an illustrator can paint from — subject and what it does, setting, composition and framing, palette (name colours), rendering and texture, lighting, any lettering (new words only, or none). Be specific and visual; no vague adjectives. Each "title" is 2–5 words naming the picture.`
      : `Each brief: 3–6 sentences an illustrator can paint from — the subject and what it does, its expression and body language, the setting and props, the composition and framing, any lettering (new words only, or none). Be specific and visual; no vague adjectives. Don't describe the palette, light, texture or rendering: the painter takes them from the reference, and spelling them out makes it exaggerate them — say "in the reference's exact look" and name colours only for new objects, from the reference's palette. Each "title" is 2–5 words naming the picture.`,
    `Never name the original artist, shop, brands or copyrighted characters.`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

/** Text written letter by letter, the words lost between the spaces. */
function spaced(text = "") {
  const words = text.split(/\s+/)
  return words.filter((w) => /^\p{L}$/u.test(w)).length > words.length / 2
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

/**
 * A brief without the words that make Nano Banana paint a crisp, realistic
 * subject into a painting ("a realistic jaguar", "highly detailed fur"): the
 * look comes from the reference, never from these.
 */
export function plainBrief(brief: string) {
  return brief
    .replace(/,?\s*(painted |rendered )?in (a |an )?(hyper-?|photo-?|ultra-?)?realistic (style|way|manner)/gi, "")
    .replace(/\b(hyper-?|photo-?|ultra-?)?realistic(ally)?\s+/gi, "")
    .replace(/\b(highly|finely|intricately|hyper-?)\s+detailed\s+/gi, "")
}

/** How the reference's look and feeling carry over when no saved style replaces them. */
const SAME_HAND = `Paint it by the reference's own hand:
- The same paint handling: strokes as big, loose and thick — or as flat and clean — as the reference's, relative to the canvas; the same edges, outlines and surface texture. No heavier impasto, no smoother finish.
- No refining: no finer lines, no extra detail, nothing glossier, sharper or more realistic than the reference. Paint anything new as simply as the reference paints its own things.
- Animals and figures as the reference paints them: fur as broad strokes or patches of colour, faces simplified the same way — never a finely furred, realistic or cleanly illustrated animal.
- The subject sits in the paint the way the reference's does: if it melts into soft, hazy colour or is half hidden, keep it so — never a crisp, sharply drawn subject in front of a painterly background. Keep the reference's dreaminess and brightness.
- Expressions and gazes as the art direction says them; never a stiff, serious stare out of the picture unless it asks for one.
- No more objects than the art direction names: a new setting stays as sparse and as softly painted as the reference's.
- The same palette, saturation, contrast and kind of light: nothing darker, more muted or moodier.
- The same feeling: the characters' expressions, body language and energy, the warmth and the humour of the reference.
- Drawn at the reference's scale: lines as thick, marks (drops, dots, stripes) the same size, shape and spacing, lettering the same size, weight and hand, as much empty space — unless the art direction asks for a closer or wider view.
- The reference's own surface: its paper or canvas as the print shows it, colour as even or as uneven as the reference's, edges as crisp or as soft as its own.`

/** What Nano Banana is told for one output; images go in the order the text names them. */
export function paintPrompt({
  mode,
  brief,
  style,
  moodboard,
  feedback,
  previous,
  inspiration = 0,
  ground,
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
  /** The reference's ground in words (poster.ts `groundOf`), kept unless a style replaces the look. */
  ground?: string | null
}) {
  const images = [
    "Image 1 is a photo of a best-selling printed poster from another shop — the reference. Paint from the print itself: its artwork as it was printed, evenly lit.",
    moodboard > 0 && `Images 2–${moodboard + 1} are a moodboard: they define the visual style to paint in (medium, palette, texture, lighting). Take only their style, never their subjects.`,
    inspiration > 0 &&
      `The next ${inspiration === 1 ? "image is one" : `${inspiration} images are`} of our own approved posters: match their art style, finish and quality bar, but paint the new idea below — never copy their scenes.`,
    previous &&
      (feedback
        ? `The last image is our previous attempt: change exactly what the notes ask for and keep everything else in it as it is, unless the art direction says otherwise.`
        : `The last image is our previous attempt: keep what works in it and change what the notes ask for.`),
  ].filter(Boolean)
  return [
    ...images,
    mode === "idea"
      ? "Paint a NEW, ORIGINAL poster on the reference's concept: keep its art style, rendering, palette and selling hook, but show the new idea below — not the reference's scene. It must look like the next poster of the same series, by the same artist."
      : style
        ? "Paint a NEW, ORIGINAL poster after the reference, as the art direction below says."
        : "Paint a NEW, ORIGINAL poster after the reference, as the art direction below says. Match the reference's art style, medium, rendering, texture, palette and lighting exactly; change only the composition and layout.",
    `Art direction: ${plainBrief(brief)}`,
    style ? `Style: ${styleText(style)}` : SAME_HAND,
    !style && ground && `The ground is the reference's ${ground}, the same colour as in the print.`,
    feedback && `Notes from the shop owner (most important): ${feedback}`,
    RULES,
  ]
    .filter(Boolean)
    .join("\n\n")
}
