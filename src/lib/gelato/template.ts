import { BLEED_MM, OFFERED, OFFERED_KEYS, sizeOfUid, type Orientation, type SizeKey } from "@/lib/catalog/sizes"

import { getTemplate, keyForStore, type GelatoTemplate, type TemplateVariant } from "./client"

// A Gelato template is the one thing the API can't make: it's set up once in
// Gelato's dashboard (a premium matte poster, the nine offered sizes, one
// image placeholder) and every listing is created from it. Checked here
// before a store uses it, and mapped size by size for each upload.

export type TemplateCheck = {
  id: string
  name: string
  orientation: Orientation | "mixed" | null
  /** Template variant per size it covers. */
  sizes: Partial<Record<SizeKey, { variantId: string; productUid: string; placeholder: string | null }>>
  missing: SizeKey[]
  /** Variants that aren't one of the offered sizes (they'd be published too). */
  extra: string[]
  problems: string[]
  ok: boolean
}

const global = globalThis as typeof globalThis & { __gelatoTemplates?: Map<string, { at: number; template: GelatoTemplate }> }
const cache = (global.__gelatoTemplates ??= new Map())
const TTL = 30 * 60 * 1000

export async function loadTemplate(storeId: string, templateId: string, fresh = false) {
  const hit = cache.get(templateId)
  if (hit && !fresh && Date.now() - hit.at < TTL) return hit.template
  const template = await getTemplate(await keyForStore(storeId), templateId)
  cache.set(templateId, { at: Date.now(), template })
  return template
}

export function mapTemplate(template: GelatoTemplate): TemplateCheck {
  const sizes: TemplateCheck["sizes"] = {}
  const extra: string[] = []
  const orientations = new Set<Orientation>()
  const problems: string[] = []
  for (const variant of template.variants ?? []) {
    const size = sizeOfUid(variant.productUid)
    if (!size || !OFFERED_KEYS.includes(size.key)) {
      extra.push(variant.title || variant.productUid)
      continue
    }
    const hor = variant.productUid.endsWith("_hor")
    orientations.add(hor ? "hor" : "ver")
    if (!variant.productUid.includes("200-gsm-80lb-uncoated")) {
      problems.push(`${size.cm} is on a different paper (${variant.productUid})`)
    }
    // The print files are made for the size plus Gelato's bleed: a placeholder of
    // another shape would have Gelato crop or stretch them.
    const area = variant.imagePlaceholders?.[0]
    const [width, height] = hor ? [size.heightMm, size.widthMm] : [size.widthMm, size.heightMm]
    if (area && (Math.abs(area.width - width - 2 * BLEED_MM) > 1 || Math.abs(area.height - height - 2 * BLEED_MM) > 1)) {
      problems.push(
        `${size.cm}: the image area is ${area.width} x ${area.height} mm, not ${width + 2 * BLEED_MM} x ${height + 2 * BLEED_MM} (the size with ${BLEED_MM} mm bleed)`
      )
    }
    if (sizes[size.key]) problems.push(`${size.cm} appears twice`)
    sizes[size.key] = { variantId: variant.id, productUid: variant.productUid, placeholder: placeholderOf(variant) }
  }
  const missing = OFFERED.filter((s) => !sizes[s.key]).map((s) => s.key)
  if (missing.length) problems.push(`Missing ${missing.length} of the ${OFFERED.length} sizes`)
  if (extra.length) problems.push(`${extra.length} other variant${extra.length === 1 ? "" : "s"} would be published too`)
  if (Object.values(sizes).some((s) => !s?.placeholder)) problems.push("A size has no image placeholder")
  const orientation = orientations.size === 1 ? [...orientations][0] : orientations.size ? "mixed" : null
  if (orientation === "mixed") problems.push("Mixes portrait and landscape")
  return {
    id: template.id,
    name: template.templateName || template.title,
    orientation,
    sizes,
    missing,
    extra,
    problems,
    ok: problems.length === 0,
  }
}

const placeholderOf = (variant: TemplateVariant) => variant.imagePlaceholders?.[0]?.name ?? null

export async function checkTemplate(storeId: string, templateId: string) {
  return mapTemplate(await loadTemplate(storeId, templateId, true))
}
