import type { Account } from "@/lib/accounts/types"
import { OFFERED, OFFERED_KEYS, productUid, sizeOfLabel, type Orientation } from "@/lib/catalog/sizes"
import { inventoryUpdate, type ApiInventory, type ApiProduct, type InventoryUpdate, type ListingUpdate } from "@/lib/etsy/shop"
import type { CreateFromTemplate } from "@/lib/gelato/client"
import type { TemplateCheck } from "@/lib/gelato/template"
import type { PriceProfile } from "@/lib/pricing/types"

import { Fatal } from "./errors"
import type { ListingText } from "./listing-text"
import type { PrintFile } from "./types"

// What the pipeline sends: the Gelato product request, and the Etsy listing
// fields and prices. Built the same way for a live run and a test run, so a
// test run's payloads are what a live one would send.

/** Where a print file goes on the hosting: its hash in the name, so a key never changes content. */
export const printKey = (itemId: string, file: PrintFile) => `prints/${itemId}/${file.bandId}-${file.sha}.jpg`

/** The Gelato product: each of the template's sizes with its print file, hidden in the shop until we've put it right. */
export function gelatoBody(
  templateId: string,
  sizes: TemplateCheck["sizes"],
  text: ListingText,
  files: PrintFile[],
  url: (file: PrintFile) => string
): CreateFromTemplate {
  const variants = OFFERED_KEYS.flatMap((key) => {
    const variant = sizes[key]
    const file = files.find((f) => f.sizes.includes(key))
    if (!variant?.placeholder || !file) return []
    return [{ templateVariantId: variant.variantId, imagePlaceholders: [{ name: variant.placeholder, fileUrl: url(file) }] }]
  })
  return {
    templateId,
    title: text.title,
    description: text.description,
    isVisibleInTheOnlineStore: false,
    tags: text.tags,
    variants,
  }
}

/** Stand-ins for a template a test run can't read (the account has none yet). */
export function placeholderSizes(orientation: Orientation): TemplateCheck["sizes"] {
  return Object.fromEntries(
    OFFERED.map((s) => [s.key, { variantId: `<template variant for ${s.cm}>`, productUid: productUid(s, orientation), placeholder: "<placeholder>" }])
  )
}

/** Our text and the account's listing defaults; null defaults leave Gelato's choice alone. */
export function listingUpdate(account: Account, text: ListingText): ListingUpdate {
  const d = account.listing
  return {
    title: text.title,
    description: text.description,
    tags: text.tags,
    materials: text.materials,
    who_made: d.whoMade,
    when_made: d.whenMade,
    is_supply: false,
    should_auto_renew: d.shouldAutoRenew,
    taxonomy_id: d.taxonomyId,
    ...(d.shippingProfileId != null && { shipping_profile_id: d.shippingProfileId }),
    ...(d.returnPolicyId != null && { return_policy_id: d.returnPolicyId }),
    ...(d.shopSectionId != null && { shop_section_id: d.shopSectionId }),
    ...(d.productionPartnerIds.length > 0 && { production_partner_ids: d.productionPartnerIds }),
  }
}

/** The size an Etsy product sells, read off its variation values. */
export function sizeOfProduct(product: Pick<ApiProduct, "property_values">) {
  for (const property of product.property_values) {
    for (const value of property.values) {
      const size = sizeOfLabel(value)
      if (size) return size
    }
  }
  return null
}

/**
 * The inventory with the profile's prices (and the account's processing
 * profile, when it names one). SKUs and variation values go back as they
 * came; Etsy may still give re-priced products new ids (unverified).
 */
export function pricedInventory(inventory: ApiInventory, profile: PriceProfile, readinessStateId: number | null): InventoryUpdate {
  const unknown: string[] = []
  const update = inventoryUpdate(inventory, (product, current) => {
    const size = sizeOfProduct(product)
    if (size) return profile.prices[size.key] / 100
    unknown.push(product.property_values.flatMap((p) => p.values).join(" / ") || `product ${product.product_id}`)
    return current
  })
  if (unknown.length) throw new Fatal(`Sizes on the Etsy listing that aren't ours: ${unknown.join(", ")}`)
  // A price per size needs the size property to carry prices.
  const sizeProperty = inventory.products
    .find((p) => !p.is_deleted)
    ?.property_values.find((p) => p.values.some((v) => sizeOfLabel(v)))?.property_id
  if (sizeProperty != null && !update.price_on_property.includes(sizeProperty)) {
    update.price_on_property = [...update.price_on_property, sizeProperty]
  }
  if (readinessStateId) {
    for (const product of update.products) for (const offering of product.offerings) offering.readiness_state_id = readinessStateId
  }
  return update
}

/** Sizes whose price on Etsy isn't the profile's, as "13 x 18 cm". */
export function priceDrift(inventory: ApiInventory, profile: PriceProfile) {
  const off: string[] = []
  for (const product of inventory.products) {
    if (product.is_deleted) continue
    const size = sizeOfProduct(product)
    const offering = product.offerings.find((o) => !o.is_deleted)
    if (!size || !offering) continue
    const cents = Math.round((offering.price.amount / offering.price.divisor) * 100)
    if (cents !== profile.prices[size.key]) off.push(size.cm)
  }
  return off
}

/** Whether an offering's processing profile isn't `readinessStateId` (null leaves them as they are). */
export const readinessDrift = (inventory: ApiInventory, readinessStateId: number | null) =>
  !!readinessStateId &&
  inventory.products.some(
    (p) => !p.is_deleted && p.offerings.some((o) => !o.is_deleted && o.readiness_state_id !== readinessStateId)
  )

/** What a test run shows of the prices: per size, as Etsy will list it. */
export function pricePreview(profile: PriceProfile | null) {
  return {
    profile: profile?.name ?? null,
    currency: profile?.currency ?? null,
    sizes: OFFERED.map((s) => ({ size: s.cm, price: profile ? (profile.prices[s.key] / 100).toFixed(2) : null })),
  }
}

export const productIds = (inventory: ApiInventory) =>
  inventory.products.filter((p) => !p.is_deleted).map((p) => p.product_id)
