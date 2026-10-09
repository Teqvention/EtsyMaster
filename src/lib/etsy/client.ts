// Minimal Etsy Open API v3 client for public, API-key-only endpoints.
// Server-side only: it reads the app's key and shared secret from the env.
//
// The key is limited to 5 requests/second and 5,000/day, so requests are
// spaced out here and every caller above this is wrapped in `use cache`.

import { recordUsage } from "./usage"

const BASE_URL ="https://openapi.etsy.com/v3/application"
const MIN_INTERVAL_MS = 220 // stays under 5 req/s with a little headroom
const MAX_RETRIES = 3

export class EtsyApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = "EtsyApiError"
  }
}

let nextSlot = 0

// Hands out send times at least MIN_INTERVAL_MS apart, so bursts (a page of
// search results, the open listing, and its shop all loading at once) queue up
// instead of tripping the per-second limit.
async function throttle() {
  const now = Date.now()
  const slot = Math.max(now, nextSlot)
  nextSlot = slot + MIN_INTERVAL_MS
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now))
}

type Params = Record<string, string | number | boolean | undefined | null>

export async function etsyGet<T>(path: string, params: Params = {}): Promise<T> {
  const key = process.env.ETSY_KEY_STRING
  const secret = process.env.ETSY_SECRET
  if (!key || !secret) {
    throw new EtsyApiError(500, "ETSY_KEY_STRING and ETSY_SECRET must be set in .env")
  }

  const url = new URL(BASE_URL + path)
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(name, String(value))
    }
  }

  for (let attempt = 0; ; attempt++) {
    await throttle()
    const res = await fetch(url, {
      headers: { "x-api-key": `${key}:${secret}` },
    })

    recordUsage(res.headers)
    if (res.ok) return (await res.json()) as T

    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
      continue
    }

    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new EtsyApiError(res.status, body?.error ?? res.statusText)
  }
}

// --- Wire types: only the fields we read. See the OpenAPI spec for the rest. ---

export type ApiMoney = { amount: number; divisor: number; currency_code: string }

export type ApiListingImage = {
  rank: number
  hex_code: string | null
  url_170x135: string
  url_570xN: string
  url_fullxfull: string
}

export type ApiShop = {
  shop_id: number
  shop_name: string
  url: string
  icon_url_fullxfull: string | null
  transaction_sold_count: number
  listing_active_count: number
  num_favorers: number
  review_count: number | null
  review_average: number | null
  shop_location_country_iso: string | null
  shipping_from_country_iso: string | null
  create_date: number
}

export type ApiListing = {
  listing_id: number
  shop_id: number
  title: string
  url: string
  price: ApiMoney
  converted_price?: ApiMoney | null
  num_favorers: number
  /** Not in the published schema, but returned by search and batch. */
  views?: number
  quantity: number
  tags: string[]
  materials: string[]
  is_personalizable: boolean
  listing_type: string
  original_creation_timestamp: number
  last_modified_timestamp: number
  images?: ApiListingImage[]
  shop?: ApiShop
}

export type ApiReview = {
  listing_id: number
  transaction_id: number
  rating: number
  created_timestamp: number
}

export type ApiPage<T> = { count: number; results: T[] }
