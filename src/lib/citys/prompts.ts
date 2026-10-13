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
- People and cars small and incidental, fewer rather than more, never posed, no faces in focus; never crowds, packed beaches or rows of umbrellas and sunbeds.
- Only the photograph, edge to edge, filling the canvas.`

/** What every picture in an art style must be, after a reference or a style. */
const ART_RULES = `Rules for an illustrated poster:
- Keep the art style exactly: medium, line weight and character, hatching, how colour is laid in (washes, crayon, flat fills, paper showing through), palette and how saturated it is, texture, level of detail, how people, cars and trees are drawn. It must be impossible to tell the new picture from the style's own pictures except by what it shows: the same hand, the same pens, the same paper.
- Never cleaner, finer, more detailed or more polished than the style's own pictures. A loose, wobbly, naive hand stays loose, wobbly and naive; thick uneven lines stay thick and uneven; crayon texture stays crayon; few details stay few. Image models tidy everything up: don't.
- Match the line weight at the poster's scale: as thick, as dark and as few lines as in the style's own pictures; a busy scene is simplified to their level of detail, never drawn with finer pens.
- Draw everything new: never trace or copy a source drawing.
- The place is right and recognisable: its real landmarks in their true shape and relation, simplified the way the style simplifies, never replaced by generic buildings.
- A poster people want on their wall: a clear focal point, a balanced composition, nothing awkwardly cut off. Skies and light stay bright and inviting, as light as the style's own pictures: never night, a darkening twilight, a deep blue or a gloomy sky.
- No poster title, caption or place-name band. Signs and small objects are optional details, not the point: the style lives in the line, the colour, the paper and how buildings, trees and people are drawn. A sign only where it helps the place and the style's own pictures have such signs: few, short, correctly spelled, generic (street and place names, CAFE, HOTEL, MUSEUM). Never a brand, logo, company, show, film or other trademark (no fast-food signs, no theatre or film titles, no shop chains).
- Never paint what sat in front of or around a poster in its photo (books, vases, frames, walls, hands, room): only the artwork, front-on, edge to edge. No logos, watermarks or signatures.`

/** A photo style: real photos in exactly the style's look. */
const PHOTO_STYLE_RULES = `The style is a photographic look (its colour grading, film character, light and mood), not an illustration. The result is a REAL photograph of the place, never a drawing, painting or 3D render, whatever the reference is. Match the look exactly, as if shot and graded by the same photographer: the tone curve and contrast, how blacks are lifted or faded, the colour tints in highlights and shadows, saturation, softness, grain, the quality and direction of the light, the sky's colours. Placed next to the style's pictures, nobody can tell which one is new.`

// --- Composition ---

/**
 * How best-selling travel photo posters are composed, studied on the top
 * sellers of Traposto, Postour and Advntre (13 Oct): the icon from its
 * classic vantage point, a framing foreground, a leading line, generous sky,
 * calm and uncrowded, the place shown as a dream to travel to.
 */
export const PHOTO_COMPOSITION = `Compose like the best-selling travel photo posters, as a professional photographer hired to make people want to travel there:
- One clear subject recognised at a glance (the landmark, the town on its cliff, the bay, the skyline), large enough to read, on a third or centred with intent, with room around it.
- Its classic, postcard-perfect vantage point: from across the water or a bridge, from a hill, terrace or rooftop above the town, or straight down an avenue that ends in the landmark. A coast from the cliffs or the road above, the town and the bay below.
- A foreground that frames and invites, kept to the edges: a lemon or olive branch, bougainvillea, a pine or cypress, a terrace balustrade, a bicycle on a canal railing, rocks or grass at the water's edge.
- A leading line into the picture: a road, river, coastline, pier, path or avenue of trees, curving toward the subject.
- Depth in layers: the foreground, the subject, the sea or mountains beyond, the sky.
- A generous, luminous sky, often a third to half of the frame, the horizon on a third.
- The place's true colours, vivid but natural: pastel houses, turquoise and emerald water, green cliffs, warm stone, a sky with real colour.
- Calm and uncrowded: never crowds, rows of umbrellas or sunbeds, packed beaches, traffic jams, tour buses, scaffolding or clutter. People only tiny and few (a lone walker, a cyclist, a boat), if at all. The place looks like a dream to travel to, not a busy day.
- Built for a vertical poster: the subject never cut, nothing important at the edges.`

/**
 * The same for drawn posters, from the top 100 sellers of every city shop
 * (13 Oct): a third of them are one watercolour shop's sets of three, all
 * built the same way: a street or promenade leading to the landmark,
 * framed by trees and lamp posts, flowers and a bench in the corners.
 */
const ART_COMPOSITION = `Compose like the best-selling illustrated city posters:
- A view a stroller would see: down a street, a promenade, a park path or a waterfront, leading the eye to the place's landmark at the end (the tower, the dome, the bridge, the skyline), which sits large and clear, often centred or on a third.
- Framed on both sides: a leafy tree arching in from one edge, a lamp post, the corner of a pretty building with balconies and shutters, an awning; flowers in pots, a flower bed or a bench in the bottom corners.
- A little life, never crowds: two or three strolling figures, a cyclist, a dog, a vintage car, a scooter, a boat on the water, small and charming. Beaches nearly empty: a few figures at most, never a beach dotted with people.
- Airy: plenty of light sky or bare paper above, the scene breathing, depth in layers from the corners to the landmark.
- Other compositions that sell: a park with a bridge and the skyline behind; a beach crescent with palms and the mountain beyond; the skyline across the water with a bridge; a market or café corner with the landmark peeking over the roofs.
Built for a vertical poster, the landmark never cut.`

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
    b.compositions?.length && `Compositions its best-selling posters use: ${b.compositions.join("; ")}.`,
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
    compositions: STRINGS,
    geography: STRING,
    viewpoints: STRINGS,
    avoid: STRINGS,
  },
  required: ["summary", "landmarks", "motifs", "compositions", "geography", "viewpoints", "avoid"],
  propertyOrdering: ["summary", "landmarks", "motifs", "compositions", "geography", "viewpoints", "avoid"],
}

/**
 * What makes a place itself, for every brief about it. `images` are its
 * best-selling posters in other shops (real photos first): what sells, and
 * what the place really looks like.
 */
export async function writePlaceBrief(place: string, country: string, kind: string, images: Buffer[] = []): Promise<PlaceBrief> {
  const a = await askJson<Partial<PlaceBrief>>(
    `You brief photographers and illustrators who make best-selling travel posters of ${place} (${[kind, country].filter(Boolean).join(", ")}). Write what they must know so buyers who love the place recognise it at once and want it on their wall.${images.length ? ` The ${images.length === 1 ? "image is" : `${images.length} images are`} this place's best-selling posters in other shops: study what they show, from where and how they are composed. They are what sells, and they show what the place really looks like.` : ""}
- summary: two sentences, the place at a glance and its feeling.
- landmarks: 5–10 signature landmarks and views, most recognisable first, each with a few words on how it really looks (shape, colour, material, setting).
- motifs: 6–10 poster motifs that capture the place in one picture, best first, each a concrete scene (e.g. for London "Big Ben and a red double-decker bus on Westminster Bridge", for Sydney "the Opera House and Harbour Bridge from the water", for a beach town "palms leaning over a turquoise bay"). Mix the classic icon, the skyline or panorama, a street or neighbourhood scene, nature or the beach, a view from above. Never a crowded tourist scene (packed beaches, rows of umbrellas, queues).
- compositions: 4–8 compositions that sell for this place, as a photographer would set them up: the subject, the exact vantage point (named), the framing and foreground, the light (e.g. "Bondi Beach's crescent from the cliff walk at the south end, the Icebergs pool in the foreground, early-morning light").${images.length ? " Start from the ones the best sellers use." : ""}
- geography: what must be right: water and coastline, hills and mountains, the skyline's shape and order, how landmarks sit relative to each other.
- viewpoints: 4–8 real places it is photographed from (named lookouts, bridges, hills, beaches, rooftops).
- avoid: 3–6 typical mistakes (landmarks of other places, wrong water, wrong architecture).
Be factual: leave out what you are unsure of.`,
    images,
    { schema: BRIEF_SCHEMA, temperature: 0.3 }
  )
  const text = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "")
  const list = (v: unknown, max = 10) => (Array.isArray(v) ? v : []).map((x) => text(x, 240)).filter(Boolean).slice(0, max)
  return {
    summary: text(a.summary),
    landmarks: list(a.landmarks),
    motifs: list(a.motifs),
    compositions: list(a.compositions, 8),
    geography: text(a.geography),
    viewpoints: list(a.viewpoints, 8),
    avoid: list(a.avoid, 6),
    version: 2,
  }
}

// --- Briefs ---

/** `photo`: which of the place's real photos (1-based) shows the brief's motif, for the painter's geography. */
export type Brief = { title: string; brief: string; level?: Level; sky?: SkyId; motif?: string; photo?: number; board?: number }

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
  /** Real photos of the place follow last, numbered for the briefs to pick from. */
  geo?: number
  /** A redrawn art style: the moodboard's posters are numbered for each brief to pick the one it's redrawn from. */
  boards?: number
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
          photo: { type: "INTEGER", nullable: true },
          board: { type: "INTEGER", nullable: true },
        },
        required: ["title", "brief"],
        propertyOrdering: ["title", "level", "sky", "motif", "board", "photo", "brief"],
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

/** What a set of a place must be, for sets in a style. */
const SET_RULE = `the first three show three different signature motifs that capture the heart of the place, like the best-selling sets of three (e.g. Paris: the Eiffel Tower, Montmartre with Sacré-Cœur, a Seine bridge with Notre-Dame; Sydney: the Opera House, Bondi Beach, the Harbour Bridge; Amsterdam: a canal with gabled houses, the Rijksmuseum with tulips, a flower market or windmill). The place's most famous icon is always one of them. One landmark leads one picture only, never two (landmarks that stand together count as one: Big Ben and the Houses of Parliament, the Colosseum and the Forum), and the three are different kinds of scene (a street or square with the icon, a park, market or neighbourhood, a waterfront, bridge or panorama). Any further pictures are creative variations, never a repeat. Name each one's motif in "motif".`

/** Groups that compose the picture themselves (rather than keep the reference's framing) get the composition lessons. */
const composes = (g: BriefGroup) =>
  g.kind === "idea" || g.kind === "set" || g.kind === "auto" || (g.kind === "style" && g.items.some((i) => i.refMode !== "photo")) || (g.kind === "real" && g.items.some((i) => (i.level ?? 0) >= 4))

function briefPrompt(g: BriefGroup) {
  const art = g.medium === "art"
  const n = g.items.length
  let image = 1
  const roles: string[] = []
  if (g.hasReference) roles.push(`Image ${image++} is a best-selling poster picture of ${g.place} from another shop: our reference.`)
  if (g.moodboard) {
    roles.push(
      g.boards
        ? `${g.moodboard === 1 ? `Image ${image} is` : `Images ${image}–${image + g.moodboard - 1} are`} the style's own posters, numbered 1 to ${g.boards}. Each new poster is painted by redrawing one of them as the new scene, so the hand stays exactly the same: for each brief put in "board" the number of the poster whose composition and kind of scene fit it best (a street scene for a street, a waterfront for a waterfront), varying them across a set, and write the brief as a scene that can grow out of that poster's layout.`
        : `${g.moodboard === 1 ? `Image ${image} is` : `Images ${image}–${image + g.moodboard - 1} are`} the style's own pictures: the look to match exactly.`
    )
    image += g.moodboard
  }
  if (g.sellers) {
    roles.push(`${g.sellers === 1 ? `Image ${image} is` : `Images ${image}–${image + g.sellers - 1} are`} best-selling posters of ${g.place} in other shops.`)
    image += g.sellers
  }
  if (g.geo) {
    roles.push(
      `${g.geo === 1 ? `Image ${image} is a real photo` : `Images ${image}–${image + g.geo - 1} are real photos`} of ${g.place}, numbered 1 to ${g.geo}: what its landmarks, coast and streets really look like. For each brief put in "photo" the number of the one that shows its motif best, so the painter gets the geography right (0 when none shows it). Choose motifs these photos show where you can; never copy their light or framing.`
    )
  }

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
    set: `Write ${n} briefs for a set of ${g.setSize ?? n} posters of ${g.place} ${made} that hang together on one wall: one look, one palette and sky family, the same kind of framing and the same distance, but every picture showing something different (like the best-selling sets of three: a street with the landmark, a park or waterfront scene, the skyline or a second landmark). Balance the set: the first three show three different signature motifs that capture the heart of the place (e.g. New York: the skyline, Central Park, the Statue of Liberty; Sydney: the Opera House, Bondi Beach, palms on the harbour; Paris: the Eiffel Tower, Montmartre and Sacré-Cœur, a Seine bridge with Notre-Dame; Amsterdam: a canal with gabled houses, the Rijksmuseum with tulips, a flower market or windmill; a beach town: the beach, its landmark, nature), chosen so they complement each other (a wide view, a close icon, a scene with life). The place's most famous icon is always one of them. One landmark is the subject of one picture only: never the same tower, bridge or building leading two pictures (landmarks that stand together count as one: Big Ben and the Houses of Parliament), and never three pictures of the same kind of scene (three canals, three streets). Any further pictures are creative variations: other motifs, other compositions, never a repeat.${g.hasReference ? " The reference's own view is made already: every picture of the set shows something else." : ""} Name each picture's motif in "motif".`,
    style:
      g.style?.medium === "photo"
        ? `Write ${n} briefs for real photographs of ${g.place} ${made}. ${g.hasReference ? "Take the view from the reference where an item says so; the look always comes from the style, never from the reference." : ""}${g.setSize ? ` Together they are a set of ${g.setSize}: ${SET_RULE}` : ""}`
        : `Write ${n} briefs for posters of ${g.place} ${made}. Each says what the poster shows (which landmarks, from where, foreground and background), how it is composed, and how the style renders it. Where an item works from the reference's composition, describe that composition so precisely it can be painted from words alone.${g.setSize ? ` Together they are a set of ${g.setSize}: ${SET_RULE}` : ""}`,
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
    composes(g) && (art ? ART_COMPOSITION : PHOTO_COMPOSITION),
    !g.items.some((i) => i.sky) && g.kind !== "auto" && skyText(undefined, { art }),
    !art && SKY_RULES,
    art && `Art rules: keep the look exactly, its palette and its lightness; skies and light stay bright and inviting (never night, a darkening twilight or a deep blue sky); no poster title or caption (in-scene signs only where the look has them, few and correctly spelled).`,
    g.notes && `The shop owner asks for this, in every brief: ${g.notes}`,
    `Images to brief, in order:\n${g.items.map((item, i) => itemLine(g, item, i)).join("\n")}`,
    g.avoid.length > 0 && `Made before for this reference; make each new one clearly different:\n${g.avoid.slice(-20).map((a) => `- ${a}`).join("\n")}`,
    art
      ? `Each brief: a short, concrete scene in plain words, the way you'd brief a gifted illustrator, 2 to 4 sentences: what we see and from where, the few elements that make it this place, the sky and the feel. For example: "A London street: a magenta double-decker bus, the clock tower behind it, a striped awning on the corner, a few scribbled trees, a loose crowd of small figures walking." Signs and small objects are optional: one only where it helps; the style lives in the line, colour, paper and how buildings, trees and people are drawn. Ask for no more detail than the look's own pictures have. Each "title" is 2 to 5 words naming the picture.`
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
    const answer = await askJson<{ briefs?: { title?: string; brief?: string; level?: number; sky?: string; motif?: string; photo?: number; board?: number }[] }>(
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
              ...(group.geo && Number.isInteger(b.photo) && b.photo! >= 1 && b.photo! <= group.geo && { photo: b.photo }),
              ...(group.boards && Number.isInteger(b.board) && b.board! >= 1 && b.board! <= group.boards && { board: b.board }),
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
  /** A real photo of the motif follows the moodboard: for its true geography only. */
  geo?: boolean
  /** A photo of the sky asked for follows last (a sky of the shop's own). */
  skyImage?: boolean
  /**
   * A new real photo (new idea, set) that must not copy the reference: the
   * motif's photo comes first and the reference after it, for its look only.
   * Nano Banana redraws image 1 when it can (13 Oct: two of three set photos
   * came out as the reference's view again).
   */
  lookOnly?: boolean
  /**
   * How an art style is asked: "lean" (the default) in a few lines, the way
   * one briefs a gifted illustrator: the series, the scene, the manner, the
   * format; "full" with the guide's notes and every rule spelled out.
   */
  mode?: "lean" | "full"
  /** The first moodboard image is the board poster to redraw as the new place, the others more of the series. */
  redraw?: boolean
  notes?: string
  /** Lab block "references": the moodboard images are posters of other places to paint a new one after. */
  series?: boolean
}

export function paintCityPrompt(p: PaintParts) {
  const roles: string[] = []
  let n = 1
  const styled = p.kind === "style" || p.kind === "lab"
  if (p.lookOnly) {
    if (p.geo) {
      roles.push(`Image ${n} is a real photo of ${p.place} showing the new photograph's subject, only for its true geography: where the landmarks, coast and streets really are and how they look. Never its light, colours, people or framing.`)
      n++
    }
    if (p.reference) {
      roles.push(`Image ${n} is the reference photo: take only its photographic look (colour grading, light, mood). Never its view, subject or framing: the new photograph shows something else.`)
      n++
    }
  } else if (p.reference) {
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
        : p.redraw
          ? `Image ${n} is a poster from a series by one artist: the one to redraw.${p.moodboard > 1 ? ` ${p.moodboard === 2 ? `Image ${n + 1} is` : `Images ${n + 1}–${n + p.moodboard - 1} are`} more of the series.` : ""} Take nothing of their places or of anything around them.`
          : p.style?.medium !== "photo" && (p.mode ?? "lean") === "lean"
            ? `${range} ${p.moodboard === 1 ? "is a poster" : "are posters"} from one series by one artist: the look to continue. Take nothing of their places or of anything around them.`
          : `${range} ${p.moodboard === 1 ? "is" : "are"} the style's own pictures: match their look exactly (${p.style?.medium === "photo" ? "colour grading, light, film character, mood" : "medium, line, palette, texture, light"}); take nothing of their places or of anything around them.`
    )
    n += p.moodboard
  }
  if (p.geo && !p.lookOnly) {
    roles.push(
      `Image ${n} is a real photo of this very place, only for its true geography: where the landmarks, coast and streets really are and how they look. Take nothing else from it: not its light, colours, people, framing or ${p.medium === "art" ? "medium (the picture stays drawn in the style)" : "look"}.`
    )
    n++
  }
  if (p.skyImage) {
    roles.push(`Image ${n} shows the sky to give the picture: take only its colours, light and clouds, never its place${p.medium === "art" ? ", and paint it in the picture's own medium" : ""}.`)
    n++
  }
  const sky = p.sky ? skyText(p.sky, { art: p.medium === "art" }) : null

  if (!styled) {
    const art = p.medium === "art"
    const task =
      p.kind === "idea"
        ? art
          ? `Draw a new poster of ${p.place} in exactly the reference's art style, as if the same artist drew the next poster of the series: a new composition, as the art direction says, never its composition again; the same hand, line, colouring and amount of detail.`
          : `Create a new real photograph of ${p.place}, as the art direction says: a different subject and view than the reference, in its photographic look (colour grading, light, mood).`
        : p.kind === "set"
          ? art
            ? `Draw one poster of a set of ${p.place} in exactly the reference's art style, as the art direction says: the same artist drew the whole set, so the hand, line, colouring and amount of detail match the reference exactly.`
            : `Create one real photograph of a set of ${p.place}, as the art direction says: its own subject and view, never the reference's, in the reference's photographic look so the set hangs together.`
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
  if (!photoStyle && (p.mode ?? "lean") === "lean") return leanArtPrompt(p, roles, sky)
  const task =
    p.kind === "lab" && p.series
      ? `${photoStyle ? "Make a new real photograph" : "Paint a new travel poster"} of ${p.place} in exactly this style, as the art direction says.`
      : p.refMode === "photo" && p.reference
        ? photoStyle
          ? `Make a real photograph of ${p.place} from the view of image 1, in exactly the style's photographic look.`
          : `Repaint the view of ${p.place} in image 1 as a poster in exactly this style: its viewpoint and main landmarks in their places, reduced to the style's own level of detail. Keep only what the style would draw (the main subject and a few supporting shapes); a dense photo of a whole city becomes a simple, airy picture with as few elements as the style's own pictures.`
        : photoStyle
          ? `Make a real photograph of ${p.place} in exactly the style's photographic look, as the art direction says.`
          : `The style's pictures are posters of one series by one artist. Paint the next poster of that series: ${p.place}, as the art direction says, drawn by the same hand with the same pens, colours and paper, as simple or as detailed as they are. Never repeat one of their compositions: where they already show this place, show another view of it.`
  // Art leads with its manner in a few plain words and keeps the notes short: the style's
  // pictures carry the look, a long list of rules only makes the model tidy it up.
  const manner = !photoStyle ? p.style?.city?.manner : undefined
  return [
    ...roles,
    manner && `The manner: ${manner}`,
    task,
    `Art direction: ${p.brief}`,
    photoStyle && PHOTO_STYLE_RULES,
    sky,
    p.style?.guide && (photoStyle ? `Style:\n${styleText(p.style.guide, p.style.city, { art: true })}` : `Style notes: ${styleNotes(p.style.guide)}`),
    p.placeLine && `The place, which must be right: ${p.placeLine}`,
    p.notes && `Notes from the shop owner (most important): ${p.notes}`,
    photoStyle ? REAL_RULES : ART_RULES,
  ]
    .filter(Boolean)
    .join("\n\n")
}

/**
 * An art style asked in a few lines: on 13 Oct the long prompt (5,000
 * characters of notes, landmarks and rules) made Nano Banana tidy the style
 * up (finer lines, more detail, stronger colour); a short one leaves the
 * look to the series' own pictures and keeps the hand loose.
 */
function leanArtPrompt(p: PaintParts, roles: string[], sky: string | null) {
  const repaint = p.refMode === "photo" && p.reference
  const manner = p.style?.city?.manner
  const first = p.reference ? 2 : 1
  if (p.redraw) {
    return [
      ...roles,
      `Redraw image ${first} as the series' poster of ${p.place}: ${p.brief}`,
      `Keep everything about how image ${first} is drawn: the same pens and the same line (as thick, as dark, as wobbly), the same colouring and its strength, the same paper, the same naive figures, cars and trees, the same amount of detail. What it shows changes completely: ${p.place}'s scene and landmarks, as described, with ${p.place}'s own buildings and streets in place of every building of the original. The layout may change as far as the scene needs; the place must be recognisable at a glance.`,
      `No word, sign or landmark of the original may remain: every sign is new, short and in ${p.place}'s own language, or left out.`,
      manner && `The manner: ${manner}`,
      sky,
      p.notes && `The shop owner asks (most important): ${p.notes}`,
      `A vertical poster, the picture running off all four edges. No title or text band, no frame, no logos or brand names.`,
    ]
      .filter(Boolean)
      .join("\n\n")
  }
  return [
    ...roles,
    repaint
      ? `Paint the next poster of the series from the view in image 1: ${p.place}, its viewpoint and main landmarks kept, reduced to the series' own few elements.`
      : `Paint the next poster of this series: ${p.place}.`,
    p.brief,
    manner && `The manner: ${manner}`,
    `Match the series exactly, as if the same artist drew it in the same sitting: the same line (as thick, as wobbly, as loose), the same colouring and paper, as few elements and as little detail as they have. Never finer, cleaner, more detailed or more colourful than the series. Never repeat one of their pictures.`,
    sky,
    p.notes && `The shop owner asks (most important): ${p.notes}`,
    `A vertical poster, the picture running off all four edges. No title or text band, no frame, no logos or brand names; a short sign only if the series would draw one.`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

/** An art style in four lines: what it's made with, its line and texture, its palette, how much detail. */
function styleNotes(g: StyleGuide) {
  return [`Medium: ${g.medium}`, `Line and texture: ${g.technique}`, `Palette: ${g.palette.map((c) => `${c.hex} (${c.role})`).join(", ")}`, `Detail: ${g.detail}`].join(". ")
}
