// Etsy Open API v3 client. Server-side only.
//
// Every Etsy app key has its own quota: 5 requests a second, 5,000 in a
// rolling 24 hours. A request either names its account (an upload account
// writing to its own shop, with the shop owner's OAuth token) or goes to the
// analysis pool: public reads (search, shops, listings) are served by the
// analysis account with the most quota left, so both wear down evenly and the
// upload accounts keep theirs for uploads. A public read may name its own pool
// instead ("Get all listings" with the accounts picked for it); upload
// accounts in it keep RESERVE spare. Requests per key are spaced out here, and
// every public read above this is wrapped in `use cache`.

import { accountsByRole, getKey, getTokens, listAccounts } from "@/lib/accounts/store"

import { accessToken, dropAccessToken } from "./oauth"
import { blockAccount, recordCall, recordUsage, usageOf } from "./usage"

const BASE_URL = "https://openapi.etsy.com/v3/application"
const MIN_INTERVAL_MS = 220 // stays under 5 req/s per key with a little headroom
const MAX_RETRIES = 3
/** Stops a key short of zero, so a run never leaves its account without a request to spare. */
export const RESERVE = 150
const USER_AGENT = "etsy-dashboard/1.0"

export class EtsyApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly account?: string
  ) {
    super(message)
    this.name = "EtsyApiError"
  }
}

// Send times per key, at least MIN_INTERVAL_MS apart, so bursts (a page of
// search results, the open listing, and its shop all loading at once) queue up
// instead of tripping the per-second limit.
const global = globalThis as typeof globalThis & { __etsySlots?: Map<string, number> }
const slots = (global.__etsySlots ??= new Map())

async function throttle(account: string) {
  const now = Date.now()
  const slot = Math.max(now, slots.get(account) ?? 0)
  slots.set(account, slot + MIN_INTERVAL_MS)
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now))
}

type Value = string | number | boolean | undefined | null
export type Params = Record<string, Value>
export type Form = Record<string, Value | Value[]>

export type EtsyRequest = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  /** The account whose key (and, with `auth`, whose shop) the request uses; the analysis pool when absent. */
  account?: string
  /** Without `account`: the accounts a public read may use, in place of the analysis accounts. */
  pool?: string[]
  /** Sends the shop owner's OAuth token: own-shop reads and every write. */
  auth?: boolean
  params?: Params
  /** application/x-www-form-urlencoded; arrays go as `key[]`. */
  form?: Form
  json?: unknown
  multipart?: FormData
}

type Credentials = { account: string; key: string }

const ENV_ACCOUNT = "env"

/**
 * The analysis account (or the account of `chosen`) with the most quota left;
 * .env's key while no analysis account is set up.
 */
async function poolAccount(exclude: Set<string>, chosen?: string[]): Promise<Credentials> {
  const candidates = chosen
    ? (await listAccounts()).filter((a) => chosen.includes(a.id))
    : await accountsByRole("analysis")
  const pool = candidates.filter((a) => !exclude.has(a.id))
  const ranked: { id: string; key: string; left: number }[] = []
  for (const a of pool) {
    const key = await getKey(a.id)
    if (!key) continue
    const usage = await usageOf(a.id)
    if (usage?.blockedUntil) continue
    const left = usage?.remainingToday ?? 5000
    // An upload account lent to research keeps what its uploads need.
    if (a.role === "upload" && left <= RESERVE) continue
    ranked.push({ id: a.id, key: `${key.keystring}:${key.secret}`, left })
  }
  // The emptier key rests; equal ones take turns through the send queue.
  ranked.sort((a, b) => b.left - a.left || (slots.get(a.id) ?? 0) - (slots.get(b.id) ?? 0))
  if (ranked[0]) return { account: ranked[0].id, key: ranked[0].key }

  if (chosen) {
    throw new EtsyApiError(
      429,
      candidates.length ? "The accounts picked are out of Etsy quota for now" : "None of the accounts picked exists any more"
    )
  }
  const key = process.env.ETSY_KEY_STRING
  const secret = process.env.ETSY_SECRET
  if (pool.length === 0 && key && secret && !exclude.has(ENV_ACCOUNT)) {
    return { account: ENV_ACCOUNT, key: `${key}:${secret}` }
  }
  throw new EtsyApiError(
    429,
    pool.length || exclude.size ? "Both analysis accounts are out of Etsy quota for now" : "No analysis account is set up"
  )
}

async function credentials(account: string): Promise<Credentials> {
  const key = await getKey(account)
  if (!key) throw new EtsyApiError(500, `Account ${account} has no Etsy API key`, account)
  return { account, key: `${key.keystring}:${key.secret}` }
}

function buildUrl(path: string, params: Params = {}) {
  const url = new URL(BASE_URL + path)
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value))
  }
  return url
}

function formBody(form: Form) {
  const body = new URLSearchParams()
  for (const [name, value] of Object.entries(form)) {
    if (Array.isArray(value)) {
      for (const v of value) if (v !== undefined && v !== null) body.append(`${name}[]`, String(v))
    } else if (value !== undefined && value !== null) {
      body.append(name, String(value))
    }
  }
  return body
}

/** One Etsy API call, with throttling, quota booking, token refresh and retries. */
export async function etsyRequest<T>(path: string, request: EtsyRequest = {}): Promise<T> {
  const method = request.method ?? "GET"
  if (request.auth && !request.account) throw new EtsyApiError(500, "An authorised request needs its account")
  const url = buildUrl(path, request.params)
  const tried = new Set<string>()
  let refreshed = false

  for (let attempt = 0; ; attempt++) {
    const creds = request.account ? await credentials(request.account) : await poolAccount(tried, request.pool)
    const usage = request.account ? await usageOf(creds.account) : null
    if (usage?.blockedUntil) {
      throw new EtsyApiError(429, `${creds.account} is out of Etsy quota until ${usage.blockedUntil}`, creds.account)
    }

    const headers: Record<string, string> = { "x-api-key": creds.key, "User-Agent": USER_AGENT }
    if (request.auth) headers.Authorization = `Bearer ${await accessToken(creds.account)}`
    let body: BodyInit | undefined
    if (request.form) body = formBody(request.form)
    else if (request.json !== undefined) {
      body = JSON.stringify(request.json)
      headers["Content-Type"] = "application/json"
    } else if (request.multipart) body = request.multipart

    await throttle(creds.account)
    const sentAt = Date.now()
    await recordCall(creds.account, sentAt)
    let res: Response
    try {
      res = await fetch(url, { method, headers, body, ...(method !== "GET" || request.auth ? { cache: "no-store" } : {}) })
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        await sleep(600 * 2 ** attempt)
        continue
      }
      throw new EtsyApiError(503, `Etsy unreachable: ${(error as Error).message}`, creds.account)
    }
    await recordUsage(creds.account, res.headers, sentAt)

    if (res.ok) {
      if (res.status === 204) return undefined as T
      const text = await res.text()
      return (text ? JSON.parse(text) : undefined) as T
    }

    const text = await res.text().catch(() => "")
    const message = errorMessage(text) ?? res.statusText

    if (res.status === 401 && request.auth && !refreshed) {
      refreshed = true
      await dropAccessToken(creds.account)
      continue
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after")) || 0
      const daily = /daily/i.test(message) || Number(res.headers.get("x-remaining-today")) === 0 || wait > 60
      if (daily) {
        await blockAccount(creds.account, Date.now() + Math.max(wait, 600) * 1000)
        // A public read moves on to another account of its pool.
        if (!request.account) {
          tried.add(creds.account)
          continue
        }
        throw new EtsyApiError(429, `${creds.account}: Etsy's daily quota is used up`, creds.account)
      }
      if (attempt < MAX_RETRIES + 2) {
        await sleep(Math.max(wait * 1000, 1000 * 2 ** attempt))
        continue
      }
    }
    // Only reads and idempotent writes are repeated after a server error: a
    // POST that failed late may have created its listing anyway.
    if (res.status >= 500 && attempt < MAX_RETRIES && method !== "POST") {
      await sleep(400 * 2 ** attempt)
      continue
    }
    throw new EtsyApiError(res.status, message, creds.account)
  }
}

function errorMessage(text: string) {
  try {
    const body = JSON.parse(text) as { error?: string; error_description?: string }
    return body.error_description ?? body.error ?? null
  } catch {
    return text.slice(0, 300) || null
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A public read, served by the analysis pool, or by the accounts in `pool`. */
export function etsyGet<T>(path: string, params: Params = {}, pool?: string[]): Promise<T> {
  return etsyRequest<T>(path, { params, pool })
}

/** Whether `account` holds an OAuth grant (doesn't check it with Etsy). */
export async function isConnected(account: string) {
  return !!(await getTokens(account))
}

// --- Wire types: only the fields we read. See the OpenAPI spec for the rest. ---

export type ApiMoney = { amount: number; divisor: number; currency_code: string }

export type ApiListingImage = {
  listing_image_id?: number
  rank: number
  hex_code: string | null
  url_75x75?: string
  url_170x135: string
  url_570xN: string
  url_fullxfull: string
  full_width?: number | null
  full_height?: number | null
}

export type ApiShop = {
  shop_id: number
  shop_name: string
  user_id?: number
  url: string
  icon_url_fullxfull: string | null
  transaction_sold_count: number
  listing_active_count: number
  num_favorers: number
  review_count: number | null
  review_average: number | null
  shop_location_country_iso: string | null
  shipping_from_country_iso: string | null
  currency_code?: string
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
