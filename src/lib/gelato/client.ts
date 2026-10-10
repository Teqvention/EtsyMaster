import { gelatoKeys, setGelatoKeys, type GelatoKey } from "@/lib/accounts/store"

// Gelato's APIs, server-side only. Each Gelato account has one API key and
// one or more stores (an Etsy shop it's connected to). Only a few routes are
// documented; the store routes used here were measured and are checked on
// use. Gelato publishes no rate limits: 429 and 5xx are retried with backoff.

const ECOMMERCE = "https://ecommerce.gelatoapis.com/v1"
const PRODUCT = "https://product.gelatoapis.com/v3"
const ORDER = "https://order.gelatoapis.com/v4"
const USER_AGENT = "etsy-dashboard/1.0"

export class GelatoError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = "GelatoError"
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function request<T>(key: string, url: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const method = init.method ?? "GET"
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: {
          "X-API-KEY": key,
          "User-Agent": USER_AGENT,
          ...(init.json !== undefined && { "Content-Type": "application/json" }),
        },
        body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
        cache: "no-store",
      })
    } catch (error) {
      if (attempt < 3) {
        await sleep(1000 * 2 ** attempt)
        continue
      }
      throw new GelatoError(503, `Gelato unreachable: ${(error as Error).message}`)
    }
    if (res.ok) {
      const text = await res.text()
      return (text ? JSON.parse(text) : undefined) as T
    }
    const text = await res.text().catch(() => "")
    // Creating is never repeated: Gelato answers 5xx and creates anyway.
    const retry = res.status === 429 || (res.status >= 500 && method === "GET")
    if (retry && attempt < 4) {
      await sleep(Number(res.headers.get("retry-after")) * 1000 || 1500 * 2 ** attempt)
      continue
    }
    let message = text.slice(0, 400) || res.statusText
    try {
      const body = JSON.parse(text) as { message?: string; details?: { message?: string }[] }
      message = [body.message, ...(body.details ?? []).map((d) => d.message)].filter(Boolean).join(" · ") || message
    } catch {}
    throw new GelatoError(res.status, `Gelato ${res.status}: ${message}`)
  }
}

// --- Keys and stores ---

export type GelatoStore = {
  id: string
  name: string
  domain: string | null
  type: string
  status: string
  currency: string
  orderApproval: string | null
  autoApproveAfter: number | null
  isNotConnectedProductsEnabled: boolean
  shippingOriginCountryIso: string | null
}

type StoreList = { stores: GelatoStore[] }

const global = globalThis as typeof globalThis & { __gelatoStores?: Map<string, { at: number; stores: GelatoStore[] }> }
const storeCache = (global.__gelatoStores ??= new Map())
const STORE_TTL = 10 * 60 * 1000

/** The stores one key reaches. */
export async function storesOf(key: string, fresh = false): Promise<GelatoStore[]> {
  const hit = storeCache.get(key)
  if (hit && !fresh && Date.now() - hit.at < STORE_TTL) return hit.stores
  const { stores } = await request<StoreList>(key, `${ECOMMERCE}/stores`)
  storeCache.set(key, { at: Date.now(), stores })
  return stores
}

/** Every store any saved key reaches, with the key's id. */
export async function allStores(fresh = false) {
  const keys = await gelatoKeys()
  const lists = await Promise.all(
    keys.map(async (k) => {
      try {
        return (await storesOf(k.key, fresh)).map((store) => ({ ...store, keyId: k.id, keyLabel: k.label }))
      } catch (error) {
        console.error(`Gelato key ${k.label}:`, error)
        return []
      }
    })
  )
  return lists.flat()
}

/** The API key that reaches `storeId`. */
export async function keyForStore(storeId: string): Promise<string> {
  for (const k of await gelatoKeys()) {
    const stores = await storesOf(k.key).catch(() => [])
    if (stores.some((s) => s.id === storeId)) return k.key
  }
  throw new GelatoError(404, `No saved Gelato key reaches store ${storeId}`)
}

/** Saves a key after checking it reaches at least one store. */
export async function addGelatoKey(label: string, key: string): Promise<GelatoKey> {
  const stores = await storesOf(key.trim(), true)
  const keys = await gelatoKeys()
  const existing = keys.find((k) => k.key === key.trim())
  if (existing) return existing
  const entry = {
    id: `g${Date.now().toString(36)}`,
    label: label.trim() || stores.map((s) => s.name).join(", ") || "Gelato",
    key: key.trim(),
  }
  await setGelatoKeys([...keys, entry])
  return entry
}

export async function removeGelatoKey(id: string) {
  await setGelatoKeys((await gelatoKeys()).filter((k) => k.id !== id))
}

// --- Templates and products ---

export type TemplateVariant = {
  id: string
  title: string
  productUid: string
  variantOptions: { name: string; value: string }[]
  imagePlaceholders: { name: string; printArea: string; height: number; width: number }[]
}

export type GelatoTemplate = {
  id: string
  templateName: string
  title: string
  description: string
  previewUrl: string | null
  variants: TemplateVariant[]
  productType: string | null
  vendor: string | null
}

export const getTemplate = (key: string, templateId: string) =>
  request<GelatoTemplate>(key, `${ECOMMERCE}/templates/${encodeURIComponent(templateId)}`)

export type CreateFromTemplate = {
  templateId: string
  title: string
  description: string
  isVisibleInTheOnlineStore: boolean
  /** Shopify only. */
  salesChannels?: string[]
  tags: string[]
  productType?: string
  vendor?: string
  variants: { templateVariantId: string; imagePlaceholders: { name: string; fileUrl: string }[] }[]
}

export type GelatoProduct = {
  id: string
  storeId: string
  externalId: string | null
  title: string
  status: string
  isReadyToPublish: boolean
  publishingErrorCode: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  variants?: GelatoProductVariant[]
}

export type GelatoProductVariant = {
  id: string
  title: string
  productUid: string | null
  externalId?: string | null
  externalVariantId?: string | null
  connectionStatus: string
  designId?: string | null
  price?: number
  cost?: number
}

export const createFromTemplate = (key: string, storeId: string, body: CreateFromTemplate) =>
  request<GelatoProduct>(key, `${ECOMMERCE}/stores/${storeId}/products:create-from-template`, {
    method: "POST",
    json: body,
  })

export const getProduct = (key: string, storeId: string, productId: string) =>
  request<GelatoProduct>(key, `${ECOMMERCE}/stores/${storeId}/products/${productId}`)

export async function productVariants(key: string, storeId: string, productId: string) {
  const body = await request<{ productVariants: GelatoProductVariant[] }>(
    key,
    `${ECOMMERCE}/stores/${storeId}/products/${productId}/variants`
  )
  return body.productVariants ?? []
}

/** One page of a store's products, newest first. */
export const listProducts = (key: string, storeId: string, offset = 0, limit = 100) =>
  request<{ products: GelatoProduct[] }>(
    key,
    `${ECOMMERCE}/stores/${storeId}/products?limit=${limit}&offset=${offset}&order=desc&orderBy=createdAt`
  ).then((b) => b.products ?? [])

export const publishProduct = (key: string, storeId: string, productId: string) =>
  request<unknown>(key, `${ECOMMERCE}/stores/${storeId}/products/${productId}:publish`, { method: "POST", json: {} })

export const deleteProduct = (key: string, storeId: string, productId: string) =>
  request<unknown>(key, `${ECOMMERCE}/stores/${storeId}/products/${productId}`, { method: "DELETE" })

// --- Catalog, prices, orders ---

export type ProductPrice = { productUid: string; country: string; quantity: number; price: number; currency: string }

/** What Gelato charges for one print of `productUid` shipped to `country` (product only, before VAT). */
export const productPrices = (key: string, productUid: string, country: string, currency = "EUR") =>
  request<ProductPrice[]>(key, `${PRODUCT}/products/${productUid}/prices?country=${country}&currency=${currency}`)

export type OrderSummary = {
  id: string
  orderReferenceId: string
  storeId: string | null
  channel: string
  fulfillmentStatus: string
  financialStatus: string
  currency: string
  totalInclVat: string
  country: string
  itemsCount: number
  createdAt: string
  orderedAt: string | null
}

/**
 * Orders of the key's account, newest first: every store of it. Gelato takes
 * `storeIds` but doesn't narrow the answer by it, so callers keep only the
 * orders whose `storeId` is theirs.
 */
export async function searchOrders(
  key: string,
  { storeIds, offset = 0, limit = 100, from }: { storeIds?: string[]; offset?: number; limit?: number; from?: string } = {}
) {
  const body = await request<{ orders: OrderSummary[] }>(key, `${ORDER}/orders:search`, {
    method: "POST",
    json: { ...(storeIds && { storeIds }), offset, limit, ...(from && { startDate: from }) },
  })
  return body.orders ?? []
}

export type OrderDetail = OrderSummary & {
  items: { id: string; productUid: string; quantity: number; price?: number; itemReferenceId?: string }[]
  receipts?: {
    type: string
    currency: string
    items: { type: string; title: string; quantity: number; price: number; amount: number; priceInclVat?: number }[]
    productsPrice: number
    shippingPrice: number
    totalVat: number
    totalInclVat: number
  }[]
  shipment?: { shipmentMethodName?: string; totalWeight?: number; fulfillmentCountry?: string; packages?: { trackingCode?: string }[] }
}

export const getOrder = (key: string, orderId: string) => request<OrderDetail>(key, `${ORDER}/orders/${orderId}`)

export type Quote = {
  quotes: {
    id: string
    products: { productUid: string; price: number; currency: string; quantity: number }[]
    shipmentMethods: { name: string; shipmentMethodUid: string; price: number; currency: string; minDeliveryDays: number; maxDeliveryDays: number; type: string }[]
    fulfillmentCountry: string
  }[]
}

/** What one print would cost to make and ship to `country` (asks Gelato; creates nothing). */
export const quote = (key: string, productUid: string, country: string, currency = "EUR") =>
  request<Quote>(key, `${ORDER}/orders:quote`, {
    method: "POST",
    json: {
      orderReferenceId: `quote-${Date.now()}`,
      customerReferenceId: "quote",
      currency,
      allowMultipleQuotes: false,
      recipient: { country, firstName: "Quote", lastName: "Quote", addressLine1: "Quote 1", city: "Quote", postCode: "10115", email: "quote@example.com" },
      products: [{ itemReferenceId: "1", productUid, files: [{ type: "default", url: "https://example.com/x.jpg" }], quantity: 1 }],
    },
  })
