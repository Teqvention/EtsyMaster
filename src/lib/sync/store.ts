import { getTokens, isLive, listAccounts } from "@/lib/accounts/store"
import type { Account } from "@/lib/accounts/types"
import { docKeys, readDoc, updateDoc, writeDoc } from "@/lib/db/documents"
import { isLive as isServerLive } from "@/lib/db/workers"

import type {
  DailySnapshot,
  LedgerEntry,
  ProductionCost,
  Sale,
  SyncedListing,
  SyncedSection,
  SyncPart,
  SyncStatus,
} from "./types"

// The synced numbers, documents per account under sync/<account>/:
// listings, sections, sales, ledger, costs, the daily snapshots in
// daily/<YYYY-MM-DD>, and status with when each part last finished and
// where the incremental parts go on from. The sync writes through here.

const file = (account: string, name: string) => `sync/${account}/${name}`

/** What the status document holds: finished parts and the cursors of the incremental ones. */
export type StoredStatus = {
  listings: number | null
  sales: number | null
  ledger: number | null
  costs: number | null
  error?: string
  /** The server running this account's sync, while one does. */
  runner?: string
  /** Epoch ms: receipts modified up to here are in; ledger entries made up to here are in. */
  cursors: { receipts?: number; ledger?: number; costs?: number }
}

const EMPTY_STATUS: StoredStatus = { listings: null, sales: null, ledger: null, costs: null, cursors: {} }

const read = readDoc

/** Reads, changes and writes one of an account's documents, after every other change to it. */
export function change<T>(account: string, name: string, fallback: T, update: (current: T) => T) {
  return updateDoc(file(account, name), fallback, update)
}

/** Local calendar day of `ms`: the key of daily snapshots and of Artikel's ranges. */
export function dayKey(ms = Date.now()) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Start of the local day `key` (YYYY-MM-DD), epoch ms. */
export function dayStart(key: string) {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, m - 1, d).getTime()
}

// --- Accounts ---

/** Why `account` can't sync, or null when it can: it needs a shop and the shop owner's grant, still working. */
export async function syncBlocker(account: Account) {
  if (!account.shop) return "No Etsy shop linked"
  const tokens = await getTokens(account.id)
  if (!tokens) return "Not connected to Etsy"
  if (!isLive(tokens)) return tokens.error ? "Etsy refused the connection: connect it again" : "Etsy connection expired"
  return null
}

/** Accounts whose shop is ours: every account with a linked shop, connected or not. */
export async function shopAccounts() {
  return (await listAccounts()).filter((a) => a.shop)
}

async function accountIds(account?: string) {
  return account ? [account] : (await shopAccounts()).map((a) => a.id)
}

// --- Listings ---

export async function listings(account?: string): Promise<SyncedListing[]> {
  const ids = await accountIds(account)
  const lists = await Promise.all(ids.map((id) => read<SyncedListing[]>(file(id, "listings"), [])))
  return lists.flat()
}

export function saveListings(account: string, list: SyncedListing[]) {
  return writeDoc(file(account, "listings"), list)
}

/** Changes the local copy of one listing, e.g. after a price change went through on Etsy. */
export async function patchListing(
  account: string,
  listingId: number,
  update: (listing: SyncedListing) => SyncedListing
) {
  await change<SyncedListing[]>(account, "listings", [], (list) =>
    list.map((l) => (l.listingId === listingId ? { ...update(l), updatedAt: Date.now() } : l))
  )
}

export async function sections(account: string): Promise<SyncedSection[]> {
  return read<SyncedSection[]>(file(account, "sections"), [])
}

export function saveSections(account: string, list: SyncedSection[]) {
  return writeDoc(file(account, "sections"), list)
}

// --- Daily snapshots ---

export function saveSnapshot(account: string, snapshot: DailySnapshot) {
  return writeDoc(file(account, `daily/${snapshot.date}`), snapshot)
}

/** Days with a snapshot, oldest first. */
export async function snapshotDays(account: string) {
  const prefix = file(account, "daily/")
  return (await docKeys(prefix))
    .map((k) => k.slice(prefix.length))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
}

export async function snapshots(account: string, from: string, to: string): Promise<DailySnapshot[]> {
  const days = (await snapshotDays(account)).filter((d) => d >= from && d <= to)
  const list = await Promise.all(
    days.map((d) => read<DailySnapshot | null>(file(account, `daily/${d}`), null))
  )
  return list.filter((s): s is DailySnapshot => !!s)
}

/** The latest snapshot on or before `day`, if any. */
export async function snapshotBefore(account: string, day: string): Promise<DailySnapshot | null> {
  const last = (await snapshotDays(account)).filter((d) => d <= day).at(-1)
  return last ? read<DailySnapshot | null>(file(account, `daily/${last}`), null) : null
}

// --- Sales, fees, production costs ---

const within = (at: number, from?: number, to?: number) => (from === undefined || at >= from) && (to === undefined || at <= to)

async function gather<T extends { createdAt: number }>(name: string, from?: number, to?: number, account?: string) {
  const ids = await accountIds(account)
  const lists = await Promise.all(ids.map((id) => read<T[]>(file(id, name), [])))
  return lists.flat().filter((x) => within(x.createdAt, from, to))
}

export const sales = (from?: number, to?: number, account?: string) => gather<Sale>("sales", from, to, account)
export const ledger = (from?: number, to?: number, account?: string) =>
  gather<LedgerEntry>("ledger", from, to, account)
export const costs = (from?: number, to?: number, account?: string) =>
  gather<ProductionCost>("costs", from, to, account)

/** Puts `incoming` into the account's document, replacing entries with the same key. */
export function upsert<T>(account: string, name: string, incoming: T[], key: (item: T) => string | number) {
  return change<T[]>(account, name, [], (current) => {
    const byKey = new Map(current.map((item) => [key(item), item]))
    for (const item of incoming) byKey.set(key(item), item)
    return [...byKey.values()]
  })
}

// --- Status ---

export function storedStatus(account: string) {
  return read<StoredStatus>(file(account, "status"), EMPTY_STATUS)
}

export function saveStatus(account: string, update: (status: StoredStatus) => StoredStatus) {
  return change<StoredStatus>(account, "status", EMPTY_STATUS, (current) =>
    update({ ...EMPTY_STATUS, ...current, cursors: { ...current.cursors } })
  )
}

/** Live state of the syncs this server runs, kept by run.ts. */
export type Live = { running: Set<string>; step: Map<string, string>; nextAt: number | null }
const live = ((globalThis as typeof globalThis & { __syncLive?: Live }).__syncLive ??= {
  running: new Set(),
  step: new Map(),
  nextAt: null,
})
export const liveState = () => live

/** Every shop account's sync: when each part last finished, and what's running. */
export async function syncStatus(): Promise<SyncStatus[]> {
  const accounts = await shopAccounts()
  return Promise.all(
    accounts.map(async (a): Promise<SyncStatus> => {
      const [stored, blocked] = await Promise.all([storedStatus(a.id), syncBlocker(a)])
      return {
        account: a.id,
        label: a.label,
        shopName: a.shop?.name ?? null,
        listings: stored.listings,
        sales: stored.sales,
        ledger: stored.ledger,
        costs: stored.costs,
        running: live.running.has(a.id) || (!!stored.runner && (await isServerLive(stored.runner))),
        ...(stored.error && { error: stored.error }),
        ...(blocked && { blocked }),
        ...(live.step.has(a.id) && { step: live.step.get(a.id) }),
        nextAt: blocked ? null : live.nextAt,
      }
    })
  )
}

/** When a part last finished for `account`, epoch ms. */
export async function lastSynced(account: string, part: SyncPart) {
  return (await storedStatus(account))[part]
}
