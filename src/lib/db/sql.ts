import { hostname } from "node:os"

import postgres from "postgres"

import { SCHEMA } from "./schema"

// The Postgres every dev server shares (Dokploy, reached over Tailscale, see
// DATABASE_URL in .env). One client per server, on globalThis: route
// handlers and server components load separate copies of this module.

type Db = {
  sql: postgres.Sql
  /** Connections held by locks, apart from `sql`'s: see `exclusive`. */
  locks?: postgres.Sql
  ready?: Promise<void>
  /** Called with every "changes" notification: "d <version> <key>" or "f <hash> <key>". */
  listeners: Set<(payload: string) => void>
  /** Called whenever the notifications (re)start: what came meanwhile is lost, so caches start over. */
  resets: Set<() => void>
}

const global = globalThis as typeof globalThis & { __db?: Db }

const connect = (max: number) =>
  postgres(process.env.DATABASE_URL ?? "", {
    max,
    idle_timeout: 30,
    connect_timeout: 15,
    // "relation already exists, skipping" and the like.
    onnotice: () => {},
    connection: { application_name: `etsy@${hostname()}` },
  })

const db = (global.__db ??= { sql: connect(12), listeners: new Set(), resets: new Set() })
// A lock keeps its connection while its work runs, and the work queries
// through `sql`: sharing one pool, ten generations running at once held
// every connection and waited forever for one more.
db.locks ??= connect(30)

export const sql = db.sql
/** Where locks hold their connection: never `sql`, which their work needs. */
export const locks = db.locks

/** Connected, the tables there and change notifications coming; once per server. */
export function ready() {
  db.ready ??= setUp().catch((error) => {
    db.ready = undefined
    throw error
  })
  return db.ready
}

async function setUp() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL isn't set: add the shared database's address to .env")
  await sql.begin(async (tx) => {
    // Two servers starting at once would trip over each other's CREATE OR REPLACE.
    await tx`select pg_advisory_xact_lock(hashtextextended('schema', 0))`
    await tx.unsafe(SCHEMA)
  })
  await sql.listen(
    "changes",
    (payload) => db.listeners.forEach((listener) => listener(payload)),
    () => db.resets.forEach((reset) => reset())
  )
}

/** Hears every change any server makes; `reset` runs when changes may have been missed. */
export function onChange(listener: (payload: string) => void, reset: () => void) {
  db.listeners.add(listener)
  db.resets.add(reset)
}

/**
 * Runs `work` holding the lock `name` across every server, or answers null
 * at once when another holds it. A server that dies lets go with its
 * connection.
 */
export async function exclusive<T>(name: string, work: () => Promise<T>): Promise<T | null> {
  await ready()
  const connection = await locks.reserve()
  const beat = holdAlive(connection)
  try {
    const [{ ok }] = await connection`select pg_try_advisory_lock(hashtextextended(${name}, 0)) as ok`
    if (!ok) return null
    try {
      return await work()
    } finally {
      await connection`select pg_advisory_unlock(hashtextextended(${name}, 0))`.catch(() => {})
    }
  } finally {
    clearInterval(beat)
    await connection`select set_config('idle_session_timeout', '0', false)`.catch(() => {})
    connection.release()
  }
}

/** How long a connection holding a lock may say nothing before the database drops it, and its lock. */
export const LOCK_SILENCE = "45s"

/**
 * Has the database end `connection` once its server goes quiet, and keeps
 * it talking while the server lives. The database sees every server through
 * Dokploy's proxy, so a laptop that sleeps or a server that's killed leaves
 * its connections open there — locks and all, for hours — unless they time out.
 */
export function holdAlive(connection: postgres.ReservedSql) {
  void connection`select set_config('idle_session_timeout', ${LOCK_SILENCE}, false)`.catch(() => {})
  const beat = setInterval(() => void connection`select 1`.catch(() => {}), 10_000)
  beat.unref?.()
  return beat
}
