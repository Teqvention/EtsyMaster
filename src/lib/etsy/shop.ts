// Our own shops' listings, read and changed with the shop owner's OAuth
// token: what the upload pipeline and Artikel's bulk actions work with. Every
// call names its account, so it spends that account's quota and no other.

import { getAccount } from "@/lib/accounts/store"

import { etsyRequest, EtsyApiError, type ApiListingImage, type ApiMoney, type ApiPage, type Form } from "./client"

// --- Wire types: only the fields we read. ---

export type ApiPropertyValue = {
  property_id: number
  property_name: string | null
  scale_id: number | null
  scale_name?: string | null
  value_ids: number[]
  values: string[]
}

export type ApiOffering = {
  offering_id: number
  quantity: number
  is_enabled: boolean
  is_deleted: boolean
  price: ApiMoney
  readiness_state_id?: number | null
}

export type ApiProduct = {
  product_id: number
  sku: string | null
  is_deleted: boolean
  offerings: ApiOffering[]
  property_values: ApiPropertyValue[]
}

export type ApiInventory = {
  products: ApiProduct[]
  price_on_property: number[]
  quantity_on_property: number[]
  sku_on_property: number[]
  readiness_state_on_property?: number[] | null
}

export type ApiListingVideo = {
  video_id: number
  height: number
  width: number
  thumbnail_url: string
  video_url: string
  video_state: string
}

export type ApiOwnListing = {
  listing_id: number
  shop_id: number
  title: string
  description: string
  state: string
  url: string
  quantity: number
  tags: string[]
  materials: string[]
  shop_section_id: number | null
  shipping_profile_id: number | null
  return_policy_id: number | null
  taxonomy_id: number | null
  who_made: string | null
  when_made: string | null
  should_auto_renew: boolean
  has_variations: boolean
  price: ApiMoney
  num_favorers: number
  views?: number
  featured_rank: number | null
  /** Epoch seconds */
  creation_timestamp: number
  original_creation_timestamp: number
  ending_timestamp: number | null
  last_modified_timestamp: number
  state_timestamp: number | null
  images?: (ApiListingImage & { alt_text?: string | null })[]
  videos?: ApiListingVideo[]
  /** Only from getListingsByShop with `includes=Inventory`. */
  inventory?: ApiInventory
  production_partners?: { production_partner_id: number; partner_name: string; location: string }[]
}

export type ApiSection = {
  shop_section_id: number
  title: string
  rank: number
  active_listing_count: number
}

/** The shop an account sells in; only linked accounts have one. */
export async function shopIdOf(account: string) {
  const shop = (await getAccount(account)).shop
  if (!shop) throw new EtsyApiError(400, `${account} isn't linked to an Etsy shop yet`, account)
  return shop.id
}

const owner = (account: string) => ({ account, auth: true })

// --- Listings ---

export type ListingState = "active" | "inactive" | "draft" | "expired" | "sold_out"

/** One of our listings, in any state, with photos and video. */
export function ownListing(account: string, listingId: number, includes: string[] = ["Images", "Videos"]) {
  return etsyRequest<ApiOwnListing>(`/listings/${listingId}`, {
    ...owner(account),
    params: { includes: includes.join(",") },
  })
}

/** A page of the shop's listings in one state. */
export async function ownListings(
  account: string,
  { state = "active", limit = 100, offset = 0, includes = ["Images", "Videos", "Inventory"] }: {
    state?: ListingState
    limit?: number
    offset?: number
    includes?: string[]
  } = {}
) {
  const shopId = await shopIdOf(account)
  return etsyRequest<ApiPage<ApiOwnListing>>(`/shops/${shopId}/listings`, {
    ...owner(account),
    params: { state, limit, offset, includes: includes.join(",") },
  })
}

/** Every listing of the shop in `state`, page after page. */
export async function allOwnListings(account: string, state: ListingState = "active", includes?: string[]) {
  const all: ApiOwnListing[] = []
  for (let offset = 0; ; offset += 100) {
    const page = await ownListings(account, { state, offset, includes })
    all.push(...page.results)
    if (page.results.length < 100 || all.length >= page.count) return all
  }
}

/** What updateListing may change. Arrays replace what's there. */
export type ListingUpdate = {
  title?: string
  description?: string
  tags?: string[]
  materials?: string[]
  /** Photo order: the first is the thumbnail. Up to 20. */
  image_ids?: number[]
  shipping_profile_id?: number
  return_policy_id?: number
  shop_section_id?: number
  taxonomy_id?: number
  production_partner_ids?: number[]
  who_made?: "i_did" | "collective" | "someone_else"
  when_made?: string
  is_supply?: boolean
  should_auto_renew?: boolean
  state?: "active" | "inactive"
  type?: "physical" | "download" | "both"
  featured_rank?: number
}

/**
 * Changes a listing. Lists go comma separated, the way Etsy documents them;
 * tags and materials can't hold a comma, so nothing gets split wrong.
 */
export async function updateListing(account: string, listingId: number, update: ListingUpdate) {
  const shopId = await shopIdOf(account)
  const form: Form = {}
  for (const [name, value] of Object.entries(update)) {
    if (value === undefined) continue
    form[name] = Array.isArray(value) ? value.join(",") : value
  }
  return etsyRequest<ApiOwnListing>(`/shops/${shopId}/listings/${listingId}`, {
    ...owner(account),
    method: "PATCH",
    form,
  })
}

/** Deletes a listing for good (only the pipeline's own test listings). */
export function deleteListing(account: string, listingId: number) {
  return etsyRequest<void>(`/listings/${listingId}`, { ...owner(account), method: "DELETE" })
}

// --- Inventory: the sizes, their prices and SKUs ---

export function getInventory(account: string, listingId: number) {
  return etsyRequest<ApiInventory>(`/listings/${listingId}/inventory`, owner(account))
}

/** updateListingInventory's body: every product, with its offering. */
export type InventoryUpdate = {
  products: {
    sku: string | null
    property_values: Omit<ApiPropertyValue, "scale_name">[]
    offerings: { price: number; quantity: number; is_enabled: boolean; readiness_state_id?: number | null }[]
  }[]
  price_on_property: number[]
  quantity_on_property: number[]
  sku_on_property: number[]
  readiness_state_on_property?: number[]
}

/**
 * The inventory as it can be sent back, with `price` deciding each product's
 * new price (whole currency units, e.g. 24.9). Property values and SKUs go back
 * exactly as they came; Etsy may still give changed products new ids
 * (unverified), so whatever points at product ids is checked afterwards.
 */
export function inventoryUpdate(
  inventory: ApiInventory,
  price: (product: ApiProduct, current: number) => number = (_, current) => current
): InventoryUpdate {
  return {
    products: inventory.products
      .filter((p) => !p.is_deleted)
      .map((p) => ({
        sku: p.sku,
        property_values: p.property_values.map(({ property_id, property_name, scale_id, value_ids, values }) => ({
          property_id,
          property_name,
          scale_id,
          value_ids,
          values,
        })),
        offerings: p.offerings
          .filter((o) => !o.is_deleted)
          .map((o) => ({
            price: Math.round(price(p, o.price.amount / o.price.divisor) * 100) / 100,
            quantity: o.quantity,
            is_enabled: o.is_enabled,
            ...(o.readiness_state_id ? { readiness_state_id: o.readiness_state_id } : {}),
          })),
      })),
    price_on_property: inventory.price_on_property,
    quantity_on_property: inventory.quantity_on_property,
    sku_on_property: inventory.sku_on_property,
    ...(inventory.readiness_state_on_property?.length
      ? { readiness_state_on_property: inventory.readiness_state_on_property }
      : {}),
  }
}

export function updateInventory(account: string, listingId: number, inventory: InventoryUpdate) {
  return etsyRequest<ApiInventory>(`/listings/${listingId}/inventory`, {
    ...owner(account),
    method: "PUT",
    json: inventory,
  })
}

// --- Photos and video ---

const blob = (data: Buffer, type: string) => new Blob([new Uint8Array(data)], { type })

export function listingImages(account: string, listingId: number) {
  return etsyRequest<ApiPage<ApiListingImage & { alt_text?: string | null }>>(
    `/listings/${listingId}/images`,
    owner(account)
  )
}

/** Uploads a JPEG at `rank` (1 is the thumbnail); `overwrite` replaces the photo there. */
export async function uploadImage(
  account: string,
  listingId: number,
  image: Buffer,
  { rank, overwrite = false, altText, name = "photo.jpg" }: { rank: number; overwrite?: boolean; altText?: string; name?: string }
) {
  const shopId = await shopIdOf(account)
  const form = new FormData()
  form.append("image", blob(image, "image/jpeg"), name)
  form.append("rank", String(rank))
  form.append("overwrite", String(overwrite))
  if (altText) form.append("alt_text", altText.slice(0, 500))
  return etsyRequest<ApiListingImage & { alt_text?: string | null }>(`/shops/${shopId}/listings/${listingId}/images`, {
    ...owner(account),
    method: "POST",
    multipart: form,
  })
}

export async function deleteImage(account: string, listingId: number, imageId: number) {
  const shopId = await shopIdOf(account)
  return etsyRequest<void>(`/shops/${shopId}/listings/${listingId}/images/${imageId}`, {
    ...owner(account),
    method: "DELETE",
  })
}

export function listingVideos(account: string, listingId: number) {
  return etsyRequest<ApiPage<ApiListingVideo>>(`/listings/${listingId}/videos`, owner(account))
}

/** Uploads an MP4; a listing has one video, a new one takes the old one's place. */
export async function uploadVideo(account: string, listingId: number, video: Buffer, name = "video.mp4") {
  const shopId = await shopIdOf(account)
  const form = new FormData()
  form.append("video", blob(video, "video/mp4"), name)
  form.append("name", name)
  return etsyRequest<ApiListingVideo>(`/shops/${shopId}/listings/${listingId}/videos`, {
    ...owner(account),
    method: "POST",
    multipart: form,
  })
}

export async function deleteVideo(account: string, listingId: number, videoId: number) {
  const shopId = await shopIdOf(account)
  return etsyRequest<void>(`/shops/${shopId}/listings/${listingId}/videos/${videoId}`, {
    ...owner(account),
    method: "DELETE",
  })
}

// --- Sections ---

export async function shopSections(account: string) {
  const shopId = await shopIdOf(account)
  return (await etsyRequest<ApiPage<ApiSection>>(`/shops/${shopId}/sections`, owner(account))).results
}

export async function createSection(account: string, title: string) {
  const shopId = await shopIdOf(account)
  return etsyRequest<ApiSection>(`/shops/${shopId}/sections`, {
    ...owner(account),
    method: "POST",
    form: { title },
  })
}
