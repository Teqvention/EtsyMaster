import { etsyGet } from "./client"

// Etsy reports the key's quota on every successful response, so the latest
// headers are the source of truth: they include requests from anything else
// using the same key, and cache hits (which cost nothing) never touch them.
// The daily limit is a rolling 24-hour window, so quota trickles back as old
// requests age out rather than resetting at midnight.

export type EtsyUsage = {
  limitPerDay: number
  remainingToday: number
  /** ISO time Etsy sent the response the numbers came from. */
  updatedAt: string
}

// On globalThis, because route handlers and server components load separate
// copies of this module; both should see one reading.
const store = globalThis as typeof globalThis & {
  __etsyUsage?: EtsyUsage
  __etsyUsagePing?: Promise<unknown>
}

export function recordUsage(headers: Headers) {
  const limit = Number(headers.get("x-limit-per-day"))
  const remaining = Number(headers.get("x-remaining-today"))
  if (!headers.has("x-remaining-today") || !Number.isFinite(remaining)) return
  // Dated by Etsy's `Date` header, not now: in dev, Next replays cached fetch
  // responses (headers and all) after a reload, and those old numbers must
  // not overwrite a newer reading.
  const sent = Date.parse(headers.get("date") ?? "") || Date.now()
  const current = store.__etsyUsage
  if (current && sent < Date.parse(current.updatedAt)) return
  store.__etsyUsage = {
    limitPerDay: limit || current?.limitPerDay || 5000,
    remainingToday: remaining,
    updatedAt: new Date(sent).toISOString(),
  }
}

// Browsing mostly hits the cache, so a reading can sit untouched for hours
// while quota frees up. Past this age, a ping refreshes it: with the
// sidebar's one-minute poll, up to ~1,440 requests a day while the app is open.
const STALE_MS = 60_000

/**
 * The last reading. With none yet (fresh server start) or only a stale one,
 * spends one request on Etsy's ping endpoint to get a fresh one. `force`
 * pings regardless of age.
 */
export async function getUsage(force = false): Promise<EtsyUsage> {
  const usage = store.__etsyUsage
  if (force || !usage || Date.now() - Date.parse(usage.updatedAt) > STALE_MS) {
    store.__etsyUsagePing ??= etsyGet("/openapi-ping").finally(() => {
      store.__etsyUsagePing = undefined
    })
    // A failed refresh still leaves the stale reading to show.
    await store.__etsyUsagePing.catch((error) => {
      if (!usage) throw error
    })
  }
  return store.__etsyUsage!
}
