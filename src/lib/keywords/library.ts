import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

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

// The keyword library on disk (data/keywords/library.json) and everything
// read out of it: tag and title-phrase statistics for the Keywords page, and
// the keywords relevant to a listing for the upload pipeline. Statistics are
// worked out once per change of the library and kept in memory.

const ROOT = path.join(process.cwd(), "data", "keywords")
const FILE = path.join(ROOT, "library.json")

/** Top sellers: the best fifth of a shop's listings by sales per month. */
const TOP_SHARE = 0.2

type Library = { version: 1; shops: LibraryShop[]; analysis: LibraryAnalysis | null }

type Stats = { tags: KeywordInsight[]; phrases: KeywordInsight[]; averageSalesPerMonth: number }

type Store = {
  library: Library
  stats: Stats | null
  write: Promise<void>
}

// On globalThis, so every route (and a dev reload) shares the one copy.
const global = globalThis as typeof globalThis & { __keywordLibrary?: Promise<Store> }

function store() {
  global.__keywordLibrary ??= load()
  return global.__keywordLibrary
}

async function load(): Promise<Store> {
  let library: Library = { version: 1, shops: [], analysis: null }
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Library
    if (Array.isArray(parsed.shops)) library = { version: 1, shops: parsed.shops, analysis: parsed.analysis ?? null }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  return { library, stats: null, write: Promise.resolve() }
}

/** Applies `change` and writes the library; changes queue one after another. */
async function update(change: (library: Library) => Library) {
  const current = await store()
  const run = current.write.catch(() => {}).then(async () => {
    current.library = change(current.library)
    current.stats = null
    await mkdir(ROOT, { recursive: true })
    const temporary = `${FILE}.${process.pid}-${Date.now()}.tmp`
    await writeFile(temporary, JSON.stringify(current.library))
    await rename(temporary, FILE)
  })
  current.write = run
  await run
  return current.library
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
  const shop = (await store()).library.shops.find((s) => s.id === shopId)
  return shop ? { updatedAt: shop.updatedAt, listings: shop.listings.length } : null
}

// --- Statistics ---

async function stats(): Promise<Stats> {
  const current = await store()
  current.stats ??= compute(current.library.shops)
  return current.stats
}

function compute(shops: LibraryShop[]): Stats {
  type Tally = { keyword: string; listings: number; shops: Set<number>; sales: number; top: number }
  const tags = new Map<string, Tally>()
  const phrases = new Map<string, Tally>()
  let listings = 0
  let sales = 0

  const count = (map: Map<string, Tally>, keyword: string, shopId: number, perMonth: number, top: boolean) => {
    const tally = map.get(keyword) ?? { keyword, listings: 0, shops: new Set<number>(), sales: 0, top: 0 }
    tally.listings++
    tally.shops.add(shopId)
    tally.sales += perMonth
    if (top) tally.top++
    map.set(keyword, tally)
  }

  for (const shop of shops) {
    for (const listing of shop.listings) {
      listings++
      sales += listing.salesPerMonth
      for (const tag of new Set(listing.tags.map(normalise))) {
        if (tag) count(tags, tag, shop.id, listing.salesPerMonth, listing.top)
      }
      for (const phrase of titlePhrases(listing.title)) {
        count(phrases, phrase, shop.id, listing.salesPerMonth, listing.top)
      }
    }
  }

  const finish = (map: Map<string, Tally>, kind: KeywordInsight["kind"]): KeywordInsight[] => {
    const rows = [...map.values()].map((t) => {
      const topShare = t.top / t.listings
      // Sales carried by the keyword, more for keywords that keep showing up
      // on top sellers and across shops; one listing alone is weak evidence.
      const raw =
        Math.log1p(t.sales) *
        (0.6 + 0.8 * topShare) *
        (1 + 0.25 * Math.log(t.shops.size)) *
        (t.listings / (t.listings + 1))
      return {
        keyword: t.keyword,
        kind,
        listings: t.listings,
        shops: t.shops.size,
        salesPerMonth: round(t.sales),
        avgSalesPerMonth: round(t.sales / t.listings),
        topShare: round(topShare, 3),
        score: raw,
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
  const { library } = await store()
  const { tags, phrases } = await stats()
  return {
    shops: library.shops.length,
    listings: library.shops.reduce((n, s) => n + s.listings.length, 0),
    keywords: tags.length + phrases.length,
  }
}

/** Everything the Keywords page shows; the long tails are cut. */
export async function overview(): Promise<LibraryOverview> {
  const { library } = await store()
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
  const { library } = await store()
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
 * its title and tags), strongest first. Topped up with the library's best
 * keywords overall when few fit, so there is always something to learn from.
 */
export async function keywordContext(
  query: { title: string; tags: string[] },
  limit = 40
): Promise<KeywordInsight[]> {
  const { tags, phrases } = await stats()
  const words = new Set([...wordsOf(query.title), ...query.tags.flatMap(wordsOf)])
  const exact = new Set(query.tags.map(normalise))
  if (words.size === 0 && exact.size === 0) return tags.slice(0, limit)

  const relevant: { insight: KeywordInsight; weight: number }[] = []
  for (const insight of [...tags, ...phrases]) {
    const own = wordsOf(insight.keyword)
    if (own.length === 0) continue
    const shared = own.filter((w) => words.has(w)).length / own.length
    const relevance = exact.has(insight.keyword) ? 1 : shared
    // At least half of a keyword's words have to fit the listing.
    if (relevance < 0.5) continue
    relevant.push({ insight, weight: insight.score * (0.4 + 0.6 * relevance) })
  }
  const picked = relevant
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((r) => r.insight)

  if (picked.length < limit / 2) {
    const have = new Set(picked.map((p) => `${p.kind}:${p.keyword}`))
    for (const tag of tags) {
      if (picked.length >= limit) break
      if (!have.has(`tag:${tag.keyword}`) && tag.shops > 1) picked.push(tag)
    }
  }
  return picked
}

/** The latest AI read of the library as plain text, if there is one. */
export async function libraryInsights(): Promise<string | null> {
  const { analysis } = (await store()).library
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
  const { library } = await store()
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
    .filter((p) => p.length >= 3 && p.length <= 60 && /\p{L}/u.test(p))
  return [...new Set(parts)]
}

const STOPWORDS = new Set(["and", "the", "for", "with", "you", "your", "from", "this", "that", "our"])

/** Content words, lightly singularised so "posters" meets "poster". */
function wordsOf(text: string) {
  return normalise(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
}

function round(n: number, digits = 2) {
  const f = 10 ** digits
  return Math.round(n * f) / f
}
