// The Etsy accounts the app works with. Each one is an Etsy app (its API key)
// and, for a shop we sell in, the shop owner's OAuth grant. Upload accounts
// get the new listings; analysis accounts serve every public read (research,
// shop analyses), the less used one first. Settings live in
// the document "accounts"; keys and tokens apart, under secrets/.

export type AccountRole = "upload" | "analysis"

/**
 * Everything the app asks a shop owner to grant, up front: a scope added
 * later means signing in again. Etsy's consent is all or nothing.
 */
export const ETSY_SCOPES = [
  "listings_r",
  "listings_w",
  "listings_d",
  "shops_r",
  "shops_w",
  "transactions_r",
  "transactions_w",
  "profile_r",
] as const

/** What a live upload can't do without: reading the shop, writing listings. */
export const UPLOAD_SCOPES = ["listings_r", "listings_w", "shops_r"] as const

export const WHEN_MADE = ["made_to_order", "2020_2026", "2010_2019"] as const

/** What every new listing of the account gets. Null leaves Gelato's choice alone. */
export type ListingDefaults = {
  shippingProfileId: number | null
  returnPolicyId: number | null
  readinessStateId: number | null
  productionPartnerIds: number[]
  shopSectionId: number | null
  taxonomyId: number
  materials: string[]
  whoMade: "i_did" | "collective" | "someone_else"
  whenMade: (typeof WHEN_MADE)[number]
  /** Renews every four months for another listing fee; off unless chosen. */
  shouldAutoRenew: boolean
}

export const DEFAULT_LISTING: ListingDefaults = {
  shippingProfileId: null,
  returnPolicyId: null,
  readinessStateId: null,
  productionPartnerIds: [],
  shopSectionId: null,
  taxonomyId: 121,
  // Gelato's premium matte poster (sizes.ts): 200 gsm, uncoated.
  materials: ["Matte poster paper", "200 gsm paper", "Uncoated paper"],
  whoMade: "i_did",
  whenMade: "made_to_order",
  shouldAutoRenew: false,
}

/** What the shop offers to choose from, read when it's connected. */
export type ShopOptions = {
  shippingProfiles: { id: number; title: string; minDays: number | null; maxDays: number | null; free: boolean }[]
  returnPolicies: { id: number; acceptsReturns: boolean; acceptsExchanges: boolean; deadline: number | null }[]
  readinessStates: { id: number; label: string }[]
  productionPartners: { id: number; name: string; location: string }[]
  sections: { id: number; title: string; count: number }[]
  /** ISO 8601 */
  readAt: string
}

export type AccountShop = {
  id: number
  name: string
  userId: number | null
  currency: string | null
  url: string | null
  /** ISO 8601, when Etsy opened the shop. */
  createdAt: string | null
}

export type AccountGelato = {
  storeId: string
  storeName: string | null
  /** Gelato template with the offered sizes, portrait; listings are made from it. */
  templateId: string | null
  /** Same for landscape posters; landscape uploads wait without one. */
  templateIdLandscape: string | null
  /** The last check of each template, by template id (only the two in use are kept). */
  checks?: Record<string, TemplateStatus>
}

/** What checking a Gelato template against the offered sizes found. */
export type TemplateStatus = {
  ok: boolean
  name: string
  orientation: "ver" | "hor" | "mixed" | null
  /** Sizes (SizeKey) the template has no variant for. */
  missing: string[]
  problems: string[]
  /** ISO 8601 */
  checkedAt: string
}

export type Account = {
  /** Short and stable, e.g. "acc1". */
  id: string
  label: string
  role: AccountRole
  /** Etsy app id (developer portal). */
  appId: string | null
  shop: AccountShop | null
  gelato: AccountGelato | null
  /** Mockup chain new listings are shown in; the default chain when null. */
  chainId: string | null
  priceProfileId: string | null
  listing: ListingDefaults
  options: ShopOptions | null
  /** Closes every description, e.g. "Robin · Poster4Travelers". */
  signature: string | null
  /** One-off cost of opening the shop, in cents (EUR), for Performance. */
  setupFeeCents: number
  /** New listings per day the account aims for when a big upload is paced. */
  dailyTarget: number
  /** ISO 8601 */
  createdAt: string
  updatedAt: string
}

export type AccountKey = { keystring: string; secret: string }

export type AccountTokens = {
  accessToken: string
  refreshToken: string
  /** Epoch ms. */
  expiresAt: number
  scope: string
  userId: number
  /** Epoch ms; the refresh token lasts 90 days from here. */
  obtainedAt: number
  /** Etsy refused to renew the grant (revoked, or the app's key changed); connecting again fixes it. */
  error?: string
}

/** One thing a live upload needs from an upload account, done or not. */
export type ReadinessCheck = {
  key: "key" | "connection" | "shop" | "store" | "template" | "prices"
  label: string
  done: boolean
  /** What to do about it while it isn't done. */
  hint: string
}

/** What the browser gets: no keys, no tokens. */
export type AccountView = Account & {
  hasKey: boolean
  /** Holds a refresh token that hasn't run out and Etsy hasn't refused. */
  connected: boolean
  /** Why a grant the account holds doesn't work any more. */
  connectionError: string | null
  scopes: string[]
  /** Epoch ms the refresh token runs out (90 days after the last refresh). */
  connectionExpiresAt: number | null
  /** Upload accounts: everything a live upload needs, in the order it's set up. */
  checks: ReadinessCheck[]
  /** The labels of the checks not done yet: what stands between this account and a live upload. */
  missing: string[]
}

/** What the settings page may change. */
export type AccountPatch = Partial<
  Pick<
    Account,
    "label" | "role" | "appId" | "chainId" | "priceProfileId" | "signature" | "setupFeeCents" | "dailyTarget"
  >
> & {
  listing?: Partial<ListingDefaults>
  gelato?: Partial<AccountGelato> | null
}

export const REFRESH_TOKEN_DAYS = 90
