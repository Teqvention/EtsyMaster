import {
  CREATIVITIES,
  MAX_IDEAS,
  MAX_INSPIRATION,
  MAX_VARIANTS,
  type Creativity,
  type GenerateOptions,
} from "./types"

// Generate options as they arrive over the wire: anything off is clamped or
// dropped rather than refused, the dialog only ever sends sensible values.

const levels = (value: unknown): Creativity[] => {
  const list = Array.isArray(value) ? value.filter((v): v is Creativity => CREATIVITIES.includes(v)) : []
  const unique = [...new Set(list)]
  return unique.length ? unique : ["medium"]
}

const count = (value: unknown, max: number) =>
  Math.max(0, Math.min(max, Math.round(Number.isFinite(value) ? (value as number) : 0)))

export function parseOptions(value: unknown): GenerateOptions | null {
  if (!value || typeof value !== "object") return null
  const v = value as Partial<GenerateOptions>
  const options: GenerateOptions = {
    variants: {
      count: count(v.variants?.count, MAX_VARIANTS),
      creativity: levels(v.variants?.creativity),
      styleId: typeof v.variants?.styleId === "string" && v.variants.styleId ? v.variants.styleId : null,
    },
    ideas: { count: count(v.ideas?.count, MAX_IDEAS), creativity: levels(v.ideas?.creativity) },
    ...(typeof v.feedback === "string" && v.feedback.trim() && { feedback: v.feedback.trim().slice(0, 1000) }),
    ...(Array.isArray(v.posters) && { posters: v.posters.filter(Number.isInteger) }),
    ...(typeof v.from === "string" && v.from && { from: v.from }),
    ...(Array.isArray(v.inspiration) && {
      inspiration: [...new Set(v.inspiration.filter((i): i is string => typeof i === "string" && !!i))].slice(0, MAX_INSPIRATION),
    }),
  }
  // Inspired batches are ideas only, from at least one image.
  if (options.inspiration) {
    if (!options.inspiration.length || !options.ideas.count) return null
    options.variants.count = 0
  }
  if (!options.from && options.variants.count + options.ideas.count === 0) return null
  return options
}
