import { readDoc, writeDoc } from "@/lib/db/documents"

import type { ExchangeRate } from "./types"

// Exchange rates, for the few places money in another currency turns up: the
// listing fee is charged in US dollars, other shops price in theirs. The
// European Central Bank's daily reference rates, kept for half a day;
// when the bank can't be reached, the last ones (or rough stand-ins) do.

const FILE = "pricing/fx"
const ECB = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
const MAX_AGE = 12 * 60 * 60 * 1000

export type Rates = {
  /** Units of each currency one euro buys. */
  perEur: Record<string, number>
  /** The bank's reference date. */
  date: string | null
  source: "ecb" | "fallback"
  /** ISO 8601 */
  at: string
}

/** Rough rates from October 2026, for when the bank has never been reached. */
const FALLBACK: Record<string, number> = { USD: 1.16, GBP: 0.87, CAD: 1.62, AUD: 1.76, CHF: 0.93, SEK: 11, NOK: 11.7, DKK: 7.46, PLN: 4.25 }

const global = globalThis as typeof globalThis & { __fx?: { rates: Rates | null; asking: Promise<Rates> | null } }
const memory = (global.__fx ??= { rates: null, asking: null })

export async function eurRates(): Promise<Rates> {
  memory.rates ??= await readDoc<Rates | null>(FILE, null)
  const fresh = memory.rates && memory.rates.source === "ecb" && Date.now() - Date.parse(memory.rates.at) < MAX_AGE
  if (fresh) return memory.rates!
  memory.asking ??= ask().finally(() => {
    memory.asking = null
  })
  return memory.asking
}

async function ask(): Promise<Rates> {
  try {
    const response = await fetch(ECB, { cache: "no-store", signal: AbortSignal.timeout(6000) })
    if (!response.ok) throw new Error(`ECB ${response.status}`)
    const xml = await response.text()
    const perEur: Record<string, number> = { EUR: 1 }
    for (const [, currency, rate] of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
      perEur[currency] = Number(rate)
    }
    if (!perEur.USD) throw new Error("No dollar rate in the ECB file")
    const rates: Rates = {
      perEur,
      date: xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1] ?? null,
      source: "ecb",
      at: new Date().toISOString(),
    }
    memory.rates = rates
    await writeDoc(FILE, rates)
    return rates
  } catch (error) {
    console.warn("Exchange rates:", (error as Error).message)
    return memory.rates ?? { perEur: { EUR: 1, ...FALLBACK }, date: null, source: "fallback", at: new Date().toISOString() }
  }
}

/** Cents in `currency` as euro cents; null for a currency the bank doesn't list. */
export function toEur(cents: number, currency: string | null | undefined, rates: Rates) {
  if (!currency || currency === "EUR") return cents
  const rate = rates.perEur[currency] ?? FALLBACK[currency]
  return rate ? cents / rate : null
}

/** Euros one US dollar buys: what the listing fee costs here. */
export async function usdRate(): Promise<ExchangeRate> {
  const rates = await eurRates()
  return { rate: 1 / (rates.perEur.USD ?? FALLBACK.USD), date: rates.date, source: rates.source }
}
