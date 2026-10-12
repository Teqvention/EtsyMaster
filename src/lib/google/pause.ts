import { readDoc, writeDoc } from "@/lib/db/documents"

// One switch that stops every call to Google (Vertex, Gemini, Cloud Storage)
// on every server: kept in the shared database, checked before each call is
// signed in (see auth() in mockups/gemini.ts). While it's on, the batch poller,
// the online lane, the outbox and the generation queue wait instead of failing;
// switching it off sets them going again (see generation/run.ts).
//
// It also switches itself on when Google keeps turning us away for good
// (see `deniedByGoogle`), saying why.

export const PAUSE_KEY = "google/pause"

export type GooglePause = {
  paused: boolean
  at: string | null
  /** Why it paused by itself; not set when paused by hand. */
  reason?: string
}

const OFF: GooglePause = { paused: false, at: null }

export function googlePause() {
  return readDoc<GooglePause>(PAUSE_KEY, OFF)
}

export async function googlePaused() {
  return (await googlePause()).paused
}

export async function setGooglePaused(paused: boolean, reason?: string): Promise<GooglePause> {
  const value: GooglePause = { paused, at: new Date().toISOString(), ...(paused && reason && { reason }) }
  await writeDoc(PAUSE_KEY, value)
  return value
}

export class GooglePausedError extends Error {
  constructor() {
    super("Google is paused: nothing goes to Google until it's switched back on")
  }
}

// Everything is paused, on every server, until someone has looked and
// switched it back on, when Google keeps telling us something sending more
// can't fix. A single answer like that can be a fluke and pauses nothing.
// Asked to keep going regardless, a project gets suspended: Google's own
// systems flag accounts that go on sending what it refuses.

type Strikes = Record<string, number[]>
const global = globalThis as typeof globalThis & { __googleStrikes?: Strikes }
const strikes: Strikes = (global.__googleStrikes ??= {})

async function strike(kind: string, limit: number, window: number, reason: string, count = 1) {
  const now = Date.now()
  const recent = (strikes[kind] ?? []).filter((at) => now - at < window)
  for (let i = 0; i < count; i++) recent.push(now)
  strikes[kind] = recent
  if (recent.length < limit) return
  strikes[kind] = []
  try {
    if (await googlePaused()) return
    await setGooglePaused(true, reason.slice(0, 400))
    console.error(`Google paused by itself: ${reason}`)
  } catch (error) {
    console.error("Couldn't pause Google:", error)
  }
}

/**
 * Google refusing us outright (signed out, permission denied, billing off,
 * the project suspended) can't be waited out: every image left would fail,
 * and knocking on would only look worse. Three within ten minutes pause.
 */
export async function deniedByGoogle(where: string, status: number, message: string) {
  console.error(`Google refused (${where}, ${status}): ${message}`)
  await strike("denied", 3, 10 * 60_000, `${where} answered ${status}: ${message}`)
}

/**
 * Google turning a request down as wrong (400: a bad request, a setting or
 * model it doesn't take). Such a request is never sent again as it is; five
 * within ten minutes mean a fault on our side makes every request wrong.
 */
export async function rejectedByGoogle(where: string, status: number, message: string) {
  console.error(`Google rejected a request (${where}, ${status}): ${message}`)
  await strike("rejected", 5, 10 * 60_000, `Google keeps rejecting our requests as wrong (${where}, ${status}): ${message}`)
}

/**
 * Images Google's safety filters held back (`count` at once from a batch
 * job). Five within half an hour online, or a tenth of a job, mean the
 * prompts need a look before more go out.
 */
export async function heldBackByGoogle(where: string, count = 1, of = 0) {
  console.warn(`Google's safety filters held back ${count} image${count === 1 ? "" : "s"} (${where})`)
  const limit = of ? Math.max(5, Math.ceil(of / 10)) : 5
  await strike("held back", limit, 30 * 60_000, `Google's safety filters keep holding images back (${where}): look at the prompts before going on`, count)
}

/** Whether an HTTP status means Google turned the request itself down: sending it again changes nothing. */
export const wrong = (status: number) => status >= 400 && status < 500 && ![401, 403, 404, 408, 409, 429].includes(status)

/** Whether an HTTP status means Google refuses us outright, not that it's busy or the request was wrong. */
export const refused = (status: number) => status === 401 || status === 403
