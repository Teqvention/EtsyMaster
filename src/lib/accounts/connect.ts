import { etsyRequest, type ApiPage } from "@/lib/etsy/client"
import { recordCall, recordUsage } from "@/lib/etsy/usage"
import { allStores } from "@/lib/gelato/client"

import { getAccount, getKey, getTokens, listAccounts, patchAccount, setTokens } from "./store"
import type { Account, AccountTokens, ListingDefaults, ShopOptions } from "./types"

// After the shop owner granted access: which shop the account is, which
// Gelato store prints for it, and what the shop offers for new listings
// (shipping profiles, return policies, processing times, production
// partners, sections). Where there's one obvious choice it becomes the
// listing default; the rest is picked in Settings. About seven requests.
//
// Etsy grants access for whoever is signed in on etsy.com in that browser,
// so connecting three shops one after another easily lands on the same shop
// twice. A grant is only kept once it's proven to belong to the account's
// shop: a second upload account on a shop that has one already, or a known
// account signing in as another shop, is refused and the old grant stays.

const API = "https://openapi.etsy.com/v3/application"
const USER_AGENT = "etsy-dashboard/1.0"

/** One request with `account`'s key outside the client (no grant kept yet), booked on its quota. */
async function direct<T>(account: string, path: string, key: string, accessToken?: string): Promise<T> {
  const sentAt = Date.now()
  await recordCall(account, sentAt)
  let res: Response
  try {
    res = await fetch(API + path, {
      headers: {
        "x-api-key": key,
        "User-Agent": USER_AGENT,
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      },
      cache: "no-store",
    })
  } catch (error) {
    throw new Error(`Etsy unreachable: ${(error as Error).message}`)
  }
  await recordUsage(account, res.headers, sentAt)
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !body) throw new Error(body?.error ?? res.statusText)
  return body
}

/** Checks a key with Etsy before it's saved (one request); answers with the app id Etsy knows it by. */
export async function verifyKey(account: string, keystring: string, secret: string) {
  try {
    const { application_id } = await direct<{ application_id: number }>(
      account,
      "/openapi-ping",
      `${keystring.trim()}:${secret.trim()}`
    )
    return String(application_id)
  } catch (error) {
    throw new Error(`Etsy doesn't accept this key: ${(error as Error).message}`)
  }
}

export class WrongShopError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WrongShopError"
  }
}

/**
 * Finishes a sign-in: checks whose shop the new grant opens, keeps it when
 * it's the right one and reads the shop. The account's old grant stays when
 * it isn't.
 */
export async function connectAccount(id: string, tokens: AccountTokens): Promise<Account> {
  const key = await getKey(id)
  if (!key) throw new Error(`${id} has no API key`)
  const me = await direct<Me>(id, "/users/me", `${key.keystring}:${key.secret}`, tokens.accessToken)
  const self = await getAccount(id)
  if (!me.shop_id) {
    throw new WrongShopError("The Etsy user who signed in has no shop. Sign in to Etsy as the shop's owner and connect again.")
  }
  if (self.shop && self.shop.id !== me.shop_id) {
    throw new WrongShopError(
      `Etsy signed in with another shop (#${me.shop_id}), but ${self.label} is ${self.shop.name}. Sign in to Etsy as ${self.shop.name}'s owner (a private window helps) and connect again.`
    )
  }
  if (self.role === "upload") {
    const taken = (await listAccounts()).find((a) => a.id !== id && a.shop?.id === me.shop_id)
    if (taken) {
      throw new WrongShopError(
        `Etsy signed in as ${taken.shop!.name}, which ${taken.label} uses already. Sign in to Etsy as the owner of ${self.label}'s shop (a private window helps) and connect again.`
      )
    }
  }
  await setTokens(id, { ...tokens, userId: me.user_id || tokens.userId })
  return linkShop(id, me)
}

type Me = { user_id: number; shop_id: number | null }

type Shop = {
  shop_id: number
  shop_name: string
  user_id: number
  currency_code: string
  url: string
  create_date: number
}

type ShippingProfile = {
  shipping_profile_id: number
  title: string
  is_deleted?: boolean
  shipping_profile_destinations?: { primary_cost?: { amount: number }; min_delivery_days?: number | null; max_delivery_days?: number | null }[]
}

type ReturnPolicy = { return_policy_id: number; accepts_returns: boolean; accepts_exchanges: boolean; return_deadline: number | null }
type Readiness = { readiness_state_id: number; readiness_state?: string; min_processing_days?: number; max_processing_days?: number; processing_days_display_label?: string }
type Partner = { production_partner_id: number; partner_name: string; location: string }
type Section = { shop_section_id: number; title: string; active_listing_count: number }

/** Reads who the account is (unless `me` says so already) and everything new listings need from its shop. */
export async function linkShop(id: string, known?: Me): Promise<Account> {
  if (!(await getTokens(id))) throw new Error(`${id} isn't connected to Etsy`)
  const me = known ?? (await etsyRequest<Me>("/users/me", { account: id, auth: true }))
  if (!me.shop_id) throw new WrongShopError("The Etsy user who signed in has no shop")
  const shop = await etsyRequest<Shop>(`/shops/${me.shop_id}`, { account: id })
  const options = await readOptions(id, shop.shop_id)

  // Gelato names each store after the Etsy shop it's connected to.
  const stores = await allStores(true).catch(() => [])
  const store = stores.find(
    (s) => s.type === "etsy" && (s.domain?.toLowerCase().endsWith(`/shop/${shop.shop_name.toLowerCase()}`) || s.name === shop.shop_name)
  )

  return patchAccount(id, (account) => ({
    ...account,
    label: account.label.startsWith("Account ") ? shop.shop_name : account.label,
    shop: {
      id: shop.shop_id,
      name: shop.shop_name,
      userId: me.user_id,
      currency: shop.currency_code,
      url: shop.url,
      createdAt: shop.create_date ? new Date(shop.create_date * 1000).toISOString() : null,
    },
    gelato:
      store && store.id !== account.gelato?.storeId
        ? { storeId: store.id, storeName: store.name, templateId: null, templateIdLandscape: null }
        : account.gelato,
    signature: account.signature ?? `Robin · ${spaced(shop.shop_name)}`,
    options,
    listing: obviousDefaults(account.listing, options),
  }))
}

/**
 * Reads the shop's shipping profiles, policies, processing times, partners
 * and sections again; the whole shop when it isn't known yet (a sign-in whose
 * second half failed). Any request with the grant also keeps it from running out.
 */
export async function refreshOptions(id: string) {
  const account = await getAccount(id)
  if (!account.shop) return linkShop(id)
  const options = await readOptions(id, account.shop.id)
  return patchAccount(id, (a) => ({ ...a, options, listing: obviousDefaults(a.listing, options) }))
}

async function readOptions(id: string, shopId: number): Promise<ShopOptions> {
  const get = <T>(path: string) => etsyRequest<T>(path, { account: id, auth: true })
  const [shipping, returns, readiness, partners, sections] = await Promise.all([
    get<ApiPage<ShippingProfile>>(`/shops/${shopId}/shipping-profiles`),
    get<ApiPage<ReturnPolicy>>(`/shops/${shopId}/policies/return`),
    get<ApiPage<Readiness>>(`/shops/${shopId}/readiness-state-definitions`).catch(() => ({ count: 0, results: [] })),
    get<ApiPage<Partner>>(`/shops/${shopId}/production-partners`).catch(() => ({ count: 0, results: [] })),
    get<ApiPage<Section>>(`/shops/${shopId}/sections`),
  ])
  return {
    shippingProfiles: shipping.results
      .filter((p) => !p.is_deleted)
      .map((p) => {
        const destinations = p.shipping_profile_destinations ?? []
        const days = destinations.flatMap((d) => [d.min_delivery_days, d.max_delivery_days]).filter((d): d is number => typeof d === "number")
        return {
          id: p.shipping_profile_id,
          title: p.title,
          minDays: days.length ? Math.min(...days) : null,
          maxDays: days.length ? Math.max(...days) : null,
          free: destinations.length > 0 && destinations.every((d) => (d.primary_cost?.amount ?? 0) === 0),
        }
      }),
    returnPolicies: returns.results.map((r) => ({
      id: r.return_policy_id,
      acceptsReturns: r.accepts_returns,
      acceptsExchanges: r.accepts_exchanges,
      deadline: r.return_deadline,
    })),
    readinessStates: readiness.results.map((r) => ({
      id: r.readiness_state_id,
      label:
        r.processing_days_display_label ??
        `${r.readiness_state === "ready_to_ship" ? "Ready to ship" : "Made to order"}, ${r.min_processing_days ?? "?"}–${r.max_processing_days ?? "?"} days`,
    })),
    productionPartners: partners.results.map((p) => ({ id: p.production_partner_id, name: p.partner_name, location: p.location })),
    sections: sections.results.map((s) => ({ id: s.shop_section_id, title: s.title, count: s.active_listing_count })),
    readAt: new Date().toISOString(),
  }
}

/** Fills a default nobody chose yet when the shop leaves only one sensible option. */
function obviousDefaults(current: ListingDefaults, options: ShopOptions): ListingDefaults {
  const pick = <T extends { id: number }>(value: number | null, list: T[], prefer?: (item: T) => boolean) => {
    if (value !== null && list.some((i) => i.id === value)) return value
    const preferred = prefer ? list.filter(prefer) : list
    return preferred.length === 1 ? preferred[0].id : list.length === 1 ? list[0].id : null
  }
  return {
    ...current,
    // Gelato makes dozens of its own profiles when it connects; a free one is ours.
    shippingProfileId: pick(current.shippingProfileId, options.shippingProfiles, (p) => p.free),
    returnPolicyId: pick(current.returnPolicyId, options.returnPolicies),
    readinessStateId: pick(current.readinessStateId, options.readinessStates),
    productionPartnerIds: current.productionPartnerIds.length
      ? current.productionPartnerIds.filter((id) => options.productionPartners.some((p) => p.id === id))
      : options.productionPartners.length === 1
        ? [options.productionPartners[0].id]
        : [],
    shopSectionId:
      current.shopSectionId !== null && options.sections.some((s) => s.id === current.shopSectionId)
        ? current.shopSectionId
        : null,
  }
}

/** "Poster4Travelers" → "Poster 4 Travelers" for the signature line. */
const spaced = (name: string) =>
  name
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .trim()
