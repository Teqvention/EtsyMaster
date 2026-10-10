import { etsyGet, type ApiListing, type ApiPage } from "@/lib/etsy/client"
import { estimateSales } from "@/lib/etsy/estimate"
import { readDoc, updateDoc } from "@/lib/db/documents"

import { normalise } from "./library"
import type { KeywordDemand } from "./types"

// What Etsy's live search says about a phrase, beyond the library's shops:
// how many active listings compete for it, and how the best sellers among
// its most relevant ones sell (estimated like every other listing; the API's
// relevance isn't the buyers' search, so the few best of 25 tell more than
// all of them). One search per phrase on the analysis pool's quota, kept two
// weeks in the "keywords/demand" document, so the copywriter can weigh a few lead
// phrases per listing without wearing the quota down.

const FILE = "keywords/demand"
const KEEP_MS = 14 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
/** Listings read per search, and how many of the best selling of them count. */
const SAMPLE = 25
const BEST = 5

type Known = Record<string, KeywordDemand>

const fresh = (demand: KeywordDemand | undefined, now: number): demand is KeywordDemand =>
  !!demand && now - Date.parse(demand.checkedAt) < KEEP_MS

/**
 * Demand for each phrase, from what's kept or one search each, at most
 * `maxSearches` of them; phrases left over, or whose search failed, are
 * missing from the answer.
 */
export async function checkDemand(phrases: string[], maxSearches = 5): Promise<KeywordDemand[]> {
  const wanted = [...new Set(phrases.map(normalise).filter((p) => p.length >= 3))]
  if (!wanted.length) return []
  const now = Date.now()
  const known = await readDoc<Known>(FILE, {})
  const found = new Map<string, KeywordDemand>()
  const unknown: string[] = []
  for (const phrase of wanted) {
    if (fresh(known[phrase], now)) found.set(phrase, known[phrase])
    else unknown.push(phrase)
  }
  // All at once (etsyRequest spaces them out per key). A failed search uses
  // one up too: then the quota or the API is the trouble, not the phrase.
  const searched = (
    await Promise.all(
      unknown.slice(0, maxSearches).map((phrase) =>
        searchOnce(phrase).catch((error) => {
          console.warn(`Keyword demand "${phrase}":`, error instanceof Error ? error.message : error)
          return null
        })
      )
    )
  ).filter((d): d is KeywordDemand => !!d)
  for (const demand of searched) found.set(demand.phrase, demand)
  if (searched.length) {
    await updateDoc<Known>(FILE, {}, (current) => {
      const kept = Object.entries(current).filter(([, d]) => fresh(d, now))
      return Object.fromEntries([...kept, ...searched.map((d) => [d.phrase, d] as const)])
    })
  }
  return wanted.flatMap((p) => found.get(p) ?? [])
}

// On globalThis, so listings written side by side (and a dev reload) share them.
const global = globalThis as typeof globalThis & { __demandSearches?: Map<string, Promise<KeywordDemand>> }
const searching = (global.__demandSearches ??= new Map())

/** One search per phrase, shared by listings asking at once. */
function searchOnce(phrase: string): Promise<KeywordDemand> {
  let found: Promise<KeywordDemand> | undefined = searching.get(phrase)
  if (!found) {
    found = search(phrase).finally(() => searching.delete(phrase))
    searching.set(phrase, found)
  }
  return found
}

async function search(phrase: string): Promise<KeywordDemand> {
  const page = await etsyGet<ApiPage<ApiListing>>("/listings/active", {
    keywords: phrase,
    limit: SAMPLE,
    sort_on: "score",
  })
  const now = Date.now()
  const sales = page.results
    .map(
      (l) =>
        estimateSales({
          priceCents: Math.round((l.price.amount / l.price.divisor) * 100),
          favorites: l.num_favorers,
          views: l.views ?? 0,
          reviewCount: null,
          ageDays: (now - l.original_creation_timestamp * 1000) / DAY_MS,
          shopTotalSales: null,
        }).salesPerMonth
    )
    .sort((a, b) => b - a)
    .slice(0, BEST)
  const salesPerMonth = sales.length ? sales.reduce((a, b) => a + b, 0) / BEST : 0
  return {
    phrase,
    results: page.count,
    salesPerMonth: Math.round(salesPerMonth * 100) / 100,
    // What its best sellers sell, against how crowded the phrase is; ten
    // times as many competitors halves a phrase's chance, roughly.
    score: Math.round(((salesPerMonth * 10) / Math.log10(page.count + 10)) * 100) / 100,
    checkedAt: new Date(now).toISOString(),
  }
}
