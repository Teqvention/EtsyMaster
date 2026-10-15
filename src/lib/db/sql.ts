import { hostname } from "node:os"

import postgres from "postgres"

import { SCHEMA } from "./schema"

// The Postgres every dev server shares (Dokploy, reached over Tailscale, see
// DATABASE_URL in .env). One client per server, on globalThis: route
// handlers and server components load separate copies of this module.

type Db = {
  sql: postgres.Sql
  /** Connections held by locks, apart from `sql`'s: see `exclusive`. */
  lockPool?: postgres.Sql
  /** The one connection that listens for changes; it's idle while it waits, so it's exempt from `IDLE_SESSION`. */
  listener?: postgres.Sql
  ready?: Promise<void>
  /** Called with every "changes" notification: "d <version> <key>" or "f <hash> <key>". */
  listeners: Set<(payload: string) => void>
  /** Called whenever the notifications (re)start: what came meanwhile is lost, so caches start over. */
  resets: Set<() => void>
  /** Asks the pools whether they still answer, and makes a broken one afresh (see `PROBE_EVERY`). */
  mend?: Mend
}

const global = globalThis as typeof globalThis & { __db?: Db }

/**
 * How long a connection may sit idle before the database ends it. The
 * database sees every server through Dokploy's proxy, so a laptop that
 * sleeps leaves its connections open there: on 12 Oct 43 of them, idle for
 * over an hour, filled it until it took no more ("too many clients"). The
 * pools close idle connections well before this themselves.
 */
export const IDLE_SESSION = 15 * 60_000

/**
 * Limits on a session's waiting, so a dropped connection can't hold the
 * others up for good. 13 Oct: after the network went, a transaction of a
 * server that was gone held a document's row lock for hours (queries
 * behind it waited forever, their generations never finished): the
 * database now ends a transaction left open two minutes, a wait for a lock
 * gives up after a minute (and says so, for the caller to try again), a
 * statement after five.
 */
const LIMITS = { idle_in_transaction_session_timeout: 2 * 60_000, lock_timeout: 60_000, statement_timeout: 5 * 60_000 }

const connect = (max: number, idle = 30, timeout = true) =>
  postgres(process.env.DATABASE_URL ?? "", {
    max,
    idle_timeout: idle,
    connect_timeout: 15,
    // "relation already exists, skipping" and the like.
    onnotice: () => {},
    connection: { application_name: `etsy@${hostname()}`, ...(timeout && { idle_session_timeout: IDLE_SESSION, ...LIMITS }) },
  })

const db = (global.__db ??= { sql: connect(12), listeners: new Set(), resets: new Set() })
// A lock keeps its connection while its work runs, and the work queries
// through `sql`: sharing one pool, ten generations running at once held
// every connection and waited forever for one more. Idle ones stay open a
// while: one closing as a lock waits for a connection can lose that wait (see `reserve`).
db.lockPool ??= connect(30, 600)
db.listener ??= connect(1, 0, false)

/**
 * The pool `pick` gives, whichever it is when called: one made afresh (see
 * `mend`) takes over for every caller at once, though each module keeps
 * what it imported. postgres.js's helpers (begin, unsafe, end…) are plain
 * closures, so they're handed out as they are.
 */
function current(pick: () => postgres.Sql): postgres.Sql {
  return new Proxy((() => {}) as unknown as postgres.Sql, {
    apply: (_, self, args) => Reflect.apply(pick() as unknown as (...a: unknown[]) => unknown, self, args),
    get: (_, key) => Reflect.get(pick(), key),
  })
}

export const sql = current(() => db.sql)
/** Where locks hold their connection: never `sql`, which their work needs. */
export const locks = current(() => db.lockPool!)

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
  await db.listener!.listen(
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
  // Taking a lock is instant; one that isn't says so, to find out why.
  let step = "a connection"
  const slow = setTimeout(() => console.warn(`Lock ${name}: still waiting for ${step} after 30 s`), 30_000)
  const connection = await reserve().catch((error) => {
    clearTimeout(slow)
    throw error
  })
  const beat = holdAlive(connection)
  try {
    step = "the lock"
    const [{ ok }] = await connection`select pg_try_advisory_lock(hashtextextended(${name}, 0)) as ok`
    clearTimeout(slow)
    if (!ok) return null
    try {
      return await work()
    } finally {
      await connection`select pg_advisory_unlock(hashtextextended(${name}, 0))`.catch(() => {})
    }
  } finally {
    clearTimeout(slow)
    clearInterval(beat)
    await connection`select set_config('idle_session_timeout', ${IDLE_SESSION}, false)`.catch(() => {})
    connection.release()
  }
}

export type Claim = {
  /** The connection holding it dropped: another server may hold the lock by now. */
  lost: boolean
  release: () => Promise<void>
}

/**
 * Takes the lock `name` across every server and holds it until `release`,
 * or until this server stops (its connection goes, and the lock with it);
 * answers null at once when another holds it. For work that lasts longer
 * than one call, like looking after a batch job until it's in.
 */
export async function claim(name: string): Promise<Claim | null> {
  await ready()
  const connection = await reserve()
  void connection`select set_config('idle_session_timeout', ${LOCK_SILENCE}, false)`.catch(() => {})
  const ok = await connection`select pg_try_advisory_lock(hashtextextended(${name}, 0)) as ok`
    .then(([row]) => row.ok as boolean)
    .catch(() => false)
  const free = async () => {
    await connection`select set_config('idle_session_timeout', ${IDLE_SESSION}, false)`.catch(() => {})
    connection.release()
  }
  if (!ok) {
    await free()
    return null
  }
  const held: Claim = { lost: false, release: async () => {} }
  // Kept talking, so the database doesn't take it for a server gone quiet (see `holdAlive`).
  const beat = setInterval(
    () =>
      void connection`select 1`.catch(() => {
        held.lost = true
        clearInterval(beat)
      }),
    10_000
  )
  beat.unref?.()
  held.release = async () => {
    clearInterval(beat)
    await connection`select pg_advisory_unlock(hashtextextended(${name}, 0))`.catch(() => {})
    await free()
  }
  return held
}

const RESERVE_WAIT = 20_000
const RESERVE_TRIES = 5

/**
 * A connection of `locks` to hold a lock on. postgres.js (3.4.9) can lose a
 * wait for one for good: when another connection closes while it waits, the
 * wait moves to that one's reconnect, which drops it. So a wait that takes
 * too long is given up and asked again; a connection that still comes goes
 * back.
 */
export async function reserve(): Promise<postgres.ReservedSql> {
  for (let tries = 1; ; tries++) {
    const asked = locks.reserve()
    let timer: NodeJS.Timeout | undefined
    const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), RESERVE_WAIT)))
    const connection = await Promise.race([asked, late]).finally(() => clearTimeout(timer))
    if (connection) return connection
    void asked.then((c) => c.release(), () => {})
    if (tries === RESERVE_TRIES) throw new Error(`No database connection to hold a lock on after ${tries} tries`)
    console.warn(`Database: no connection for a lock after ${RESERVE_WAIT / 1000} s, asking again`)
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

// --- Mending ---

/**
 * A pool can break for good. 13 Oct, after the network dropped, postgres.js
 * (3.4.9) threw "Cannot read properties of null (reading 'write')" from
 * connections whose socket had gone, and every query handed to them waited
 * forever: the generation queue stood still for half an hour, until the
 * server was restarted by hand. So both pools are asked a trivial question
 * every `PROBE_EVERY`. When one has gone `PROBE_FAILS` rounds without an
 * answer within `PROBE_WAIT` while a connection opened just to ask answers
 * at once, the database is there and the pool isn't: it's made afresh.
 * Ending the old one fails what still waits on it (CONNECTION_DESTROYED),
 * so its callers go on: their sets fail for a passing reason and heal, and
 * locks it held are let go of (another server, or this one, takes them again).
 */
const PROBE_EVERY = 20_000
const PROBE_WAIT = 15_000
const PROBE_FAILS = 3

type Mend = {
  timer?: ReturnType<typeof setInterval>
  busy: boolean
  /** Rounds in a row each pool didn't answer. */
  fails: { sql: number; locks: number }
  /** What was made afresh lately, newest last. */
  log: { at: string; pool: string }[]
  /** One round; called through here, so after a dev reload the newest code runs. */
  probe: () => Promise<void>
}

/** Whether `pool` answers a trivial question within `PROBE_WAIT`. */
async function answers(pool: postgres.Sql) {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), PROBE_WAIT)))
  const asked = pool`select 1`.then(
    () => true,
    () => false
  )
  return Promise.race([asked, late]).finally(() => clearTimeout(timer))
}

async function probe() {
  const mend = db.mend!
  if (mend.busy || !process.env.DATABASE_URL) return
  mend.busy = true
  try {
    const [main, held] = await Promise.all([answers(db.sql), answers(db.lockPool!)])
    mend.fails = { sql: main ? 0 : mend.fails.sql + 1, locks: held ? 0 : mend.fails.locks + 1 }
    const broken = { sql: mend.fails.sql >= PROBE_FAILS, locks: mend.fails.locks >= PROBE_FAILS }
    if (!broken.sql && !broken.locks) return
    // The database out of reach altogether (the network, say): a new pool wouldn't change that.
    const fresh = connect(1, 5)
    const there = await answers(fresh)
    void fresh.end({ timeout: 1 }).catch(() => {})
    if (!there) return
    const old: postgres.Sql[] = []
    if (broken.sql) {
      old.push(db.sql)
      db.sql = connect(12)
      mend.fails.sql = 0
    }
    if (broken.locks) {
      old.push(db.lockPool!)
      db.lockPool = connect(30, 600)
      mend.fails.locks = 0
    }
    const pool = broken.sql && broken.locks ? "both pools" : broken.sql ? "the query pool" : "the lock pool"
    console.warn(`Database: ${pool} stopped answering while the database answers: made afresh`)
    mend.log = [...mend.log, { at: new Date().toISOString(), pool }].slice(-20)
    for (const pool of old) void pool.end({ timeout: 5 }).catch(() => {})
  } catch (error) {
    console.error("Database check:", error)
  } finally {
    mend.busy = false
  }
}

db.mend ??= { busy: false, fails: { sql: 0, locks: 0 }, log: [], probe }
db.mend.probe = probe
if (process.env.NEXT_PHASE !== "phase-production-build") {
  db.mend.timer ??= setInterval(() => void db.mend!.probe(), PROBE_EVERY)
  db.mend.timer.unref?.()
}

/** What the pool check made afresh lately, for a look from outside. */
export const mended = () => db.mend!.log
