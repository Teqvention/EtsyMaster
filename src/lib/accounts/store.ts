import { readDoc, updateDoc } from "@/lib/db/documents"
import { NotFoundError } from "@/lib/mockups/storage"

import {
  DEFAULT_LISTING,
  ETSY_SCOPES,
  REFRESH_TOKEN_DAYS,
  UPLOAD_SCOPES,
  type Account,
  type AccountGelato,
  type AccountKey,
  type AccountPatch,
  type AccountTokens,
  type AccountView,
  type ReadinessCheck,
} from "./types"

// Accounts in the shared database: settings in "accounts", Etsy keys in
// "secrets/etsy-keys", OAuth tokens in "secrets/etsy-tokens", Gelato keys in
// "secrets/gelato-keys". Every change from the app goes through here, one
// transaction each, so two servers never write over each other.

const ACCOUNTS = "accounts"
const KEYS = "secrets/etsy-keys"
const TOKENS = "secrets/etsy-tokens"
const GELATO = "secrets/gelato-keys"

export type GelatoKey = { id: string; label: string; key: string }

function normalise(account: Partial<Account> & { id: string }): Account {
  const now = new Date().toISOString()
  return {
    label: account.id,
    role: "upload",
    appId: null,
    shop: null,
    gelato: null,
    chainId: null,
    priceProfileId: null,
    options: null,
    signature: null,
    setupFeeCents: 0,
    dailyTarget: 150,
    createdAt: now,
    updatedAt: now,
    ...account,
    listing: { ...DEFAULT_LISTING, ...account.listing },
  }
}

const readAccounts = async () => (await readDoc<Account[]>(ACCOUNTS, [])).map(normalise)

/** Reads, changes and writes the account list in one step. */
function changeAccounts(change: (list: Account[]) => Account[]) {
  return updateDoc<Account[]>(ACCOUNTS, [], (list) => change(list.map(normalise)))
}

export async function listAccounts(): Promise<Account[]> {
  return readAccounts()
}

export async function getAccount(id: string) {
  const account = (await listAccounts()).find((a) => a.id === id)
  if (!account) throw new NotFoundError(`Unknown account ${id}`)
  return account
}

export const accountsByRole = async (role: Account["role"]) =>
  (await listAccounts()).filter((a) => a.role === role)

/** Changes one account; answers with it. */
export async function patchAccount(id: string, change: (account: Account) => Account) {
  let changed: Account | undefined
  await changeAccounts((list) =>
    list.map((account) => {
      if (account.id !== id) return account
      changed = { ...change(account), id, updatedAt: new Date().toISOString() }
      return changed
    })
  )
  if (!changed) throw new NotFoundError(`Unknown account ${id}`)
  return changed
}

export async function addAccount(init: Partial<Account> & { id: string; label: string }, key?: AccountKey) {
  const account = normalise(init)
  await changeAccounts((list) => {
    if (list.some((a) => a.id === account.id)) throw new Error(`An account ${account.id} exists already`)
    return [...list, account]
  })
  if (key) await setKey(account.id, key)
  return account
}

export async function removeAccount(id: string) {
  await getAccount(id)
  await changeAccounts((list) => list.filter((a) => a.id !== id))
  await updateDoc<Record<string, AccountKey>>(KEYS, {}, (keys) => {
    delete keys[id]
    return keys
  })
  await setTokens(id, null)
}

/** Applies what the settings page sends. */
export function applyPatch(account: Account, patch: AccountPatch): Account {
  return {
    ...account,
    ...(patch.label !== undefined && { label: patch.label.trim().slice(0, 40) || account.label }),
    ...(patch.role !== undefined && { role: patch.role }),
    ...(patch.appId !== undefined && { appId: patch.appId?.trim() || null }),
    ...(patch.chainId !== undefined && { chainId: patch.chainId }),
    ...(patch.priceProfileId !== undefined && { priceProfileId: patch.priceProfileId }),
    ...(patch.signature !== undefined && { signature: patch.signature?.trim().slice(0, 80) || null }),
    ...(patch.setupFeeCents !== undefined && { setupFeeCents: Math.max(0, Math.round(patch.setupFeeCents)) }),
    ...(patch.dailyTarget !== undefined && { dailyTarget: Math.min(400, Math.max(1, Math.round(patch.dailyTarget))) }),
    ...(patch.listing && { listing: { ...account.listing, ...patch.listing } }),
    ...(patch.gelato !== undefined && {
      gelato: patch.gelato === null ? null : withChecks(nextGelato(account, patch.gelato), account.gelato?.checks),
    }),
  }
}

function nextGelato(account: Account, patch: NonNullable<AccountPatch["gelato"]>): AccountGelato {
  // A template belongs to its Gelato account: a new store starts without one.
  const same = patch.storeId === undefined || patch.storeId === account.gelato?.storeId
  return {
    storeId: patch.storeId ?? account.gelato?.storeId ?? "",
    storeName: patch.storeName !== undefined ? patch.storeName : same ? (account.gelato?.storeName ?? null) : null,
    templateId: clean(patch.templateId, same ? account.gelato?.templateId : null),
    templateIdLandscape: clean(patch.templateIdLandscape, same ? account.gelato?.templateIdLandscape : null),
  }
}

/** Keeps the checks of the templates still in use. */
export function withChecks(gelato: AccountGelato, checks: AccountGelato["checks"]): AccountGelato {
  const kept = Object.fromEntries(
    Object.entries(checks ?? {}).filter(([id]) => id === gelato.templateId || id === gelato.templateIdLandscape)
  )
  return { ...gelato, ...(Object.keys(kept).length ? { checks: kept } : {}) }
}

const clean = (value: string | null | undefined, current: string | null | undefined) =>
  value === undefined ? (current ?? null) : value?.trim() || null

// --- Secrets ---

const readKeys = () => readDoc<Record<string, AccountKey>>(KEYS, {})

export async function getKey(id: string): Promise<AccountKey | null> {
  return (await readKeys())[id] ?? null
}

export async function setKey(id: string, key: AccountKey) {
  await updateDoc<Record<string, AccountKey>>(KEYS, {}, (keys) => ({
    ...keys,
    [id]: { keystring: key.keystring.trim(), secret: key.secret.trim() },
  }))
}

const readTokens = () => readDoc<Record<string, AccountTokens>>(TOKENS, {})

export async function getTokens(id: string): Promise<AccountTokens | null> {
  return (await readTokens())[id] ?? null
}

export function setTokens(id: string, tokens: AccountTokens | null) {
  return changeTokens(id, async () => tokens)
}

/**
 * Changes one account's grant in one step that holds every account's
 * tokens meanwhile, on every server: a renewal never runs twice at once (a
 * second one would send a refresh token the first already used up).
 */
export async function changeTokens(
  id: string,
  change: (tokens: AccountTokens | null) => Promise<AccountTokens | null>
): Promise<AccountTokens | null> {
  let next: AccountTokens | null = null
  await updateDoc<Record<string, AccountTokens>>(TOKENS, {}, async (all) => {
    next = await change(all[id] ?? null)
    if (next) all[id] = next
    else delete all[id]
    return all
  })
  return next
}

export async function gelatoKeys(): Promise<GelatoKey[]> {
  return readDoc<GelatoKey[]>(GELATO, [])
}

export async function setGelatoKeys(keys: GelatoKey[]) {
  await updateDoc<GelatoKey[]>(GELATO, [], () => keys)
}

// --- For the browser ---

const DAY = 24 * 60 * 60 * 1000

/** Whether a grant still works as far as we know: not run out, not refused by Etsy. */
export const isLive = (tokens: AccountTokens | null, now = Date.now()) =>
  !!tokens && !tokens.error && tokens.obtainedAt + REFRESH_TOKEN_DAYS * DAY > now

export async function accountView(account: Account): Promise<AccountView> {
  const [key, tokens] = await Promise.all([getKey(account.id), getTokens(account.id)])
  const connected = isLive(tokens)
  const scopes = tokens?.scope.split(/\s+/).filter(Boolean) ?? []
  const checks = readiness(account, !!key, connected, scopes)
  return {
    ...account,
    hasKey: !!key,
    connected,
    connectionError:
      tokens?.error ?? (tokens && !connected ? "The connection ran out after 90 days without use" : null),
    scopes,
    connectionExpiresAt: tokens ? tokens.obtainedAt + REFRESH_TOKEN_DAYS * DAY : null,
    checks,
    missing: checks.filter((c) => !c.done).map((c) => c.label),
  }
}

/** Everything a live upload needs from an upload account, in the order it's set up; none for analysis accounts. */
export function readiness(
  account: Account,
  hasKey: boolean,
  connected: boolean,
  scopes: readonly string[] = ETSY_SCOPES
): ReadinessCheck[] {
  if (account.role !== "upload") return []
  const lacking = UPLOAD_SCOPES.filter((s) => !scopes.includes(s))
  const template = account.gelato?.templateId
  const check = template ? account.gelato?.checks?.[template] : undefined
  return [
    { key: "key", label: "API key", done: hasKey, hint: "Add the Etsy app's keystring and shared secret" },
    {
      key: "connection",
      label: "Etsy connection",
      done: connected && lacking.length === 0,
      hint: connected ? `Connect again to grant ${lacking.join(", ")}` : "Connect, signed in to Etsy as the shop's owner",
    },
    { key: "shop", label: "Etsy shop", done: !!account.shop, hint: "Read the shop the connection belongs to" },
    { key: "store", label: "Gelato store", done: !!account.gelato?.storeId, hint: "Pick the Gelato store printing for the shop" },
    {
      key: "template",
      label: "Gelato template",
      // Unchecked counts until a check says otherwise; a broken one would fail every upload.
      done: !!template && check?.ok !== false,
      hint: check && !check.ok ? check.problems[0] : "Paste the ID of the portrait template with the nine sizes",
    },
    { key: "prices", label: "Price profile", done: !!account.priceProfileId, hint: "Pick the prices new listings get" },
  ]
}

/** What an upload account still needs before a live upload; empty when ready. */
export function missingForUpload(account: Account, hasKey: boolean, connected: boolean) {
  return readiness(account, hasKey, connected)
    .filter((c) => !c.done)
    .map((c) => c.label)
}

export async function accountViews() {
  return Promise.all((await listAccounts()).map(accountView))
}
