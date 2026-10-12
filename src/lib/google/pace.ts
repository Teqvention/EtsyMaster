import { ready, sql } from "@/lib/db/sql"

// Every server's calls to Google, paced together. Each kind of call draws
// from a token bucket kept in the shared database, so however many dev
// servers run, Google sees no more than the rates below; and when it says
// it's busy (429), every server waits a little before the next try, longer
// while it keeps saying so. Google suspended a project on 10 Oct after
// bursts of requests (64 images at once, 30+ requests a second of 429s). And
// online Nano Banana lets about one image a minute through for this project
// whatever we ask (Cloud Monitoring, 12 Oct: 3–7 busy answers per image), so
// trying faster only adds 429s.
//
// Should the database be out of reach, each server paces on its own.

export type PaceKind = "image" | "imageFallback" | "text" | "job"

type Limit = {
  perMinute: number
  /** Calls that may go at once after a quiet spell. */
  burst: number
  /** The wait after a busy answer, doubling with each in a row, and its longest. */
  cool: readonly [number, number]
}

const LIMITS: Record<PaceKind, Limit> = {
  /** Nano Banana online: every try, painted or turned away. */
  image: { perMinute: 4, burst: 2, cool: [15_000, 60_000] },
  /** The model that takes over while Nano Banana 2.1 is overloaded; its own quota (painting 14 s an image, 12 Oct). */
  imageFallback: { perMinute: 10, burst: 2, cool: [10_000, 60_000] },
  /** Gemini Flash: finding and reading posters, writing briefs. */
  text: { perMinute: 60, burst: 10, cool: [2_000, 20_000] },
  /** Batch jobs started: at least half a minute apart. */
  job: { perMinute: 2, burst: 1, cool: [30_000, 120_000] },
}

const KINDS = Object.keys(LIMITS) as PaceKind[]

type Local = { tokens: number; at: number; coolUntil: number; strikes: number }
type State = { table?: Promise<void>; local: Map<PaceKind, Local>; waits: Map<PaceKind, number> }
// On globalThis, so every route (and a dev reload) shares it.
const global = globalThis as typeof globalThis & { __googlePace?: State }
const state: State = (global.__googlePace ??= { local: new Map(), waits: new Map() })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The table, made once per server (a server started before it existed doesn't run the schema again). */
function table() {
  state.table ??= (async () => {
    await ready()
    await sql`
      create table if not exists google_pace (
        name text primary key,
        tokens double precision not null,
        at timestamptz not null default now(),
        cool_until timestamptz not null default now(),
        strikes integer not null default 0
      )`
    for (const kind of KINDS) {
      await sql`insert into google_pace (name, tokens) values (${kind}, ${LIMITS[kind].burst}) on conflict (name) do nothing`
    }
  })().catch((error) => {
    state.table = undefined
    throw error
  })
  return state.table
}

/**
 * Waits until a call of `kind` may go: a token in its bucket and no
 * cool-down running, across every server.
 */
export async function pace(kind: PaceKind) {
  const { perMinute, burst } = LIMITS[kind]
  const perSecond = perMinute / 60
  const asked = Date.now()
  for (;;) {
    let wait: number
    try {
      await table()
      // One statement: the row is held while the bucket refills and gives
      // (the update runs whether or not the select reads it).
      const [row] = await sql<{ granted: boolean; wait: number }[]>`
        with held as (
          select tokens, at, cool_until from google_pace where name = ${kind} for update
        ), fresh as (
          select least(${burst}::float8, tokens + greatest(0, extract(epoch from clock_timestamp() - at)) * ${perSecond}::float8) as tokens,
                 cool_until <= clock_timestamp() as calm,
                 extract(epoch from cool_until - clock_timestamp()) as cooling
          from held
        ), taken as (
          update google_pace set
            tokens = case when fresh.tokens >= 1 and fresh.calm then fresh.tokens - 1 else fresh.tokens end,
            at = clock_timestamp()
          from fresh where name = ${kind}
        )
        select (tokens >= 1 and calm) as granted,
               greatest(0, cooling, (1 - tokens) / ${perSecond}::float8) * 1000 as wait
        from fresh`
      if (!row) {
        // A kind added since this server made the table.
        await sql`insert into google_pace (name, tokens) values (${kind}, ${burst}) on conflict (name) do nothing`
        continue
      }
      if (row.granted) break
      wait = Number(row.wait)
    } catch (error) {
      console.warn(`Pacing ${kind} on this server only:`, (error as Error).message)
      wait = takeLocal(kind)
      if (wait === 0) break
    }
    // A little jitter, so servers that waited together don't all go at once.
    await sleep(Math.min(wait, 60_000) + 50 + Math.random() * 1_000)
  }
  state.waits.set(kind, Date.now() - asked)
}

/** The same bucket, on this server alone; answers how long to wait, 0 when taken. */
function takeLocal(kind: PaceKind) {
  const { perMinute, burst } = LIMITS[kind]
  const now = Date.now()
  const local = state.local.get(kind) ?? { tokens: burst, at: now, coolUntil: 0, strikes: 0 }
  local.tokens = Math.min(burst, local.tokens + ((now - local.at) / 60_000) * perMinute)
  local.at = now
  state.local.set(kind, local)
  if (now < local.coolUntil) return local.coolUntil - now
  if (local.tokens < 1) return ((1 - local.tokens) / perMinute) * 60_000
  local.tokens--
  return 0
}

/** Google said it's busy: every server waits a while before its next call of `kind`, longer each time in a row. */
export async function busy(kind: PaceKind) {
  const [base, longest] = LIMITS[kind].cool
  const local = state.local.get(kind)
  if (local) {
    local.coolUntil = Math.max(local.coolUntil, Date.now() + Math.min(longest, base * 2 ** local.strikes))
    local.strikes++
  }
  try {
    await table()
    await sql`
      update google_pace set
        strikes = strikes + 1,
        cool_until = greatest(cool_until, clock_timestamp()
          + make_interval(secs => least(${longest}::float8, ${base}::float8 * power(2, least(strikes, 10))) * (0.75 + random() * 0.5) / 1000))
      where name = ${kind}`
  } catch (error) {
    console.warn(`Pacing ${kind}:`, (error as Error).message)
  }
}

/** A call of `kind` got through: the cool-downs start short again. */
export async function calm(kind: PaceKind) {
  const local = state.local.get(kind)
  if (local) local.strikes = 0
  try {
    await table()
    await sql`update google_pace set strikes = 0 where name = ${kind} and strikes > 0`
  } catch {
    // The next busy answer starts from where it was: no harm.
  }
}

/** How the buckets stand, for a look from outside. */
export async function paceState() {
  await table()
  const rows = await sql<{ name: string; tokens: number; cooling: number; strikes: number }[]>`
    select name, tokens, greatest(0, extract(epoch from cool_until - clock_timestamp())) as cooling, strikes from google_pace order by name`
  return Object.fromEntries(
    rows.map((r) => [
      r.name,
      {
        ...LIMITS[r.name as PaceKind],
        tokens: Math.round(Number(r.tokens) * 10) / 10,
        coolingSeconds: Math.round(Number(r.cooling)),
        busyInARow: r.strikes,
        lastWaitSeconds: Math.round((state.waits.get(r.name as PaceKind) ?? 0) / 1000),
      },
    ])
  )
}
