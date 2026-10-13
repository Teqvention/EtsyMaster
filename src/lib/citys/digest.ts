import { readDoc, writeDoc } from "@/lib/db/documents"
import { ready, sql } from "@/lib/db/sql"
import { calibrateShop } from "@/lib/etsy/calibrate"
import type { CountSnapshot, Listing, ListingShop, ShopReview } from "@/lib/etsy/types"
import { getShopHistory } from "@/lib/shops/history-store"
import { tagsOf } from "@/lib/shops/history-ops"
import { tagUnder } from "@/lib/tags"

import { shortPhoto } from "./photos"
import type { DigestListing, ShopDigest } from "./types"

// A shop's listings as the city pages need them, made once per analysis of
// the shop: its stored analysis (shops/<id>) runs to tens of megabytes, all
// photos in every size, so the few fields wanted are taken out by the
// database and the demand is worked out on the shop's own rates, as the
// Shops page does (calibrate.ts). Kept as citys/digest/<shopId>, with the
// version of the analysis it was made from.

const DIGEST = (shopId: number) => `citys/digest/${shopId}`
const ANALYSIS = (shopId: number) => `shops/${shopId}`
const PHOTOS = 4

type Stored = ShopDigest & { version: number }

export type CityShop = { shop: ListingShop; secondary: string[] }

/** The shops carrying the primary tag `primary` (default "citys") on the Shops page, with their secondary tags under it. */
export async function taggedShops(primary = "citys"): Promise<CityShop[]> {
  const history = await getShopHistory()
  return Object.values(history)
    .flatMap((v) => {
      const tag = tagUnder(tagsOf(v), primary)
      return tag ? [{ shop: v.shop, secondary: tag.secondary }] : []
    })
    .sort((a, b) => a.shop.name.localeCompare(b.shop.name))
}

/** The version of each shop's stored analysis, by shop id; missing when it has none. */
async function analysisVersions(shopIds: number[]) {
  await ready()
  const rows = await sql<{ key: string; version: string }[]>`
    select key, version from documents where key = any(${shopIds.map(ANALYSIS)})`
  return new Map(rows.map((r) => [Number(r.key.slice("shops/".length)), Number(r.version)]))
}

/**
 * The digests of the shops, made again where the shop was analysed since;
 * shops never analysed are left out. Made one after another, so a cold
 * start doesn't hold a dozen big analyses in memory at once.
 */
export async function digests(shopIds: number[]): Promise<Map<number, ShopDigest>> {
  const versions = await analysisVersions(shopIds)
  const found = new Map<number, ShopDigest>()
  for (const shopId of shopIds) {
    const version = versions.get(shopId)
    if (version === undefined) continue
    const held = await readDoc<Stored | null>(DIGEST(shopId), null)
    if (held && held.version === version) {
      found.set(shopId, held)
      continue
    }
    try {
      const made = await makeDigest(shopId, version)
      if (made) found.set(shopId, made)
    } catch (error) {
      console.error(`City digest of shop ${shopId}:`, error)
      if (held) found.set(shopId, held)
    }
  }
  return found
}

type Row = {
  id: string
  title: string | null
  tags: string[] | null
  fav: number | null
  views: number | null
  created: string | null
  age: number | null
  price: number | null
  images: [string | null, string | null][] | null
  perso: boolean | null
  digital: boolean | null
}

async function makeDigest(shopId: number, version: number): Promise<Stored | null> {
  await ready()
  const [head] = await sql<
    { shop: ListingShop; plan: { reviews?: string } | null; status: string; reviews: ShopReview[] | null; analysed_at: string; snapshots: CountSnapshot[] | null }[]
  >`
    select value->'shop' as shop, value->'plan' as plan, value->>'status' as status, value->'reviews' as reviews,
      value->>'analysedAt' as analysed_at, value->'snapshots' as snapshots
    from documents where key = ${ANALYSIS(shopId)}`
  if (!head?.shop) return null
  const rows = await sql<Row[]>`
    select l->>'id' as id, l->>'title' as title, l->'tags' as tags,
      (l->>'favorites')::int as fav, (l->>'views')::int as views,
      l->>'createdAt' as created, (l->>'ageDays')::float8 as age, (l->>'priceCents')::int as price,
      (select json_agg(json_build_array(img->>'medium', img->>'full'))
         from json_array_elements(l->'images') with ordinality as p(img, n) where n <= ${PHOTOS}) as images,
      (l->>'isPersonalizable')::boolean as perso, (l->>'isDigital')::boolean as digital
    from documents d, json_array_elements(d.value->'listings') l
    where d.key = ${ANALYSIS(shopId)}`

  // The fields calibrate.ts reads; the rest of a Listing it only passes along.
  const listings = rows.map(
    (r) =>
      ({
        id: Number(r.id),
        title: r.title ?? "",
        tags: r.tags ?? [],
        favorites: r.fav ?? 0,
        views: r.views ?? 0,
        createdAt: r.created ?? "",
        ageDays: r.age ?? 0,
        priceCents: r.price ?? 0,
        reviewCount: null,
        shop: head.shop,
        images: (r.images ?? []).map(([medium, full]) => shortPhoto(medium ?? full ?? "")).filter(Boolean),
        isPersonalizable: !!r.perso,
        isDigital: !!r.digital,
      }) as unknown as Listing
  )
  const { listings: calibrated } = calibrateShop(listings, head.reviews ?? [], head.shop, {
    reviewsComplete: head.plan?.reviews === "all" && head.status === "done",
    analysedAt: head.analysed_at,
    snapshots: head.snapshots ?? [],
  })

  const digest: Stored = {
    shopId,
    name: head.shop.name,
    analysedAt: head.analysed_at,
    version,
    madeAt: new Date().toISOString(),
    listings: calibrated.map(
      (l): DigestListing => ({
        id: l.id,
        title: l.title,
        tags: l.tags,
        fav: l.favorites,
        views: l.views,
        created: l.createdAt,
        ageDays: Math.round(l.ageDays),
        priceCents: l.priceCents,
        images: l.images as unknown as string[],
        sales: round(l.estimate.sales),
        spm: round(l.estimate.salesPerMonth, 3),
        rev: Math.round(l.estimate.revenuePerMonthCents),
        reviews: [l.rank?.reviews.all ?? 0, l.rank?.reviews.year ?? 0, l.rank?.reviews.quarter ?? 0],
        rank: l.rank?.position ?? 0,
        tier: l.rank?.tier ?? "rest",
        trend: l.rank?.trend === null || l.rank?.trend === undefined ? null : round(l.rank.trend),
        flags: l.rank?.flags ?? [],
        personalizable: l.isPersonalizable,
        digital: l.isDigital,
      })
    ),
  }
  await writeDoc(DIGEST(shopId), digest)
  return digest
}

function round(n: number, digits = 2) {
  const f = 10 ** digits
  return Math.round(n * f) / f
}
