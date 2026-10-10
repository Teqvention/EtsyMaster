import { getTokens, isLive, listAccounts } from "@/lib/accounts/store"
import { SIZES, SIZE_KEYS, type SizeKey } from "@/lib/catalog/sizes"
import { etsyGet, etsyRequest, type ApiMoney, type ApiPage } from "@/lib/etsy/client"
import { findShop } from "@/lib/etsy/shops"
import type { ApiInventory } from "@/lib/etsy/shop"
import { readDoc, writeDoc } from "@/lib/db/documents"
import type { LibraryShop } from "@/lib/keywords/types"

import { eurRates, toEur, type Rates } from "./fx"
import type { MarketAnalysis, MarketShop, MarketSuggestion, PriceProfile, PriceSpread } from "./types"
import { roundToEnding } from "./profit"

// What strong poster shops charge, size by size. Their best sellers come from
// the keyword library where the shop is in it (sales estimated from every
// listing), else from the shop's most favourited listings. Listing data is
// public (the analysis accounts pay for it); the price of each size sits in a
// listing's inventory, which Etsy only shows to a signed in app, so those
// come with any connected account's token, a hundred listings per request.
// A shop costs two or three requests. Kept until run again.

const FILE = "pricing/market"
/** The keyword library's file, read as is (only the shops' listings are needed). */
const LIBRARY = "keywords/library"
const SAMPLE = 60

const EMPTY: MarketAnalysis = { shops: [], sizes: {}, inventoryNote: null, at: null }

const global = globalThis as typeof globalThis & { __market?: Promise<MarketAnalysis> | null }

export async function marketAnalysis(): Promise<MarketAnalysis & { running: boolean }> {
  return { ...(await readDoc(FILE, EMPTY)), running: !!global.__market }
}

/** Looks at `names` again; a second call while one runs waits for that one. */
export function runMarketAnalysis(names: string[]) {
  global.__market ??= analyse(names).finally(() => {
    global.__market = null
  })
  return global.__market
}

type ApiListingLite = {
  listing_id: number
  title: string
  price: ApiMoney
  listing_type: string
  state?: string
  num_favorers: number
  views?: number
}

type Sample = { shop: MarketShop; prices: Partial<Record<SizeKey, number[]>> }

async function analyse(names: string[]): Promise<MarketAnalysis> {
  const [rates, reader, library] = await Promise.all([eurRates(), inventoryReader(), libraryShops()])
  const samples: Sample[] = []
  for (const name of names) {
    samples.push(await sampleShop(name, rates, reader, library))
  }

  const all: Partial<Record<SizeKey, number[]>> = {}
  for (const { prices } of samples) {
    for (const key of SIZE_KEYS) if (prices[key]?.length) (all[key] ??= []).push(...prices[key]!)
  }
  const analysis: MarketAnalysis = {
    shops: samples.map((s) => s.shop),
    sizes: spreads(all),
    inventoryNote: reader
      ? null
      : "Prices per size need a connected Etsy account (any shop): Etsy shows a listing's sizes only to a signed in app.",
    at: new Date().toISOString(),
  }
  await writeDoc(FILE, analysis)
  return analysis
}

/** A connected account allowed to read inventories: an analysis one first, any other otherwise. */
async function inventoryReader() {
  const accounts = [...(await listAccounts())].sort((a, b) => Number(b.role === "analysis") - Number(a.role === "analysis"))
  for (const account of accounts) {
    const tokens = await getTokens(account.id)
    if (isLive(tokens) && tokens!.scope.split(/\s+/).includes("listings_r")) return account.id
  }
  return null
}

async function libraryShops() {
  const library = await readDoc<{ shops?: LibraryShop[] }>(LIBRARY, {}).catch(() => ({ shops: [] }))
  return library.shops ?? []
}

async function sampleShop(name: string, rates: Rates, reader: string | null, library: LibraryShop[]): Promise<Sample> {
  const at = new Date().toISOString()
  const stub: MarketShop = {
    shopId: 0,
    name,
    url: `https://www.etsy.com/shop/${name}`,
    totalSales: 0,
    activeListings: 0,
    source: "shop",
    sampled: 0,
    physical: 0,
    fromPrice: null,
    sizes: {},
    otherSizes: [],
    at,
  }
  try {
    const shop = await findShop(name)
    if (!shop) return { shop: { ...stub, error: "No shop by that name" }, prices: {} }
    const base: MarketShop = {
      ...stub,
      shopId: shop.id,
      name: shop.name,
      url: shop.url,
      totalSales: shop.totalSales,
      activeListings: shop.activeListings,
    }

    // The best sellers: from the library's estimates, or the most favourited of the shop's own ranking.
    const known = library.find((s) => s.id === shop.id)
    let listings: ApiListingLite[]
    if (known?.listings.length) {
      const ids = [...known.listings]
        .sort((a, b) => b.salesPerMonth - a.salesPerMonth)
        .slice(0, SAMPLE)
        .map((l) => l.id)
      const batch = await etsyGet<ApiPage<ApiListingLite>>("/listings/batch", { listing_ids: ids.join(",") })
      listings = batch.results.filter((l) => !l.state || l.state === "active")
      base.source = "library"
    } else {
      const page = await etsyGet<ApiPage<ApiListingLite>>(`/shops/${shop.id}/listings/active`, {
        limit: 100,
        sort_on: "score",
        sort_order: "desc",
      })
      listings = [...page.results]
        .sort((a, b) => b.num_favorers + (b.views ?? 0) / 50 - (a.num_favorers + (a.views ?? 0) / 50))
        .slice(0, SAMPLE)
    }
    const physical = listings.filter((l) => l.listing_type !== "download")
    const from = physical
      .map((l) => toEur(Math.round((l.price.amount * 100) / l.price.divisor), l.price.currency_code, rates))
      .filter((c): c is number => c !== null)

    const sample: Sample = {
      shop: { ...base, sampled: listings.length, physical: physical.length, fromPrice: spread(from) },
      prices: {},
    }
    if (reader && physical.length) await readSizes(sample, physical, rates, reader)
    return sample
  } catch (error) {
    return { shop: { ...stub, error: (error as Error).message }, prices: {} }
  }
}

/** Each listing's cheapest offer per size, from the inventories. */
async function readSizes(sample: Sample, listings: ApiListingLite[], rates: Rates, reader: string) {
  const other = new Map<string, number>()
  for (let i = 0; i < listings.length; i += 100) {
    const ids = listings.slice(i, i + 100).map((l) => l.listing_id)
    const page = await etsyRequest<ApiPage<{ listing_id: number; inventory?: ApiInventory }>>("/listings/batch/inventory", {
      account: reader,
      auth: true,
      params: { listing_ids: ids.join(",") },
    })
    for (const { inventory } of page.results) {
      if (!inventory) continue
      const cheapest = new Map<SizeKey, number>()
      const others = new Set<string>()
      for (const product of inventory.products) {
        if (product.is_deleted) continue
        const offers = product.offerings.filter((o) => o.is_enabled && !o.is_deleted)
        if (!offers.length) continue
        const size = product.property_values.flatMap((p) => p.values).map(readSize).find(Boolean)
        if (!size) continue
        if (!size.key) {
          others.add(size.label)
          continue
        }
        for (const offer of offers) {
          const cents = toEur(Math.round((offer.price.amount * 100) / offer.price.divisor), offer.price.currency_code, rates)
          if (cents !== null && cents < (cheapest.get(size.key) ?? Infinity)) cheapest.set(size.key, cents)
        }
      }
      for (const [key, cents] of cheapest) (sample.prices[key] ??= []).push(cents)
      for (const label of others) other.set(label, (other.get(label) ?? 0) + 1)
    }
  }
  sample.shop.sizes = spreads(sample.prices)
  sample.shop.otherSizes = [...other]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, count]) => ({ label, count }))
}

// --- Sizes in other shops' words ---

const INCH = 25.4

/**
 * Our size a variation value names, from "8 x 12 in", "50x70cm", "16x20″",
 * "A3 (29.7 x 42 cm)" or "18 by 24 inches"; `key` is null for a size we don't
 * print. Null when the value names no size at all ("Black frame").
 */
export function readSize(value: string): { key: SizeKey | null; label: string } | null {
  const text = value.toLowerCase().replace(/,/g, ".").replace(/&quot;|''/g, '"')
  const unitPattern = String.raw`(cm|mm|in(?:ch(?:es)?)?\b|″|")?`
  const pairs = [
    ...text.matchAll(new RegExp(String.raw`(\d+(?:\.\d+)?)\s*${unitPattern}\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*${unitPattern}`, "g")),
  ]
  const unitless = !/cm|mm/.test(text) && !/in(?:ch)?\b|″|"/.test(text)
  for (const [, a, firstUnit, b, secondUnit] of pairs) {
    const unit = secondUnit ?? firstUnit
    const units: number[] = unit
      ? [unit === "mm" ? 1 : unit === "cm" ? 10 : INCH]
      : unitless
        ? [10, INCH]
        : [/cm/.test(text) ? 10 : /mm/.test(text) ? 1 : INCH]
    for (const scale of units) {
      const key = match(Number(a) * scale, Number(b) * scale)
      if (key) return { key, label: value.trim() }
    }
    const scale = units[0]
    return { key: null, label: `${trim(a)} x ${trim(b)} ${scale === INCH ? "in" : scale === 10 ? "cm" : "mm"}` }
  }
  const named = text.match(/\ba([0-6])\b/)
  if (named) {
    const key = `a${named[1]}` as SizeKey
    return { key: SIZE_KEYS.includes(key) ? key : null, label: `A${named[1]}` }
  }
  return null
}

const trim = (n: string) => String(Number(n))

/** The closest of our sizes within a few millimetres each way (12 x 16 in is 30 x 40, not A3). */
function match(a: number, b: number): SizeKey | null {
  const [w, h] = a < b ? [a, b] : [b, a]
  const near = (ours: number, theirs: number) => Math.abs(ours - theirs) <= Math.max(6, ours * 0.035)
  const off = (s: (typeof SIZES)[number]) => Math.abs(s.widthMm - w) + Math.abs(s.heightMm - h)
  const close = SIZES.filter((s) => near(s.widthMm, w) && near(s.heightMm, h)).sort((x, y) => off(x) - off(y))
  return close[0]?.key ?? null
}

// --- Spreads ---

function quantile(sorted: number[], q: number) {
  const at = (sorted.length - 1) * q
  const low = Math.floor(at)
  return sorted[low] + (sorted[Math.ceil(at)] - sorted[low]) * (at - low)
}

function spread(values: number[]): PriceSpread | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return {
    count: sorted.length,
    min: Math.round(sorted[0]),
    p25: Math.round(quantile(sorted, 0.25)),
    median: Math.round(quantile(sorted, 0.5)),
    p75: Math.round(quantile(sorted, 0.75)),
    max: Math.round(sorted.at(-1)!),
  }
}

function spreads(prices: Partial<Record<SizeKey, number[]>>) {
  const out: Partial<Record<SizeKey, PriceSpread>> = {}
  for (const key of SIZE_KEYS) {
    const s = spread(prices[key] ?? [])
    if (s) out[key] = s
  }
  return out
}

/** Fewer listings than this and a size's median says little. */
const MIN_COUNT = 5

/**
 * The market's median per size, ending in .90; sizes it has too few prices
 * for follow the mid profile's steps, scaled by how the market sits against it.
 */
export function suggest(market: MarketAnalysis, base: PriceProfile | undefined): MarketSuggestion | null {
  const known = SIZE_KEYS.filter((key) => (market.sizes[key]?.count ?? 0) >= MIN_COUNT)
  if (known.length < 3 || !base) return null
  const ratios = known.map((key) => market.sizes[key]!.median / base.prices[key]).sort((a, b) => a - b)
  const ratio = quantile(ratios, 0.5)
  const prices = Object.fromEntries(
    SIZE_KEYS.map((key) => {
      const target = known.includes(key) ? market.sizes[key]!.median : base.prices[key] * ratio
      return [key, roundToEnding(target, 90)]
    })
  ) as Record<SizeKey, number>
  return { prices, estimated: SIZE_KEYS.filter((key) => !known.includes(key)) }
}
