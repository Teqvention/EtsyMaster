import { gelatoKeys } from "@/lib/accounts/store"
import { SIZES, SIZE_KEYS, productUid, type SizeKey } from "@/lib/catalog/sizes"
import { productPrices, quote } from "@/lib/gelato/client"
import { readDoc, writeDoc } from "@/lib/db/documents"

import type { Destination, GelatoCosts, SizeCost } from "./types"

// What Gelato charges for each size: the print and the cheapest shipping to
// one destination, before VAT. A quote per size (it creates nothing) answers
// both; twelve of them take ten seconds or so, so they're asked in the
// background and kept for a week. Until a destination was first
// asked, the print costs Gelato showed on CitysInBlack's products stand in.

const MAX_AGE = 7 * 24 * 60 * 60 * 1000
const PARALLEL = 4

/** Print only, before VAT: Gelato's cost on CitysInBlack's twelve variants, October 2026. */
export const MEASURED_CENTS: Record<SizeKey, number> = {
  "13x18": 529,
  a4: 609,
  "27x35": 689,
  a3: 849,
  "30x40": 799,
  "40x50": 919,
  a2: 979,
  "45x60": 1009,
  "50x70": 1029,
  a1: 1349,
  "60x90": 1369,
  "70x100": 1409,
}

const global = globalThis as typeof globalThis & {
  __gelatoCosts?: { running: Map<Destination, Promise<void>>; errors: Map<Destination, string> }
}
const state = (global.__gelatoCosts ??= { running: new Map(), errors: new Map() })

const fileOf = (destination: Destination) => `pricing/costs/${destination}`

function measured(destination: Destination): GelatoCosts {
  return {
    destination,
    sizes: Object.fromEntries(
      SIZE_KEYS.map((key) => [key, { productCents: MEASURED_CENTS[key], shippingCents: null }])
    ) as Record<SizeKey, SizeCost>,
    source: "measured",
    at: "2026-10-08T18:47:55.000Z",
  }
}

/** The costs as last asked; asks again in the background once they're a week old. */
export async function gelatoCosts(destination: Destination): Promise<GelatoCosts & { refreshing: boolean }> {
  const saved = await readDoc<GelatoCosts | null>(fileOf(destination), null)
  if (!saved || Date.now() - Date.parse(saved.at) > MAX_AGE) {
    if (!state.errors.has(destination)) refreshCosts(destination)
  }
  const error = state.errors.get(destination)
  return { ...(saved ?? measured(destination)), ...(error && { error }), refreshing: state.running.has(destination) }
}

/** Asks Gelato again (once at a time per destination); resolves when it's done. */
export function refreshCosts(destination: Destination) {
  let run = state.running.get(destination)
  if (!run) {
    state.errors.delete(destination)
    run = ask(destination)
      .catch((error: Error) => {
        console.error(`Gelato costs to ${destination}:`, error)
        state.errors.set(destination, error.message)
      })
      .finally(() => state.running.delete(destination))
    state.running.set(destination, run)
  }
  return run
}

async function ask(destination: Destination) {
  const key = (await gelatoKeys())[0]?.key
  if (!key) throw new Error("No Gelato key is saved")

  const sizes = {} as Record<SizeKey, SizeCost>
  const failures: string[] = []
  const queue = [...SIZES]
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      for (let size = queue.shift(); size; size = queue.shift()) {
        const uid = productUid(size)
        try {
          const offer = (await quote(key, uid, destination, "EUR")).quotes[0]
          const product = offer?.products.find((p) => p.productUid === uid)?.price ?? offer?.products[0]?.price
          const shipping = offer?.shipmentMethods.map((m) => m.price).filter((p) => p > 0) ?? []
          if (product === undefined) throw new Error("no price in the quote")
          sizes[size.key] = {
            productCents: Math.round(product * 100),
            shippingCents: shipping.length ? Math.round(Math.min(...shipping) * 100) : null,
          }
        } catch (error) {
          // The print price alone is a quicker question; shipping stays unknown.
          try {
            const [price] = await productPrices(key, uid, destination, "EUR")
            if (!price) throw error
            sizes[size.key] = { productCents: Math.round(price.price * 100), shippingCents: null }
          } catch {
            failures.push(`${size.key}: ${(error as Error).message}`)
          }
        }
      }
    })
  )
  if (failures.length === SIZES.length) throw new Error(`Gelato didn't answer (${failures[0]})`)
  for (const key of SIZE_KEYS) sizes[key] ??= { productCents: MEASURED_CENTS[key], shippingCents: null }

  const costs: GelatoCosts = { destination, sizes, source: "live", at: new Date().toISOString() }
  if (failures.length) costs.error = `${failures.length} size${failures.length === 1 ? "" : "s"} not answered`
  await writeDoc(fileOf(destination), costs)
}
