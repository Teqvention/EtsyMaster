import { readDoc, writeDoc } from "@/lib/db/documents"

// One switch that stops every call to Google (Vertex, Gemini, Cloud Storage)
// on every server: kept in the shared database, checked before each call is
// signed in (see auth() in mockups/gemini.ts). While it's on, the batch poller,
// the online lane, the outbox and the generation queue wait instead of failing;
// switching it off sets them going again (see generation/run.ts).
//
// It also switches itself on when Google keeps turning us away (see
// `deniedByGoogle`), saying why. A pause over requests Google turned down or
// images its filters held back ends by itself after a while (`COOL_OFF`),
// for a longer while each time; one more within `REMEMBER` and it stays
// on until someone has looked. Being refused outright always waits for
// someone: no wait mends a key, a permission or billing.

export const PAUSE_KEY = "google/pause"

type Kind = "denied" | "rejected" | "held back"

export type GooglePause = {
  paused: boolean
  at: string | null
  /** Why it paused by itself; not set when paused by hand. */
  reason?: string
  /** When a pause it took by itself ends by itself; not set when it waits for someone. */
  until?: string
  /** The pauses it took by itself lately, newest last (see `REMEMBER`). */
  history?: { at: string; kind: Kind }[]
}

const OFF: GooglePause = { paused: false, at: null }

/** How long a pause it takes by itself lasts, the first time and the next; after that it waits for someone. */
const COOL_OFF: Record<Kind, number[]> = {
  denied: [],
  rejected: [15 * 60_000, 60 * 60_000],
  "held back": [30 * 60_000, 2 * 60 * 60_000],
}
/** How long a pause it took by itself counts towards the next one lasting longer. */
const REMEMBER = 6 * 60 * 60_000

export async function googlePause() {
  const pause = await readDoc<GooglePause>(PAUSE_KEY, OFF)
  // Its time is up: on again, everywhere (every server watches the switch).
  if (pause.paused && pause.until && Date.parse(pause.until) <= Date.now()) {
    const value: GooglePause = { paused: false, at: new Date().toISOString(), history: pause.history }
    await writeDoc(PAUSE_KEY, value)
    console.log(`Google resumed by itself after its pause (${pause.reason ?? "?"})`)
    return value
  }
  return pause
}

export async function googlePaused() {
  return (await googlePause()).paused
}

/** Switched by hand: a resume by hand forgets the pauses it took by itself, someone has looked. */
export async function setGooglePaused(paused: boolean, reason?: string): Promise<GooglePause> {
  const value: GooglePause = { paused, at: new Date().toISOString(), ...(paused && reason && { reason }) }
  await writeDoc(PAUSE_KEY, value)
  return value
}

/** Paused by itself over `kind`: for a while, or until someone has looked when that's happened often lately. */
async function pauseItself(kind: Kind, reason: string) {
  const now = Date.now()
  const before = await readDoc<GooglePause>(PAUSE_KEY, OFF)
  const history = (before.history ?? []).filter((h) => now - Date.parse(h.at) < REMEMBER)
  const wait = COOL_OFF[kind][history.filter((h) => h.kind === kind).length]
  const value: GooglePause = {
    paused: true,
    at: new Date(now).toISOString(),
    reason,
    ...(wait && { until: new Date(now + wait).toISOString() }),
    history: [...history, { at: new Date(now).toISOString(), kind }],
  }
  await writeDoc(PAUSE_KEY, value)
  return wait
}

export class GooglePausedError extends Error {
  constructor() {
    super("Google is paused: nothing goes to Google until it's switched back on")
  }
}

// Everything is paused, on every server, for a while or until someone has
// looked (see `COOL_OFF`), when Google keeps telling us something sending
// more can't fix. A single answer like that can be a fluke and pauses nothing.
// Asked to keep going regardless, a project gets suspended: Google's own
// systems flag accounts that go on sending what it refuses.

type Strikes = Record<string, number[]>
const global = globalThis as typeof globalThis & { __googleStrikes?: Strikes }
const strikes: Strikes = (global.__googleStrikes ??= {})

async function strike(kind: Kind, limit: number, window: number, reason: string, count = 1) {
  const now = Date.now()
  const recent = (strikes[kind] ?? []).filter((at) => now - at < window)
  for (let i = 0; i < count; i++) recent.push(now)
  strikes[kind] = recent
  if (recent.length < limit) return
  strikes[kind] = []
  try {
    if (await googlePaused()) return
    const wait = await pauseItself(kind, reason.slice(0, 400))
    console.error(`Google paused by itself${wait ? ` for ${Math.round(wait / 60_000)} min` : " until someone has looked"}: ${reason}`)
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
