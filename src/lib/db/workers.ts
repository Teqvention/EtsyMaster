import { randomBytes } from "node:crypto"
import { hostname } from "node:os"

import type postgres from "postgres"

import { LOCK_SILENCE, locks, ready, reserve, sql } from "./sql"

// Several dev servers share one database, but some work must happen once:
// the upload worker, Artikel's bulk actions, the daily sync, the copywriter.
// The server holding the "leader" lock does it; when that server stops (or
// its laptop sleeps long enough for the database to drop it) another takes
// over within seconds. Every server also says every few seconds that it's
// up, so work another one started tells an interrupted run from a running one.

const HEARTBEAT = 10_000
/** A server not seen for this long has stopped. */
const GONE = 45_000
const ELECT = 5_000

type State = {
  id: string
  started: boolean
  /** The connection holding the leader lock, while this server leads. */
  lead: postgres.ReservedSql | null
  leadCheckedAt: number
  onLead: Set<() => void>
  live: { at: number; ids: Set<string> } | null
}

const global = globalThis as typeof globalThis & { __workers?: State }

const state = (global.__workers ??= {
  id: `${hostname().split(".")[0]}-${randomBytes(4).toString("hex")}`,
  started: false,
  lead: null,
  leadCheckedAt: 0,
  onLead: new Set(),
  live: null,
})

/** This server, as other servers see it on the work it runs. */
export const instanceId = state.id

/** Starts saying this server is up and standing for leader; once per server. */
export function startInstance() {
  if (state.started || process.env.NEXT_PHASE === "phase-production-build") return
  state.started = true
  const beat = () =>
    ready()
      .then(
        () => sql`
          insert into instances (id, host) values (${state.id}, ${hostname()})
          on conflict (id) do update set seen_at = now()`
      )
      .then(() => sql`delete from instances where seen_at < now() - interval '1 day'`)
      .catch((error) => console.warn("Database heartbeat:", (error as Error).message))
  void beat()
  setInterval(beat, HEARTBEAT).unref?.()
  void elect()
  setInterval(elect, ELECT).unref?.()
}

async function elect() {
  if (state.lead) {
    await isLeader()
    return
  }
  let connection: postgres.ReservedSql | null = null
  try {
    await ready()
    connection = await reserve()
    // So the database lets go of the lock soon after this laptop sleeps or
    // drops off (TCP keepalives don't reach through Dokploy's proxy):
    // `isLeader` asks over the connection every few seconds while it lives.
    await connection`select set_config('idle_session_timeout', ${LOCK_SILENCE}, false)`
    const [{ ok }] = await connection`select pg_try_advisory_lock(hashtextextended('leader', 0)) as ok`
    if (!ok) {
      await connection`select set_config('idle_session_timeout', '0', false)`
      connection.release()
      return
    }
    state.lead = connection
    state.leadCheckedAt = Date.now()
    console.log(`Background work runs here (${state.id})`)
    for (const start of state.onLead) start()
  } catch (error) {
    connection?.release()
    console.warn("Leader election:", (error as Error).message)
  }
}

/**
 * Whether this server leads now: checked with the database at most every
 * few seconds, so a laptop waking from sleep finds out it lost the lock
 * before doing anything.
 */
export async function isLeader() {
  if (!state.lead) return false
  if (Date.now() - state.leadCheckedAt < 3_000) return true
  try {
    await state.lead`select 1`
    state.leadCheckedAt = Date.now()
    return true
  } catch {
    const lost = state.lead
    state.lead = null
    lost.release()
    console.log("Background work moved to another server")
    return false
  }
}

/**
 * Gives up the lead and closes the database connections, so a stopping
 * server lets another take over at once. Open connections would otherwise
 * keep the process alive, half stopped and still leading.
 */
export async function closeDatabase() {
  const lead = state.lead
  state.lead = null
  if (lead) await lead`select pg_advisory_unlock_all()`.catch(() => {})
  await Promise.allSettled([sql.end({ timeout: 5 }), locks.end({ timeout: 5 })])
}

/** Runs `start` now if this server leads, and each time it becomes the leader. */
export function whenLeader(start: () => void) {
  state.onLead.add(start)
  if (state.lead) start()
}

/** Whether the server `id` is still up (this one always is). */
export async function isLive(id: string | undefined) {
  if (!id) return false
  if (id === state.id) return true
  if (!state.live || Date.now() - state.live.at > 5_000) {
    await ready()
    const rows = await sql<{ id: string }[]>`
      select id from instances where seen_at > now() - ${`${GONE / 1000} seconds`}::interval`
    state.live = { at: Date.now(), ids: new Set(rows.map((r) => r.id)) }
  }
  return state.live.ids.has(id)
}
