import { askJson } from "@/lib/mockups/gemini"
import type { StyleGuide } from "@/lib/styles/types"

import { SKIES, SKY_RULES, skyById, skyText, type SkyId } from "./skies"
import type { CityGuide, CityOutputInfo, Follow, Level, PlaceBrief, ReferenceRead, RefMode } from "./studio-types"

// How city posters are asked for. Every image has to be one we'd sell: a
// beautiful, bright, inviting poster of a place, true to the place.
//
// An image is made as one of two things, kept strictly apart:
//
// A real photo stays the real place: every building, landmark, coastline
// and street where it is. What may change, more at each level, is the
// moment (traffic, people, the sky, the light) and from level 4 where the
// camera stands. The sky always follows the shop's taste (skies.ts).
//
// Art keeps its look exactly: a sketch after a sketch reference, a poster
// in a city style. What may change, more at each level, is what's drawn
// and how it's composed; never the medium, the line, the palette.
//
// By default an image takes the reference's medium: a photo makes photos,
// a sketch makes sketches. The Real photo switch makes photos of anything.
// A city style decides on its own: a photo style (a grading, a film look)
// makes real photos in exactly that look, an art style its art.
//
// Two steps for every batch: Gemini Flash, as art director, studies the
// reference and writes one brief per image (which view, what changes, the
// sky); Nano Banana paints each brief.

// --- Levels ---

export const REAL_LEVELS: Record<Level, string> = {
  1: "Level 1, faithful: the same photograph taken again from the exact same spot a few minutes later. Same viewpoint, framing, lens, light direction and colour mood; every building, street and landmark exactly as it is. Only small, natural differences that make it a new shot: traffic and people fewer and in other places (a few cars rather than many), palm fronds and trees moved a little by the wind, boats moored slightly elsewhere, clouds rearranged. The sky may become a touch cleaner and prettier. Side by side it is clearly the same photo, taken again. Fit the poster's shape by extending or trimming the edges (a little more sky or foreground), never by squeezing.",
  2: "Level 2, refined: the same viewpoint and composition, made beautiful: the sky asked for (or the loveliest one for this picture), clean, gentle light that flatters the place, colours rich but natural, verticals straight, horizon level, distracting clutter (cranes, bins, parked vans, litter) quietly gone. Small natural differences as at level 1 (fewer cars, other people, trees in the wind).",
  3: "Level 3, new light: the same place and landmarks from nearly the same spot (the camera may move a few steps or a little higher), at another flattering moment: a subtle golden hour, a blush-pink dusk, a fresh sunny morning, a turquoise summer day. Light and bright, never night, never dark. The scene's geometry and every landmark stay exactly as they are.",
  4: "Level 4, new angle: the same place and its landmarks from another real viewpoint someone could stand at nearby (a few steps along the shore, a terrace higher up, a longer or wider lens), composed as a great poster: a clear main subject, a beautiful foreground (palms, a balustrade, flowers, a beach) leading to it, generous sky. Keep what makes the reference beautiful and sell (a tree-lined avenue stays a tree-lined avenue, palms in front of the bay stay): the same kind of picture, better composed, never a different street or a generic view. Everything in view is where it really is.",
  5: "Level 5, signature: the most beautiful poster photograph of this place a top travel photographer could take: a freer, well-designed composition (a new vantage point, the main subject placed with intent), paradise-clear water where there is water, a dreamy pastel or gentle golden sky. It keeps the spirit of the reference (its main subject and what makes it lovely). Creative but calm and elegant: never loud, never dramatic, never dark. The place's geography and landmarks stay true.",
}

/** Levels when the reference is art and the image stays art: the look never moves, the picture does. */
export const ART_LEVELS: Record<Level, string> = {
  1: "Level 1, the same picture drawn again: identical view, composition and art style, every landmark where it is. Change only small details so it's a new drawing, not a copy: other figures and cars in other places, a sign or an awning moved, a tree or a cloud different. Fit the poster's shape by extending or trimming the edges.",
  2: "Level 2, small changes: the same view and composition in exactly the same art style, with a few more changes: other figures and details, a slightly different crop, the sky as asked.",
  3: "Level 3, a new moment: the same place and main view in exactly the same art style and palette, noticeably re-arranged: another crop or a small turn of the view, different people, cars and details, another flattering light (a soft morning, a gentle golden hour, a blush-pink sky), still as light and bright as the reference: never night, never a darkening twilight or a deep blue sky.",
  4: "Level 4, a nearby view: the same place and its landmarks in exactly the same art style, seen from another real vantage point close by: a new composition with the same character and charm (a street scene stays a street scene, a terrace over the bay stays one).",
  5: "Level 5, a free take: the composition a top illustrator would choose for a best-selling poster of this place, built from its real landmarks, in exactly the same art style.",
}

// --- Rules ---

/** What every real photo must be. */
const REAL_RULES = `Rules for a real photo:
- It is the real place. Every building, bridge, tower, church, coastline, hill and street in view stays where it is, with its real shape, height and proportions. Never invent, move or merge landmarks; never change the skyline; never add landmarks of other places.
- It looks like a real photograph by a professional: true perspective, real lens behaviour, fine detail in brickwork, windows, leaves and water, natural colour. No AI look: no oversaturation, no plastic or waxy surfaces, no HDR halos, no over-sharpening, no warped buildings, no impossible reflections.
- ${SKY_RULES}
- No text, logos, watermarks, borders or frames. Real signs stay as they are but never readable brand names or logos; never new lettering.
- People and cars small and incidental, fewer rather than more, never posed, no faces in focus.
- Only the photograph, edge to edge, filling the canvas.`

/** What every picture in an art style must be, after a reference or a style. */
const ART_RULES = `Rules for an illustrated poster:
- Keep the art style exactly: medium, line weight and character, hatching, how colour is laid in (washes, crayon, flat fills, paper showing through), palette and how saturated it is, texture, level of detail, how people, cars and trees are drawn. It must be impossible to tell the new picture from the style's own pictures except by what it shows: the same hand, the same pens, the same paper.
- Never cleaner, finer, more detailed or more polished than the style's own pictures. A loose, wobbly, naive hand stays loose, wobbly and naive; thick uneven lines stay thick and uneven; crayon texture stays crayon; few details stay few. Image models tidy everything up: don't.
- Match the line weight at the poster's scale: as thick, as dark and as few lines as in the style's own pictures; a busy scene is simplified to their level of detail, never drawn with finer pens.
- Draw everything new: never trace or copy a source drawing.
- The place is right and recognisable: its real landmarks in their true shape and relation, simplified the way the style simplifies, never replaced by generic buildings.
- A poster people want on their wall: a clear focal point, a balanced composition, nothing awkwardly cut off. Skies and light stay bright and inviting, as light as the style's own pictures: never night, a darkening twilight, a deep blue or a gloomy sky.
- No poster title, caption or place-name band. In-scene signs (street signs, shop signs, an awning) only where the style's own pictures draw them: few, short, correctly spelled, true to the place, and generic: street and place names, CAFE, HOTEL, MUSEUM. Never a brand, logo, company, show, film or other trademark (no fast-food signs, no theatre or film titles, no shop chains).
- Never paint what sat in front of or around a poster in its photo (books, vases, frames, walls, hands, room): only the artwork, front-on, edge to edge. No logos, watermarks or signatures.`

/** A photo style: real photos in exactly the style's look. */
const PHOTO_STYLE_RULES = `The style is a photographic look (its colour grading, film character, light and mood), not an illustration. The result is a REAL photograph of the place, never a drawing, painting or 3D render, whatever the reference is. Match the look exactly, as if shot and graded by the same photographer: the tone curve and contrast, how blacks are lifted or faded, the colour tints in highlights and shadows, saturation, softness, grain, the quality and direction of the light, the sky's colours. Placed next to the style's pictures, nobody can tell which one is new.`

// --- Style text ---

/**
 * A style's guide as prompt text. `art` leaves its lettering out: city
 * posters get their words from the composition, so the picture is painted
 * without any title, whatever the style's own posters carry.
 */
export function styleText(s: StyleGuide, city?: CityGuide | null, { art = false } = {}) {
  return [
    !art && s.prompt,
    `Medium: ${s.medium}. Technique: ${s.technique}.`,
    `Palette: ${s.palette.map((p) => `${p.hex} (${p.role})`).join(", ")}.`,
    `Lighting: ${s.lighting}. Composition: ${s.composition}. Detail: ${s.detail}.`,
    !art && s.typography && `Lettering: ${s.typography}.`,
    `Mood: ${s.mood}.`,
    s.motifs.length > 0 && `Motifs: ${s.motifs.join("; ")}.`,
    s.do.length > 0 && `Do: ${s.do.join("; ")}.`,
    s.dont.length > 0 && `Don't: ${s.dont.join("; ")}.`,
    city && cityText(city, { art }),
  ]
    .filter(Boolean)
    .join("\n")
}

export function cityText(c: CityGuide, { art = false } = {}) {
  return [
    `How it shows a city: ${c.depiction}`,
    `Landmarks: ${c.landmarks}`,
    `Composition for city posters: ${c.composition}`,
    `Architecture: ${c.architecture}`,
    `Sky: ${c.sky}`,
    `Surroundings: ${c.surroundings}`,
    `People and traffic: ${c.people}`,
    !art && `Lettering: ${c.lettering}`,
    `Balance: ${c.balance}`,
    c.avoid.length > 0 && `Avoid on city posters: ${c.avoid.join("; ")}.`,
  ]
    .filter(Boolean)
    .join("\n")
}

export function readText(r: ReferenceRead) {
  return [
    `Made as: ${r.medium === "photo" ? "a photograph" : "art (drawn or painted)"}. ${r.style}`,
    `Shows: ${r.view}`,
    r.landmarks.length > 0 && `Landmarks in view: ${r.landmarks.join("; ")}.`,
    `Composition: ${r.composition}`,
    `Sky: ${r.sky}`,
    r.life && `People and traffic: ${r.life}`,
    r.palette.length > 0 && `Palette: ${r.palette.join(", ")}.`,
    r.appeal && `What makes it sell: ${r.appeal}`,
  ]
    .filter(Boolean)
    .join("\n")
}

export function placeText(b: PlaceBrief) {
  return [
    b.summary,
    b.landmarks.length > 0 && `Landmarks and signature views: ${b.landmarks.join("; ")}.`,
    b.motifs.length > 0 && `Poster motifs that capture it: ${b.motifs.join("; ")}.`,
    b.geography && `Geography that must be right: ${b.geography}`,
    b.viewpoints.length > 0 && `Real viewpoints: ${b.viewpoints.join("; ")}.`,
    b.avoid.length > 0 && `Typical mistakes: ${b.avoid.join("; ")}.`,
  ]
    .filter(Boolean)
    .join("\n")
}

const FOLLOW_TEXT: Record<Follow, string> = {
  free: "Full freedom: compose the place the way this style would show it best: its signature landmarks and the views that make the most beautiful posters.",
  low: "The extra images are the place's best-selling posters in other shops. Let them inspire you loosely (what buyers want to see of the place), then compose your own.",
  mid: "The extra images are the place's best-selling posters in other shops. Take the kinds of compositions that sell for this place (which landmark, from where, with what in front) and make them your own in this style.",
  high: "The extra images are the place's best-selling posters in other shops. Stay close to their compositions (the same choice of motif, viewpoint and framing), painted entirely in this style, never copied line for line.",
}

// --- Reading the reference ---

const STRING = { type: "STRING" }
const STRINGS = { type: "ARRAY", items: STRING }

const READ_SCHEMA = {
  type: "OBJECT",
  properties: {
    medium: { type: "STRING", enum: ["photo", "art"] },
    style: STRING,
    view: STRING,
    landmarks: STRINGS,
    composition: STRING,
    sky: STRING,
    life: STRING,
    palette: STRINGS,
    appeal: STRING,
  },
  required: ["medium", "style", "view", "landmarks", "composition", "sky", "life", "palette", "appeal"],
  propertyOrdering: ["medium", "style", "view", "landmarks", "composition", "sky", "life", "palette", "appeal"],
}

/** What a reference poster shows and how it's made, read once per set. */
export async function readReference(image: Buffer, place: string): Promise<ReferenceRead> {
  const a = await askJson<Partial<ReferenceRead>>(
    `This is a best-selling poster picture of ${place} from another shop. Describe it precisely, as an art director who has to make more pictures exactly like it:
- medium: "photo" if it is a photograph (even a graded or filtered one), "art" if it is drawn, painted, a vector or any illustration.
- style: 2–4 sentences on how it is made, precise enough to make more in exactly this look. For art: medium and tools, line weight and character, hatching, how colour is laid in, palette, paper and texture, how people, cars and trees are drawn, any in-scene lettering. For a photo: colour grading (curve, fade, tints, saturation, contrast), light quality, lens, grain, mood.
- view: what it shows and from where (vantage point, direction, distance, lens).
- landmarks: the real landmarks and features in view, by name where you can tell.
- composition: framing, horizon height, where the main subject sits, foreground to background.
- sky: the sky and the light. life: people, cars, boats ("" if none). palette: 4–6 dominant colours as hex.
- appeal: one sentence on what makes it beautiful and sell, the part to keep.`,
    [image],
    { schema: READ_SCHEMA, temperature: 0.2 }
  )
  const text = (v: unknown, max = 900) => (typeof v === "string" ? v.trim().slice(0, max) : "")
  const list = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => text(x, 120)).filter(Boolean).slice(0, 10)
  return {
    medium: a.medium === "art" ? "art" : "photo",
    style: text(a.style),
    view: text(a.view),
    landmarks: list(a.landmarks),
    composition: text(a.composition),
    sky: text(a.sky),
    life: text(a.life),
    palette: list(a.palette),
    appeal: text(a.appeal),
  }
}

const BRIEF_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: STRING,
    landmarks: STRINGS,
    motifs: STRINGS,
    geography: STRING,
    viewpoints: STRINGS,
    avoid: STRINGS,
  },
  required: ["summary", "landmarks", "motifs", "geography", "viewpoints", "avoid"],
  propertyOrdering: ["summary", "landmarks", "motifs", "geography", "viewpoints", "avoid"],
}

/** What makes a place itself, for every brief about it. */
export async function writePlaceBrief(place: string, country: string, kind: string): Promise<PlaceBrief> {
  const a = await askJson<Partial<PlaceBrief>>(
    `You brief photographers and illustrators who make best-selling travel posters of ${place} (${[kind, country].filter(Boolean).join(", ")}). Write what they must know so buyers who love the place recognise it at once and want it on their wall.
- summary: two sentences, the place at a glance and its feeling.
- landmarks: 5–10 signature landmarks and views, most recognisable first, each with a few words on how it looks (shape, colour, material).
- motifs: 6–10 poster motifs that capture the place in one picture, best first, each a concrete scene (e.g. for London "Big Ben and a red double-decker bus on Westminster Bridge", for Sydney "the Opera House and Harbour Bridge from the water", for a beach town "palms leaning over a turquoise bay"). Mix the classic icon, the skyline or panorama, a street or neighbourhood scene, nature or the beach, a view from above.
- geography: what must be right: water and coastline, hills and mountains, the skyline's shape and order, how landmarks sit relative to each other.
- viewpoints: 4–8 real places it is photographed from (named lookouts, bridges, hills, beaches, rooftops).
- avoid: 3–6 typical mistakes (landmarks of other places, wrong water, wrong architecture).
Be factual: leave out what you are unsure of.`,
    [],
    { schema: BRIEF_SCHEMA, temperature: 0.3 }
  )
  const text = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "")
  const list = (v: unknown, max = 10) => (Array.isArray(v) ? v : []).map((x) => text(x, 200)).filter(Boolean).slice(0, max)
  return {
    summary: text(a.summary),
    landmarks: list(a.landmarks),
    motifs: list(a.motifs),
    geography: text(a.geography),
    viewpoints: list(a.viewpoints, 8),
    avoid: list(a.avoid, 6),
  }
}

// --- Briefs ---

export type Brief = { title: string; brief: string; level?: Level; sky?: SkyId; motif?: string }

export type BriefItem = { level?: Level; sky?: SkyId; refMode?: RefMode; target?: string; index?: number }

export type BriefGroup = {
  /** auto: we pick each image's level and sky. */
  kind: "real" | "auto" | "idea" | "set" | "style"
  place: string
  /** What the images come out as. */
  medium: "photo" | "art"
  /** The reference is art, the images real photos (the Real photo switch). */
  fromArt?: boolean
  items: BriefItem[]
  /** Sets: how many images the whole set has. */
  setSize?: number
  /** Whether image 1 is a reference picture of the place. */
  hasReference: boolean
  read?: ReferenceRead
  brief?: PlaceBrief
  style?: { guide: StyleGuide | null; city: CityGuide | null; name: string; medium: "photo" | "art" }
  /** Style images follow the reference, and how many. */
  moodboard?: number
  /** Best sellers of the place follow, and how far to go by them. */
  sellers?: number
  follow?: Follow
  notes?: string
  /** Briefs made before for this reference: new ones must differ. */
  avoid: string[]
}

const PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    briefs: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: STRING,
          brief: STRING,
          level: { type: "INTEGER", nullable: true },
          sky: { type: "STRING", nullable: true },
          motif: { type: "STRING", nullable: true },
        },
        required: ["title", "brief"],
        propertyOrdering: ["title", "level", "sky", "motif", "brief"],
      },
    },
  },
  required: ["briefs"],
}

const skyLine = (sky: SkyId | undefined, art: boolean) => {
  const named = skyById(sky)
  return named ? ` Sky: "${named.name}" (${named.prompt})${art ? ", in the picture's own medium" : ""}.` : ""
}

function itemLine(g: BriefGroup, item: BriefItem, i: number) {
  const art = g.medium === "art"
  const n = `${i + 1}.`
  const sky = skyLine(item.sky, art)
  if (g.kind === "real") return `${n} ${(art ? ART_LEVELS : REAL_LEVELS)[item.level ?? 2]}${sky}`
  if (g.kind === "auto") return `${n} Your choice of level and sky.`
  if (g.kind === "idea") return `${n} A new composition of ${g.place}.${sky}`
  if (g.kind === "set") return `${n} Picture ${(item.index ?? i) + 1} of the set.${sky}`
  const mode = item.refMode ?? "city"
  const set = item.index !== undefined ? ` Picture ${item.index + 1} of the set.` : ""
  return `${n} ${item.target ?? g.place}, ${mode === "photo" ? "from the reference picture's view" : mode === "composition" ? "from the reference picture's composition, put into words" : "composed the way the style shows a place"}.${set}${sky}`
}

function briefPrompt(g: BriefGroup) {
  const art = g.medium === "art"
  const n = g.items.length
  let image = 1
  const roles: string[] = []
  if (g.hasReference) roles.push(`Image ${image++} is a best-selling poster picture of ${g.place} from another shop: our reference.`)
  if (g.moodboard) {
    roles.push(`${g.moodboard === 1 ? `Image ${image} is` : `Images ${image}–${image + g.moodboard - 1} are`} the style's own pictures: the look to match exactly.`)
    image += g.moodboard
  }
  if (g.sellers) roles.push(`${g.sellers === 1 ? `Image ${image} is` : `Images ${image}–${image + g.sellers - 1} are`} best-selling posters of ${g.place} in other shops.`)

  const made = art
    ? g.style
      ? `in the style "${g.style.name}", matched exactly`
      : "in exactly the reference's art style (its medium, line, palette, texture, figures)"
    : g.style
      ? `as real photographs in exactly the style "${g.style.name}"'s photographic look`
      : g.fromArt
        ? "as REAL photographs (the reference is an illustration: take only the place and its composition from it, nothing of its drawing)"
        : "as real photographs in the reference's photographic look"

  const task: Record<BriefGroup["kind"], string> = {
    real: `Write ${n} briefs for new versions of the reference, ${made}, one per level below. Each brief says what stays exactly (the viewpoint, the framing, each landmark you see, by name) and what changes, as far as its level allows. Make the briefs clearly different from each other.`,
    auto: `Decide yourself what this reference should become: ${n} new versions ${made}. For each choose a level from 1 to 5 and a sky.
Levels: ${Object.entries(art ? ART_LEVELS : REAL_LEVELS).map(([l, t]) => `${l}: ${t.split(":")[0].replace(/^Level \d, /, "")}`).join("; ")}.
Mostly stay close (levels 1–3): keep everything that makes the picture beautiful and change subtly. Take level 4 only when a nearby view would clearly make a more beautiful poster, 5 rarely. Skies: ${SKIES.map((s) => `"${s.id}" (${s.hint.toLowerCase()})`).join(", ")}, or "keep" for the reference's own sky made a little prettier. The ${n} versions differ from each other (e.g. one faithful with its sky made prettier, one with a blush or golden sky). Put the level in "level" and the sky in "sky".`,
    idea: `Write ${n} briefs for NEW pictures of ${g.place} ${made}: each a different composition, freed from the reference's framing: another signature view, landmark or scene of the place (use the motifs and viewpoints below), true to the place. Vary how far each goes: one may stay close in kind to the reference's scene (a street scene becomes another street scene), others are freer. Every one is as beautiful as the reference and unmistakably the same look, so they hang together.`,
    set: `Write ${n} briefs for a set of ${g.setSize ?? n} posters of ${g.place} ${made} that hang together on one wall: one look, one palette and sky family, but every picture showing something different. Balance the set: the first three show three different signature motifs that capture the heart of the place (e.g. New York: the skyline, Central Park, the Statue of Liberty; Sydney: the Opera House, Bondi Beach, palms on the harbour; a beach town: the beach, its landmark, nature), chosen so they complement each other (a wide view, a close icon, a scene with life). Any further pictures are creative variations: other motifs, other compositions, never a repeat. Name each picture's motif in "motif".`,
    style:
      g.style?.medium === "photo"
        ? `Write ${n} briefs for real photographs of ${g.place} ${made}. ${g.hasReference ? "Take the view from the reference where an item says so; the look always comes from the style, never from the reference." : ""}${g.setSize ? ` Together they are a set of ${g.setSize}: the first three show three different signature motifs of the place, the rest creative variations; name each one's motif in "motif".` : ""}`
        : `Write ${n} briefs for posters of ${g.place} ${made}. Each says what the poster shows (which landmarks, from where, foreground and background), how it is composed, and how the style renders it. Where an item works from the reference's composition, describe that composition so precisely it can be painted from words alone.${g.setSize ? ` Together they are a set of ${g.setSize}: the first three show three different signature motifs that capture the heart of the place, the rest creative variations; name each one's motif in "motif".` : ""}`,
  }

  return [
    `You are the art director of an Etsy shop whose city and travel posters sell very well. Every image we make must be a poster people want on their wall.`,
    ...roles,
    g.read && `The reference, already studied:\n${readText(g.read)}`,
    g.brief && `The place:\n${placeText(g.brief)}`,
    g.style && `Style "${g.style.name}" (${g.style.medium === "photo" ? "a photographic look" : "art"}):\n${g.style.guide ? styleText(g.style.guide, g.style.city, { art: true }) : "(no guide yet: go by the style's pictures)"}`,
    g.style?.medium === "photo" && PHOTO_STYLE_RULES,
    g.follow && g.sellers ? FOLLOW_TEXT[g.follow] : g.follow === "free" && FOLLOW_TEXT.free,
    `Task: ${task[g.kind]}`,
    (g.kind === "real" || g.kind === "auto") &&
      `Every brief is a new version of THIS reference: the same place, the same main subject and the landmarks it shows${g.read?.landmarks.length ? ` (${g.read.landmarks.join(", ")})` : ""}. Never another landmark or another part of the city. Name only what you can see in the reference.`,
    !g.items.some((i) => i.sky) && g.kind !== "auto" && skyText(undefined, { art }),
    !art && SKY_RULES,
    art && `Art rules: keep the look exactly, its palette and its lightness; skies and light stay bright and inviting (never night, a darkening twilight or a deep blue sky); no poster title or caption (in-scene signs only where the look has them, few and correctly spelled).`,
    g.notes && `The shop owner asks for this, in every brief: ${g.notes}`,
    `Images to brief, in order:\n${g.items.map((item, i) => itemLine(g, item, i)).join("\n")}`,
    g.avoid.length > 0 && `Made before for this reference; make each new one clearly different:\n${g.avoid.slice(-20).map((a) => `- ${a}`).join("\n")}`,
    art
      ? `Each brief: 3 to 6 sentences an illustrator can draw from: what's shown and from where, the composition, figures and details, the sky, and how the look applies. Ask for no more detail than the look's own pictures have: a loose, naive look gets a simple scene. Each "title" is 2 to 5 words naming the picture.`
      : `Each brief: 3 to 6 sentences a photographer can shoot from: the place and its landmarks by name, viewpoint and lens, the sky (named exactly, e.g. "a soft gradient from blush pink at the horizon to white"), the light, the colours, what's tidied away. Never anything that isn't really there. Each "title" is 2 to 5 words, e.g. "Blush harbour morning".`,
    `Never name artists, shops, brands or copyrighted characters.`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

const toLevel = (v: unknown): Level | undefined => (Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 5 ? (Number(v) as Level) : undefined)
const toSky = (v: unknown): SkyId | undefined => (typeof v === "string" && skyById(v) ? (v as SkyId) : v === "keep" ? "auto" : undefined)

/** One brief per item of the group, in order; `images` are the reference (if any), the style's images and the best sellers. */
export async function planCityBriefs(group: BriefGroup, images: Buffer[]): Promise<Brief[]> {
  const out: Brief[] = []
  for (let at = 0; at < group.items.length; at += 10) {
    const items = group.items.slice(at, at + 10)
    const answer = await askJson<{ briefs?: { title?: string; brief?: string; level?: number; sky?: string; motif?: string }[] }>(
      briefPrompt({ ...group, items, avoid: [...group.avoid, ...out.map((b) => `${b.title}: ${b.brief}`)] }),
      images,
      { schema: PLAN_SCHEMA, temperature: 0.9 }
    )
    const got = answer.briefs ?? []
    items.forEach((item, i) => {
      const b = got[i]
      out.push(
        b?.brief
          ? {
              title: b.title || "Variation",
              brief: b.brief,
              ...(group.kind === "auto" && { level: toLevel(b.level) ?? (((i % 3) + 1) as Level), sky: toSky(b.sky) ?? "auto" }),
              ...(b.motif && { motif: b.motif.slice(0, 120) }),
            }
          : { title: "Variation", brief: fallbackBrief(group, item), ...(group.kind === "auto" && { level: (((i % 2) + 1) as Level), sky: "auto" as SkyId }) }
      )
    })
  }
  return out
}

function fallbackBrief(g: BriefGroup, item: BriefItem) {
  const art = g.medium === "art"
  if (g.kind === "real" || g.kind === "auto") return `${g.place}. ${(art ? ART_LEVELS : REAL_LEVELS)[item.level ?? 2]}`
  if (g.kind === "idea") return `A new picture of ${g.place} from another of its signature views, in the reference's look.`
  if (g.kind === "set") return `A poster of ${g.place} showing one of its signature motifs, in the reference's look.`
  return `A poster of ${item.target ?? g.place} in the style, showing its signature landmarks.`
}

// --- What Nano Banana is told ---

export type PaintParts = {
  kind: CityOutputInfo["kind"]
  place: string
  brief: string
  level?: Level
  sky?: SkyId
  refMode?: RefMode
  /** What it comes out as. */
  medium: "photo" | "art"
  /** The reference is art, the image a real photo. */
  fromArt?: boolean
  /** Image 1 is a reference picture of the place. */
  reference: boolean
  /** Style images follow (the moodboard), and how many. */
  moodboard: number
  style?: { guide: StyleGuide | null; city: CityGuide | null; medium: "photo" | "art" }
  read?: ReferenceRead
  /** The place's landmarks and geography, to keep it true. */
  placeLine?: string
  notes?: string
  /** Lab block "references": the moodboard images are posters of other places to paint a new one after. */
  series?: boolean
}

export function paintCityPrompt(p: PaintParts) {
  const roles: string[] = []
  let n = 1
  const styled = p.kind === "style" || p.kind === "lab"
  if (p.reference) {
    roles.push(
      styled
        ? p.refMode === "photo"
          ? `Image 1 is a picture of ${p.place}: take its view and landmarks${p.style?.medium === "photo" ? "; if it is an illustration, take nothing of its drawing" : ", never its look"}.`
          : `Image 1 is a real photo of ${p.place}.`
        : p.fromArt
          ? `Image 1 is an illustrated poster of ${p.place}: take only the place and its composition from it, nothing of its drawing.`
          : p.medium === "art"
            ? `Image 1 is an illustrated poster of ${p.place}: the reference, and the art style to keep exactly.`
            : `Image 1 is a real photo of ${p.place}: the reference.`
    )
    n++
  }
  if (p.moodboard > 0) {
    const range = p.moodboard === 1 ? `Image ${n}` : `Images ${n}–${n + p.moodboard - 1}`
    roles.push(
      p.series
        ? `${range} ${p.moodboard === 1 ? "is a poster" : "are posters"} in the style, of other places: paint the new place so it hangs in the same series, but never copy their places or compositions.`
        : `${range} ${p.moodboard === 1 ? "is" : "are"} the style's own pictures: match their look exactly (${p.style?.medium === "photo" ? "colour grading, light, film character, mood" : "medium, line, palette, texture, light"}); take nothing of their places or of anything around them.`
    )
    n += p.moodboard
  }
  const sky = p.sky ? skyText(p.sky, { art: p.medium === "art" }) : null

  if (!styled) {
    const art = p.medium === "art"
    const task =
      p.kind === "idea"
        ? art
          ? `Draw a new poster of ${p.place} in exactly the reference's art style, as if the same artist drew the next poster of the series: a new composition, as the art direction says, never its composition again; the same hand, line, colouring and amount of detail.`
          : `Create a new real photograph of ${p.place}, as the art direction says, in the reference's photographic look (colour grading, light, lens, mood): another view than the reference's.`
        : p.kind === "set"
          ? art
            ? `Draw one poster of a set of ${p.place} in exactly the reference's art style, as the art direction says: the same artist drew the whole set, so the hand, line, colouring and amount of detail match the reference exactly.`
            : `Create one real photograph of a set of ${p.place}, as the art direction says, in the reference's photographic look, so the set hangs together.`
          : art
            ? `Draw a new version of this illustrated poster of ${p.place} in exactly its art style, as the art direction says. ${ART_LEVELS[p.level ?? 2]}`
            : `Create a new version of this ${p.fromArt ? "picture" : "real photo"} of ${p.place} as a real photograph, as the art direction says. ${REAL_LEVELS[p.level ?? 2]}`
    return [
      ...roles,
      task,
      `Art direction: ${p.brief}`,
      sky,
      art && p.read && `The art style to keep, as read off the reference: ${p.read.style}`,
      p.placeLine && `The place, which must be right: ${p.placeLine}`,
      p.notes && `Notes from the shop owner (most important): ${p.notes}`,
      art ? ART_RULES : REAL_RULES,
    ]
      .filter(Boolean)
      .join("\n\n")
  }

  const photoStyle = p.style?.medium === "photo"
  const task =
    p.kind === "lab" && p.series
      ? `${photoStyle ? "Make a new real photograph" : "Paint a new travel poster"} of ${p.place} in exactly this style, as the art direction says.`
      : p.refMode === "photo" && p.reference
        ? photoStyle
          ? `Make a real photograph of ${p.place} from the view of image 1, in exactly the style's photographic look.`
          : `Repaint the view of ${p.place} in image 1 as a poster in exactly this style: its viewpoint and landmarks in their places, simplified the way the style simplifies.`
        : photoStyle
          ? `Make a real photograph of ${p.place} in exactly the style's photographic look, as the art direction says.`
          : `The style's pictures are posters of one series by one artist. Paint the next poster of that series: ${p.place}, as the art direction says, drawn by the same hand with the same pens, colours and paper, as simple or as detailed as they are.`
  return [
    ...roles,
    task,
    `Art direction: ${p.brief}`,
    photoStyle && PHOTO_STYLE_RULES,
    sky,
    p.style?.guide && `Style:\n${styleText(p.style.guide, p.style.city, { art: true })}`,
    p.placeLine && `The place, which must be right: ${p.placeLine}`,
    p.notes && `Notes from the shop owner (most important): ${p.notes}`,
    photoStyle ? REAL_RULES : ART_RULES,
  ]
    .filter(Boolean)
    .join("\n\n")
}
