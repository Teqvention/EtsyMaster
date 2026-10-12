// The skies a city poster can be asked for. They're the shop's taste put
// into words: bright, warm, inviting skies that sell (a blush pink fading to
// white, a gentle golden hour, a turquoise summer sky), never dark or loud.
// "auto" leaves the sky to the art director, who knows this taste but isn't
// bound to the list. Every real photo and every sky follows SKY_RULES.

export const SKY_IDS = ["blush", "golden", "turquoise", "sunshine", "peach", "cotton", "lilac", "morning"] as const
export type SkyName = (typeof SKY_IDS)[number]
export type SkyId = "auto" | SkyName

export type Sky = {
  id: SkyName
  name: string
  /** A few words for the picker. */
  hint: string
  /** Bottom to top, for the swatch. */
  swatch: string[]
  /** The sky, for the image model. */
  prompt: string
}

export const SKIES: Sky[] = [
  {
    id: "blush",
    name: "Blush pink",
    hint: "Pastel pink fading to white",
    swatch: ["#f3c9cf", "#f8e1e3", "#fdf6f4"],
    prompt:
      "a soft pastel sky fading from blush pink at the horizon to white above, at most a few faint wisps, calm and airy; even, gentle light just after sunset or before sunrise, a delicate pink glow on light surfaces, whites kept clean, water calm and pale",
  },
  {
    id: "golden",
    name: "Golden hour",
    hint: "Warm low sun gilding facades",
    swatch: ["#f2c38f", "#f7dcb6", "#cfe0ee"],
    prompt:
      "a subtle golden hour: low, warm sun gently gilds facades, trees and palms from one side, soft long shadows, the sky shading from pale gold and peach at the horizon to soft light blue above; warm and delicate, never orange, red or fiery",
  },
  {
    id: "turquoise",
    name: "Turquoise",
    hint: "Airy aqua sky, turquoise water",
    swatch: ["#7fd3d2", "#a9e3e2", "#d9f3f1"],
    prompt:
      "a clear, luminous turquoise-to-aqua sky, pale and airy, and crystal-clear turquoise water wherever there is water; fresh, bright light with a slightly faded, lifted, film-like look, as in airy travel prints",
  },
  {
    id: "sunshine",
    name: "Sunshine",
    hint: "Summer day, clear blue sky",
    swatch: ["#8fc2ec", "#b4d7f3", "#e6f2fb"],
    prompt:
      "a beautiful summer day: a clear, friendly blue sky, a few small white fair-weather clouds only where they help the picture (or none), bright warm sunshine, true, crisp colours",
  },
  {
    id: "peach",
    name: "Peach & blue",
    hint: "Peach horizon, powder-blue top",
    swatch: ["#f4c6a0", "#f3dccb", "#bcd3ea"],
    prompt:
      "a smooth, cloudless gradient from soft peach and apricot at the horizon to pale powder blue above, still air, the soft warm light just before sunset",
  },
  {
    id: "cotton",
    name: "Cotton candy",
    hint: "Pink and lilac pastel clouds",
    swatch: ["#f5c4cf", "#e3c9e8", "#c9dcf2"],
    prompt:
      "light pastel pink and lilac cotton-candy clouds scattered over a pale peach and light blue sky, a soft sunset glow, dreamy but gentle; the clouds airy and lit from below, never grey or heavy",
  },
  {
    id: "lilac",
    name: "Lilac dusk",
    hint: "Lavender wisps, rose horizon",
    swatch: ["#efc3cf", "#d9c6e8", "#c3cbe9"],
    prompt:
      "a delicate lilac-lavender sky with a soft rose glow at the horizon and faint purple wisps, a calm twilight that stays light and pastel, never night",
  },
  {
    id: "morning",
    name: "Soft morning",
    hint: "Milky blue and cream, airy",
    swatch: ["#efe6d6", "#e2ebf0", "#cfe1ee"],
    prompt:
      "a pale, luminous morning sky in milky light blue and cream with the faintest haze, soft diffuse light, fresh and airy, gentle pastel colours",
  },
]

export const skyById = (id: string | undefined) => SKIES.find((s) => s.id === id)

export const isSkyId = (v: unknown): v is SkyId => v === "auto" || SKY_IDS.includes(v as SkyName)

/** Old looks (inspirations) a request may still name, as the sky nearest them. */
export const LOOK_SKY: Record<string, SkyId> = {
  "pink-sky": "blush",
  "sunset-glow": "golden",
  "turquoise-water": "turquoise",
  "bright-blue": "sunshine",
}

/** What makes a sky right for the shop, in every real photo and every sky. */
export const SKY_RULES = `Taste (what sells): bright, airy, warm and inviting posters of beautiful places, the kind people hang in their living room. Skies the buyers love: blush pink fading to white, peach to powder blue, light lilac or cotton-candy wisps, a gentle golden hour, a clear summer blue, turquoise sky and water.
Never: dark or moody skies, heavy or grey clouds, storms, night, deep blue hour, fiery or saturated orange-red sunsets, a sun disc burning into the frame, strong vignettes, underexposure, crushed blacks, harsh HDR contrast, oversaturated colour. The picture stays at least as bright and airy as the reference, its shadows soft and open.`

/** The sky part of a brief or prompt: the one asked for, or the art director's choice. */
export function skyText(id: SkyId | undefined, { art = false } = {}) {
  const sky = skyById(id)
  const medium = art ? " Render it in the picture's own medium and manner, as the style would draw a sky." : ""
  if (sky) return `Sky: "${sky.name}": ${sky.prompt}.${medium}`
  return `Sky: your choice. Pick what makes this picture most beautiful and sellable: often the reference's own sky, gently made prettier; or one in the spirit of these (${SKIES.map((s) => s.name.toLowerCase()).join(", ")}), or something just as beautiful. Different images may take different skies.${medium}`
}
