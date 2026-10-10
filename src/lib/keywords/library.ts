import { readDoc, updateDoc } from "@/lib/db/documents"
import { getStoredAnalysis } from "@/lib/shops/analysis-store"

import type {
  KeywordInsight,
  KeywordListing,
  LibraryAnalysis,
  LibraryOverview,
  LibraryShop,
  LibraryShopRequest,
  LibraryShopSummary,
  LibraryStats,
} from "./types"

export type { KeywordInsight } from "./types"

// The keyword library (the document "keywords/library") and everything read
// out of it: tag and title-phrase statistics for the Keywords page, and the
// keywords relevant to a listing for the upload pipeline. Statistics are
// worked out once per version of the library and kept in memory.

const FILE = "keywords/library"

/** Top sellers: the best fifth of a shop's listings by sales per month. */
const TOP_SHARE = 0.2

/** Listings first published within this count as new, for a keyword's trend. */
const RECENT_MS = 365 * 24 * 60 * 60 * 1000

type Library = { version: 1; shops: LibraryShop[]; analysis: LibraryAnalysis | null }

type Stats = { tags: KeywordInsight[]; phrases: KeywordInsight[]; averageSalesPerMonth: number }

type Store = {
  /** The statistics, and the library they were worked out from. */
  stats: { of: Library; stats: Stats } | null
  /** Listing dates filled in from the shops' stored analyses, once per start. */
  dated?: Promise<void>
}

// On globalThis, so every route (and a dev reload) shares the one copy.
const global = globalThis as typeof globalThis & { __keywordLibrary?: Store }
const memo = (global.__keywordLibrary ??= { stats: null })

const EMPTY: Library = { version: 1, shops: [], analysis: null }

/** The library as it is now. Shared: never change what this answers. */
async function readLibrary(): Promise<Library> {
  const saved = await readDoc<Library | null>(FILE, null)
  return Array.isArray(saved?.shops) ? saved : EMPTY
}

/** Applies `change` and writes the library, after every other change on any server. */
function update(change: (library: Library) => Library) {
  return updateDoc<Library | null>(FILE, null, (saved) => {
    const library = Array.isArray(saved?.shops) ? saved : EMPTY
    return change({ ...library, analysis: library.analysis ?? null })
  }) as Promise<Library>
}

// --- Shops ---

/** Adds the shop with its analysed listings, or replaces what was there. */
export async function addShop({ shop, listings }: LibraryShopRequest) {
  const now = new Date().toISOString()
  // Top sellers by rank, so a shop of near-equal listings still has some.
  const ranked = [...listings].sort((a, b) => b.salesPerMonth - a.salesPerMonth)
  const cut = Math.max(1, Math.ceil(ranked.length * TOP_SHARE))
  const top = new Set(ranked.slice(0, cut).filter((l) => l.salesPerMonth > 0).map((l) => l.id))
  await update((library) => {
    const existing = library.shops.find((s) => s.id === shop.id)
    const entry: LibraryShop = {
      ...shop,
      addedAt: existing?.addedAt ?? now,
      updatedAt: now,
      listings: listings.map((l) => ({
        ...l,
        tags: [...new Set(l.tags.map(normalise).filter(Boolean))],
        top: top.has(l.id),
      })),
    }
    return { ...library, shops: [entry, ...library.shops.filter((s) => s.id !== shop.id)] }
  })
  return overview()
}

export async function removeShop(shopId: number) {
  await update((library) => ({ ...library, shops: library.shops.filter((s) => s.id !== shopId) }))
  return overview()
}

/** When each shop in the library was last updated, for the shop page's button. */
export async function libraryMembership(shopId: number) {
  const shop = (await readLibrary()).shops.find((s) => s.id === shopId)
  return shop ? { updatedAt: shop.updatedAt, listings: shop.listings.length } : null
}

// --- Statistics ---

async function stats(): Promise<Stats> {
  // Worked out afresh once the dates are in, also when a dev reload kept
  // statistics an older version of this file made.
  memo.dated ??= fillDates().finally(() => {
    memo.stats = null
  })
  await memo.dated
  const library = await readLibrary()
  if (memo.stats?.of !== library) memo.stats = { of: library, stats: compute(library.shops) }
  return memo.stats.stats
}

/**
 * Listings added before their first-published date was kept get it from the
 * shop's stored analysis (shops/<id>), which has it for every listing.
 */
async function fillDates() {
  try {
    const library = await readLibrary()
    const dates = new Map<number, string>()
    for (const shop of library.shops) {
      if (shop.listings.every((l) => l.createdAt)) continue
      const analysis = await getStoredAnalysis(shop.id)
      for (const l of analysis?.listings ?? []) if (l.createdAt) dates.set(l.id, l.createdAt)
    }
    if (!dates.size) return
    await update((current) => ({
      ...current,
      shops: current.shops.map((shop) => ({
        ...shop,
        listings: shop.listings.map((l) => (l.createdAt || !dates.has(l.id) ? l : { ...l, createdAt: dates.get(l.id) })),
      })),
    }))
  } catch (error) {
    console.warn("Keyword library: no listing dates", error)
  }
}

function compute(shops: LibraryShop[]): Stats {
  type Tally = {
    keyword: string
    listings: number
    shops: Set<number>
    sales: number
    /** Sales, each listing's weighed by how established its shop is. */
    weighted: number
    /** Each listing's sales squared, summed: tells one hit from many sellers. */
    squares: number
    top: number
    /** Each listing's sales against its shop's average, summed. */
    relative: number
    /** Listings first published in the last year, and the top sellers among them. */
    recent: number
    recentTop: number
  }
  type Use = { shopId: number; weight: number; perMonth: number; relative: number; recent: boolean; top: boolean }
  const tags = new Map<string, Tally>()
  const phrases = new Map<string, Tally>()
  let listings = 0
  let sales = 0
  let top = 0
  let recent = 0
  let recentTop = 0
  const now = Date.now()

  const count = (map: Map<string, Tally>, keyword: string, use: Use) => {
    const tally = map.get(keyword) ?? {
      keyword,
      listings: 0,
      shops: new Set<number>(),
      sales: 0,
      weighted: 0,
      squares: 0,
      top: 0,
      relative: 0,
      recent: 0,
      recentTop: 0,
    }
    tally.listings++
    tally.shops.add(use.shopId)
    tally.sales += use.perMonth
    tally.weighted += use.weight * use.perMonth
    tally.squares += use.perMonth ** 2
    tally.relative += use.relative
    if (use.recent) tally.recent++
    if (use.top) tally.top++
    if (use.recent && use.top) tally.recentTop++
    map.set(keyword, tally)
  }

  for (const shop of shops) {
    const average = shop.listings.reduce((n, l) => n + l.salesPerMonth, 0) / (shop.listings.length || 1)
    // A shop with a long record counts fully, a new one's estimates for less.
    const weight = 0.6 + 0.4 * Math.min(1, Math.log10(1 + shop.totalSales) / 5)
    for (const listing of shop.listings) {
      listings++
      sales += listing.salesPerMonth
      const use: Use = {
        shopId: shop.id,
        weight,
        perMonth: listing.salesPerMonth,
        relative: average > 0 ? listing.salesPerMonth / average : 1,
        recent: !!listing.createdAt && now - Date.parse(listing.createdAt) < RECENT_MS,
        top: listing.top,
      }
      if (listing.top) top++
      if (use.recent) recent++
      if (use.recent && listing.top) recentTop++
      for (const tag of new Set(listing.tags.map(normalise))) {
        if (tag) count(tags, tag, use)
      }
      for (const phrase of titlePhrases(listing.title)) {
        count(phrases, phrase, use)
      }
    }
  }
  // How often new and older listings make it into their shop's top sellers:
  // a keyword's trend compares its own new and older ones against these.
  const newer = recent ? recentTop / recent : 0
  const older = listings > recent ? (top - recentTop) / (listings - recent) : 0

  const finish = (map: Map<string, Tally>, kind: KeywordInsight["kind"]): KeywordInsight[] => {
    const rows = [...map.values()].map((t) => {
      const topShare = t.top / t.listings
      // How many listings carry its sales, as if evenly: one hit is one.
      const spread = t.squares > 0 ? t.sales ** 2 / t.squares : 0
      // Evened out towards 1 (its shops' average) while few listings use it.
      const lift = (t.relative + 10) / (t.listings + 10)
      // Evened out towards 1 too; 1 without listings of both ages.
      const trend =
        newer > 0 && older > 0
          ? (t.recentTop + 5 * newer) / ((t.recent + 5) * newer) /
            ((t.top - t.recentTop + 5 * older) / ((t.listings - t.recent + 5) * older))
          : 1
      // Sales carried by the keyword, more for keywords that keep showing up
      // on top sellers, across shops and in established ones; less when one
      // hit carries it all. Nudged up when its listings outsell their shop
      // and when its new ones do better than its older ones, down when the
      // opposite.
      const raw =
        Math.log1p(t.weighted) *
        (0.6 + 0.8 * topShare) *
        (1 + 0.25 * Math.log(t.shops.size)) *
        (spread / (spread + 1.5)) *
        clamp(lift, 0.5, 3) ** 0.35 *
        clamp(trend, 0.85, 1.2)
      return {
        keyword: t.keyword,
        kind,
        listings: t.listings,
        shops: t.shops.size,
        salesPerMonth: round(t.sales),
        avgSalesPerMonth: round(t.sales / t.listings),
        topShare: round(topShare, 3),
        score: raw,
        lift: round(lift),
        trend: round(trend),
      }
    })
    const best = Math.max(...rows.map((r) => r.score), 0) || 1
    return rows
      .map((r) => ({ ...r, score: Math.round((r.score / best) * 100) }))
      .sort((a, b) => b.score - a.score || b.salesPerMonth - a.salesPerMonth)
  }

  return {
    tags: finish(tags, "tag"),
    // A phrase only one listing uses is that listing's name, not a keyword.
    phrases: finish(phrases, "phrase").filter((p) => p.listings > 1),
    averageSalesPerMonth: listings ? round(sales / listings) : 0,
  }
}

export async function libraryStats(): Promise<LibraryStats> {
  const library = await readLibrary()
  const { tags, phrases } = await stats()
  return {
    shops: library.shops.length,
    listings: library.shops.reduce((n, s) => n + s.listings.length, 0),
    keywords: tags.length + phrases.length,
  }
}

/** Everything the Keywords page shows; the long tails are cut. */
export async function overview(): Promise<LibraryOverview> {
  const library = await readLibrary()
  const { tags, phrases, averageSalesPerMonth } = await stats()
  const shops: LibraryShopSummary[] = library.shops.map(({ listings, ...shop }) => ({
    ...shop,
    listings: listings.length,
    topSellers: listings.filter((l) => l.top).length,
    salesPerMonth: round(listings.reduce((n, l) => n + l.salesPerMonth, 0)),
  }))
  return {
    stats: await libraryStats(),
    shops,
    averageSalesPerMonth,
    tags: tags.slice(0, 1500),
    phrases: phrases.slice(0, 600),
    analysis: library.analysis,
  }
}

/** The listings using a keyword, best selling first. */
export async function keywordListings(keyword: string, kind: KeywordInsight["kind"], limit = 60) {
  const library = await readLibrary()
  const needle = normalise(keyword)
  const found: KeywordListing[] = []
  for (const shop of library.shops) {
    for (const l of shop.listings) {
      const uses =
        kind === "tag" ? l.tags.some((t) => normalise(t) === needle) : titlePhrases(l.title).includes(needle)
      if (uses) {
        found.push({
          id: l.id,
          title: l.title,
          salesPerMonth: l.salesPerMonth,
          revenuePerMonthCents: l.revenuePerMonthCents,
          priceCents: l.priceCents,
          url: l.url,
          thumb: l.thumb,
          top: l.top,
          shop: shop.name,
        })
      }
    }
  }
  return found.sort((a, b) => b.salesPerMonth - a.salesPerMonth).slice(0, limit)
}

// --- For the upload pipeline ---

/**
 * Keywords from the library that fit a listing (by the words they share with
 * its title and tags), strongest first. Those about what the poster itself
 * shows (`focus`) count for more; those with an `exclude` word (the source's
 * subject, when ours has another) don't fit at all. Topped up with the
 * library's best keywords overall when few fit, so there is always something
 * to learn from. Shared: never change what this answers.
 */
export async function keywordContext(query: KeywordQuery, limit = 40): Promise<KeywordInsight[]> {
  const statistics = await stats()
  let held = answers.get(statistics)
  if (!held) answers.set(statistics, (held = new Map()))
  const key = JSON.stringify([query.title, query.tags, query.focus, query.exclude, limit])
  let answer = held.get(key)
  if (!answer) {
    if (held.size >= MAX_ANSWERS) held.clear()
    held.set(key, (answer = fitting(statistics, query, limit)))
  }
  return answer
}

type KeywordQuery = { title: string; tags: string[]; focus?: string; exclude?: string[] }

// Answers kept per version of the statistics: the Uploads page asks the same
// for every draft each time it looks, every couple of seconds while copy is written.
const answers = new WeakMap<Stats, Map<string, KeywordInsight[]>>()
const MAX_ANSWERS = 2000

function fitting({ tags, phrases }: Stats, query: KeywordQuery, limit: number) {
  const focus = new Set(wordsOf(query.focus ?? "").filter((w) => !GENERIC.has(w)))
  const exclude = new Set((query.exclude ?? []).flatMap(wordsOf))
  const words = new Set([...wordsOf(query.title), ...query.tags.flatMap(wordsOf), ...focus])
  const exact = new Set(query.tags.map(normalise))
  const excluded = (own: string[]) => own.some((w) => exclude.has(w))
  if (words.size === 0 && exact.size === 0) return tags.filter((t) => !excluded(keywordWords(t).own)).slice(0, limit)

  const relevant: { insight: KeywordInsight; weight: number }[] = []
  for (const insight of [...tags, ...phrases]) {
    const { own, telling } = keywordWords(insight)
    if (own.length === 0 || excluded(own)) continue
    const shared = own.filter((w) => words.has(w)).length / own.length
    const relevance = exact.has(insight.keyword) ? 1 : shared
    // At least half of a keyword's words have to fit the listing; one whose
    // telling words don't all fit ("funny cat" on a pig) counts half, one
    // with no telling word at all ("wall decor") little more.
    if (relevance < 0.5) continue
    const whole = exact.has(insight.keyword) || telling.every((w) => words.has(w))
    const shown = telling.length ? telling.filter((w) => focus.has(w)).length / telling.length : 0
    const weight =
      insight.score * (0.4 + 0.6 * relevance) * (whole ? 1 : 0.5) * (telling.length ? 1 : 0.6) * (1 + shown)
    relevant.push({ insight, weight })
  }
  const picked = relevant
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((r) => r.insight)

  if (picked.length < limit / 2) {
    const have = new Set(picked.map((p) => `${p.kind}:${p.keyword}`))
    for (const tag of tags) {
      if (picked.length >= limit) break
      if (!have.has(`tag:${tag.keyword}`) && tag.shops > 1 && !excluded(keywordWords(tag).own)) picked.push(tag)
    }
  }
  return picked
}

/** The latest AI read of the library as plain text, if there is one. */
export async function libraryInsights(): Promise<string | null> {
  const { analysis } = await readLibrary()
  if (!analysis) return null
  const a = analysis.insights
  const lines = [
    `Keyword library analysis (${analysis.basis.shops} shops, ${analysis.basis.listings} listings, ${analysis.createdAt.slice(0, 10)}):`,
    a.summary,
    "",
    "Winning patterns:",
    ...a.winningPatterns.map((p) => `- ${p.title}: ${p.detail}${p.examples.length ? ` (e.g. ${p.examples.join("; ")})` : ""}`),
    "",
    "Title structures that sell:",
    ...a.titleStructures.map((t) => `- ${t.pattern} — ${t.why} Example: ${t.example}`),
    "",
    "Tag strategies:",
    ...a.tagStrategies.map((t) => `- ${t.strategy}: ${t.detail}${t.tags.length ? ` (${t.tags.join(", ")})` : ""}`),
    "",
    "Gaps and opportunities:",
    ...a.gaps.map((g) => `- ${g.opportunity}: ${g.detail}${g.keywords.length ? ` (${g.keywords.join(", ")})` : ""}`),
    "",
    "Avoid:",
    ...a.avoid.map((x) => `- ${x.pattern}: ${x.why}`),
  ]
  return lines.join("\n")
}

/** Stores a new AI analysis made from the library as it is now. */
export async function saveAnalysis(insights: LibraryAnalysis["insights"]) {
  const { shops, listings } = await libraryStats()
  await update((library) => ({
    ...library,
    analysis: { insights, createdAt: new Date().toISOString(), basis: { shops, listings } },
  }))
  return overview()
}

/** What the AI analysis is made from: the strongest keywords and titles, and some that don't sell. */
export async function analysisDigest() {
  const library = await readLibrary()
  const { tags, phrases, averageSalesPerMonth } = await stats()
  const all = library.shops.flatMap((s) => s.listings.map((l) => ({ ...l, shop: s.name })))
  const best = [...all].sort((a, b) => b.salesPerMonth - a.salesPerMonth)
  const weak = all.filter((l) => l.salesPerMonth < averageSalesPerMonth * 0.15).slice(0, 25)
  const row = (k: KeywordInsight) =>
    `${k.keyword} | listings ${k.listings} | shops ${k.shops} | sales/mo ${k.salesPerMonth} | avg ${k.avgSalesPerMonth} | top ${Math.round(k.topShare * 100)}% | score ${k.score}`
  return {
    stats: await libraryStats(),
    text: [
      `Shops: ${library.shops.map((s) => `${s.name} (${s.listings.length} listings, ${s.totalSales} lifetime sales)`).join("; ")}`,
      `Average estimated sales per listing per month: ${averageSalesPerMonth}`,
      "",
      "TOP TAGS (keyword | listings | shops | est. sales/mo summed | avg per listing | share of top sellers | score):",
      ...tags.slice(0, 80).map(row),
      "",
      "TOP TITLE PHRASES (same columns):",
      ...phrases.slice(0, 50).map(row),
      "",
      "BEST SELLING LISTINGS (est. sales/mo — title — tags):",
      ...best.slice(0, 40).map((l) => `${round(l.salesPerMonth)} — ${l.title} — ${l.tags.join(", ")}`),
      "",
      "LISTINGS THAT BARELY SELL (for contrast):",
      ...weak.map((l) => `${round(l.salesPerMonth)} — ${l.title} — ${l.tags.join(", ")}`),
    ].join("\n"),
  }
}

// --- Words ---

/** Lower case, single spaces, no stray punctuation at either end. */
export function normalise(text: string) {
  return text
    .toLowerCase()
    .replace(/[“”"«»]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—.,:;!?()[\]{}'*#]+|[\s\-–—.,:;!?()[\]{}'*#]+$/g, "")
}

/** Etsy titles are lists of keyword phrases: split on the usual separators. */
export function titlePhrases(title: string) {
  const parts = title
    .split(/\s*[|,•·–—;:]\s*|\s+-\s+|\s+\/\s+/)
    .map(normalise)
    // A word to it, not a size list like "a1/a2/a3/a4".
    .filter((p) => p.length >= 3 && p.length <= 60 && /\p{L}{3}/u.test(p))
  return [...new Set(parts)]
}

const STOPWORDS = new Set(["and", "the", "for", "with", "you", "your", "from", "this", "that", "our"])

/** Words most wall art keywords have: they say nothing about what a poster shows. */
const GENERIC = new Set(["art", "print", "poster", "wall", "decor", "artwork", "gift", "home", "printable", "picture"])

/** Content words, lightly singularised so "posters" meets "poster" and "pigs" "pig". */
function wordsOf(text: string) {
  return normalise(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
}

// A library keyword's words, worked out once per version of the statistics:
// the Uploads page weighs every keyword for every draft each time it looks.
const wordsOfKeyword = new WeakMap<KeywordInsight, { own: string[]; telling: string[] }>()

function keywordWords(insight: KeywordInsight) {
  let held = wordsOfKeyword.get(insight)
  if (!held) {
    const own = wordsOf(insight.keyword)
    held = { own, telling: own.filter((w) => !GENERIC.has(w)) }
    wordsOfKeyword.set(insight, held)
  }
  return held
}

function round(n: number, digits = 2) {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max)
