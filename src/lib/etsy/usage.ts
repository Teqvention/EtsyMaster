import { readDoc, updateDoc } from "@/lib/db/documents"

// What's left of each Etsy key's quota: 5,000 requests in a rolling 24 hours.
// Etsy reports the remainder on every response; between responses it is
// worked out here from the requests we sent ourselves: one that leaves the
// 24-hour window frees a request again. So the sidebar stays current without
// spending requests on pings, and a run knows before it starts what it has.
// Kept in the "usage/etsy" document, so a restart keeps the reading, and
// merged with what the other servers sent on the same keys.

const WINDOW = 24 * 60 * 60 * 1000
const FILE = "usage/etsy"
const DEFAULT_LIMIT = 5000

export type EtsyUsage = {
  limitPerDay: number
  remainingToday: number
  /** ISO time of the reading the numbers come from. */
  updatedAt: string
  /** Worked out from our own requests since Etsy last reported. */
  estimated?: boolean
  /** Over quota: no request goes out before this ISO time. */
  blockedUntil?: string
}

type Track = {
  /** Etsy's last word: what was left at `at` (epoch ms, Etsy's clock). */
  reading?: { remaining: number; limit: number; at: number }
  /** Epoch ms of every request we sent in the last 24 hours. */
  calls: number[]
  blockedUntil?: number
}

type Store = {
  tracks?: Map<string, Track>
  /** The saved document last merged in: a new one means another server saved. */
  seen?: Record<string, Track>
  saveTimer?: ReturnType<typeof setTimeout>
}

// On globalThis, because route handlers and server components load separate
// copies of this module; both should see one reading.
const global = globalThis as typeof globalThis & { __etsyQuota?: Store }
const store = (global.__etsyQuota ??= {})

async function tracks() {
  const saved = await readDoc<Record<string, Track>>(FILE, {})
  store.tracks ??= new Map()
  if (saved !== store.seen) {
    merge(store.tracks, saved)
    store.seen = saved
  }
  return store.tracks
}

function track(all: Map<string, Track>, account: string) {
  let t = all.get(account)
  if (!t) all.set(account, (t = { calls: [] }))
  return t
}

/** Adds another server's tracks to ours: every request either sent, and the newer reading with its block. */
function merge(into: Map<string, Track>, saved: Record<string, Track>) {
  for (const [id, other] of Object.entries(saved)) {
    const t = track(into, id)
    if (other.reading && (!t.reading || other.reading.at > t.reading.at)) {
      t.reading = other.reading
      t.blockedUntil = other.blockedUntil
    } else if (!t.reading && (other.blockedUntil ?? 0) > (t.blockedUntil ?? 0)) t.blockedUntil = other.blockedUntil
    t.calls = [...new Set([...t.calls, ...other.calls])].sort((a, b) => a - b)
  }
}

function save() {
  clearTimeout(store.saveTimer)
  store.saveTimer = setTimeout(() => {
    updateDoc<Record<string, Track>>(FILE, {}, (saved) => {
      const all = store.tracks ?? new Map<string, Track>()
      merge(all, saved)
      const now = Date.now()
      const out: Record<string, Track> = {}
      for (const [id, t] of all) out[id] = { ...t, calls: t.calls.filter((c) => c > now - WINDOW) }
      return out
    })
      .then((saved) => (store.seen = saved))
      .catch((error) => console.error("Couldn't save Etsy usage:", error))
  }, 5_000)
}

/** Books one request about to go out on `account`'s key. */
export async function recordCall(account: string, at = Date.now()) {
  const t = track(await tracks(), account)
  t.calls.push(at)
  if (t.calls.length > DEFAULT_LIMIT * 1.5) t.calls = t.calls.filter((c) => c > at - WINDOW)
  save()
}

/** Takes Etsy's reading off a response sent at `sentAt` (epoch ms). */
export async function recordUsage(account: string, headers: Headers, sentAt: number) {
  const remaining = Number(headers.get("x-remaining-today"))
  if (!headers.has("x-remaining-today") || !Number.isFinite(remaining)) return
  // Dated by Etsy's `Date` header. In dev, Next replays cached fetch
  // responses (headers and all) after a reload: one dated well before we
  // asked is a replay, and its old numbers must not overwrite newer ones.
  const at = Date.parse(headers.get("date") ?? "") || Date.now()
  if (at < sentAt - 5_000) return
  const t = track(await tracks(), account)
  if (t.reading && at < t.reading.at) return
  const limit = Number(headers.get("x-limit-per-day")) || t.reading?.limit || DEFAULT_LIMIT
  t.reading = { remaining, limit, at }
  if (remaining > 0 && t.blockedUntil) t.blockedUntil = undefined
  save()
}

/** No request on `account` until `until` (epoch ms): Etsy said the day's quota is gone. */
export async function blockAccount(account: string, until: number) {
  const t = track(await tracks(), account)
  t.blockedUntil = until
  if (t.reading) t.reading = { ...t.reading, remaining: 0, at: Date.now() }
  save()
}

/** What's left on `account`'s key now; null before anything is known. */
export async function usageOf(account: string, now = Date.now()): Promise<EtsyUsage | null> {
  const t = (await tracks()).get(account)
  if (!t) return null
  const blocked = t.blockedUntil && t.blockedUntil > now ? new Date(t.blockedUntil).toISOString() : undefined
  if (!t.reading) {
    const recent = t.calls.filter((c) => c > now - WINDOW).length
    if (!recent) return null
    return {
      limitPerDay: DEFAULT_LIMIT,
      remainingToday: Math.max(0, DEFAULT_LIMIT - recent),
      updatedAt: new Date(now).toISOString(),
      estimated: true,
      blockedUntil: blocked,
    }
  }
  const { remaining, limit, at } = t.reading
  // Requests sent since the reading count against it; the ones that left the
  // window since (sent in the 24 hours before it) are free again.
  let since = 0
  let freed = 0
  for (const c of t.calls) {
    if (c > at + 1_000) since++
    else if (c > at - WINDOW && c <= now - WINDOW) freed++
  }
  const value = Math.min(limit, Math.max(0, remaining - since + freed))
  return {
    limitPerDay: limit,
    remainingToday: blocked ? 0 : value,
    updatedAt: new Date(Math.max(at, now - 1)).toISOString(),
    estimated: since + freed > 0,
    blockedUntil: blocked,
  }
}

/** Requests `account` sent in the last 24 hours, by us. */
export async function callsToday(account: string, now = Date.now()) {
  return ((await tracks()).get(account)?.calls ?? []).filter((c) => c > now - WINDOW).length
}

/** Sum over several accounts, e.g. the analysis pool. */
export function combine(usages: (EtsyUsage | null)[]): EtsyUsage | null {
  const known = usages.filter((u): u is EtsyUsage => !!u)
  if (!known.length) return null
  return {
    limitPerDay: known.reduce((s, u) => s + u.limitPerDay, 0),
    remainingToday: known.reduce((s, u) => s + u.remainingToday, 0),
    updatedAt: known.map((u) => u.updatedAt).sort().at(-1)!,
    estimated: known.some((u) => u.estimated),
  }
}
