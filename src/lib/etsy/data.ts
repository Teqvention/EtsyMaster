import type {
  DailyStat,
  Metric,
  Order,
  OrderStatus,
  Shop,
  ShopSummary,
} from "./types"

// Data access for the dashboard. Everything here currently returns
// deterministic mock data. To go live, replace the function bodies with calls
// to the Etsy Open API v3 (https://developers.etsy.com/documentation/) —
// e.g. `GET /v3/application/shops/{shop_id}/receipts` for orders — and map the
// responses into the types in `./types`. The function signatures are async so
// callers won't need to change.

const DAY_MS = 24 * 60 * 60 * 1000

// Small seeded PRNG (mulberry32) so mock numbers are stable between renders.
function createRandom(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function startOfTodayUtc() {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

export async function getShop(): Promise<Shop> {
  // Shop details rarely change, so they're cached and the dashboard shell
  // (sidebar, header) can be prerendered.
  "use cache"
  return {
    name: "Willow & Thread",
    ownerName: "Jerome Bastien",
    ownerEmail: "seller@example.com",
    currency: "USD",
  }
}

export async function getDailyStats(days = 90): Promise<DailyStat[]> {
  const random = createRandom(42)
  const today = startOfTodayUtc()

  return Array.from({ length: days }, (_, i) => {
    const daysAgo = days - 1 - i
    const date = new Date(today - daysAgo * DAY_MS)
    // Gentle upward trend, busier weekends, plus noise.
    const trend = 1 + (i / days) * 0.35
    const weekday = date.getUTCDay()
    const weekend = weekday === 0 || weekday === 6 ? 1.25 : 1
    const visits = Math.round(160 * trend * weekend * (0.8 + random() * 0.4))
    const orders = Math.round(visits * (0.018 + random() * 0.016))
    const revenueCents = orders * Math.round(2800 + random() * 2400)

    return {
      date: date.toISOString().slice(0, 10),
      revenueCents,
      orders,
      visits,
    }
  })
}

function metric(current: number, previous: number): Metric {
  return {
    value: current,
    change: previous === 0 ? 0 : (current - previous) / previous,
  }
}

export async function getShopSummary(periodDays = 30): Promise<ShopSummary> {
  const stats = await getDailyStats(periodDays * 2)
  const previous = stats.slice(0, periodDays)
  const current = stats.slice(periodDays)

  const sum = (rows: DailyStat[], key: "revenueCents" | "orders" | "visits") =>
    rows.reduce((total, row) => total + row[key], 0)

  const [curOrders, prevOrders] = [sum(current, "orders"), sum(previous, "orders")]
  const [curVisits, prevVisits] = [sum(current, "visits"), sum(previous, "visits")]

  return {
    periodDays,
    revenueCents: metric(sum(current, "revenueCents"), sum(previous, "revenueCents")),
    orders: metric(curOrders, prevOrders),
    visits: metric(curVisits, prevVisits),
    conversionRate: metric(curOrders / curVisits, prevOrders / prevVisits),
  }
}

const BUYERS = [
  ["Amelia Hart", "US"],
  ["Lukas Weber", "DE"],
  ["Chloé Martin", "FR"],
  ["Noah Kim", "US"],
  ["Isla Thompson", "GB"],
  ["Mateo García", "ES"],
  ["Hannah Schulz", "DE"],
  ["Oliver Brown", "CA"],
  ["Sofia Rossi", "IT"],
  ["Liam O'Connor", "IE"],
  ["Emma de Vries", "NL"],
  ["Ava Johnson", "US"],
  ["Jack Wilson", "AU"],
  ["Mia Andersson", "SE"],
] as const

export async function getOrders(count = 48): Promise<Order[]> {
  const random = createRandom(7)
  const now = Date.now()

  return Array.from({ length: count }, (_, i) => {
    const [buyerName, country] = BUYERS[Math.floor(random() * BUYERS.length)]
    // Spread orders over the last ~3 weeks, newest first.
    const ageDays = i * 0.45 + random() * 0.4
    const createdAt = now - ageDays * DAY_MS
    const itemCount = 1 + Math.floor(random() ** 2 * 4)

    let status: OrderStatus
    if (random() < 0.04) status = "canceled"
    else if (ageDays < 3) status = "paid"
    else if (ageDays < 9) status = "shipped"
    else status = "completed"

    return {
      id: 3_418_220_000 + (count - i) * 137,
      buyerName,
      country,
      itemCount,
      totalCents: itemCount * Math.round(1800 + random() * 4200) + 495,
      status,
      createdAt: new Date(createdAt).toISOString(),
      shipBy: new Date(createdAt + 3 * DAY_MS).toISOString(),
    }
  })
}
