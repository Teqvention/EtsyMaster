import { onChange, ready, sql } from "./sql"

// The app's data: JSON documents in Postgres, keyed like the files they were
// under data/ ("accounts", "pricing/fx", "generations/<id>/set"). Every dev
// server reads and writes the same rows. Reads come from memory, kept current
// by the database telling every server about each change (and checked again
// every half minute, should a notification get lost); a change is one
// transaction holding the row, so two servers never write over each other.

type Entry = { version: number; value: unknown }

type Cache = {
  docs: Map<string, Entry>
  /** Keys under a prefix, for `docKeys`. */
  keys: Map<string, string[]>
  /** One listener per watched key, see `watchDoc`. */
  watchers: Map<string, () => void>
  timer?: ReturnType<typeof setInterval>
}

const global = globalThis as typeof globalThis & { __documents?: Cache }

const cache = (global.__documents ??= start())

function start(): Cache {
  const fresh: Cache = { docs: new Map(), keys: new Map(), watchers: new Map() }
  onChange(
    (payload) => {
      if (payload[0] !== "d") return
      const [, version, ...rest] = payload.split(" ")
      const key = rest.join(" ")
      const held = fresh.docs.get(key)
      // Our own write arrives too, once it's in memory already.
      if (!held || held.version < Number(version) || version === "0") fresh.docs.delete(key)
      // Version 1 is a new document, 0 a deleted one: only those change which keys there are.
      if (version === "0" || version === "1") {
        for (const prefix of fresh.keys.keys()) if (key.startsWith(prefix)) fresh.keys.delete(prefix)
      }
      fresh.watchers.get(key)?.()
    },
    () => {
      fresh.docs.clear()
      fresh.keys.clear()
    }
  )
  fresh.timer = setInterval(() => void recheck(fresh), 30_000)
  fresh.timer.unref?.()
  return fresh
}

/** Drops what changed without word reaching this server. */
async function recheck({ docs, keys }: Cache) {
  if (!docs.size) return
  try {
    const held = [...docs.keys()]
    const rows = await sql<{ key: string; version: string }[]>`
      select key, version from documents where key = any(${held})`
    const now = new Map(rows.map((r) => [r.key, Number(r.version)]))
    for (const key of held) if (now.get(key) !== docs.get(key)?.version) docs.delete(key)
    keys.clear()
  } catch {
    // Unreachable for now: the next round tries again.
  }
}

/** Calls `listener` whenever the document at `key` changes, on any server (this one included); one listener per key. */
export function watchDoc(key: string, listener: () => void) {
  cache.watchers.set(key, listener)
  void ready().catch(() => {})
}

/** The document at `key`, or `fallback` when there's none. Shared: never change what this answers. */
export async function readDoc<T>(key: string, fallback: T): Promise<T> {
  const held = cache.docs.get(key)
  if (held) return held.value as T
  await ready()
  const [row] = await sql<{ version: string; value: unknown }[]>`
    select version, value from documents where key = ${key}`
  if (!row) return fallback
  cache.docs.set(key, { version: Number(row.version), value: row.value })
  return row.value as T
}

/** Every document whose key starts with `prefix` and ends with `suffix`, by key. */
export async function readDocs<T>(prefix: string, suffix = ""): Promise<Map<string, T>> {
  const keys = (await docKeys(prefix)).filter((k) => k.endsWith(suffix))
  const missing = keys.filter((k) => !cache.docs.has(k))
  if (missing.length) {
    const rows = await sql<{ key: string; version: string; value: unknown }[]>`
      select key, version, value from documents where key = any(${missing})`
    for (const row of rows) cache.docs.set(row.key, { version: Number(row.version), value: row.value })
  }
  const found = new Map<string, T>()
  for (const key of keys) {
    const held = cache.docs.get(key)
    if (held) found.set(key, held.value as T)
  }
  return found
}

/** Keys of the documents under `prefix`, sorted. */
export async function docKeys(prefix: string): Promise<string[]> {
  const held = cache.keys.get(prefix)
  if (held) return held
  await ready()
  const rows = await sql<{ key: string }[]>`
    select key from documents where key like ${like(prefix)} order by key`
  const keys = rows.map((r) => r.key)
  cache.keys.set(prefix, keys)
  return keys
}

export const newId = (prefix = "") =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

const like = (prefix: string) => `${prefix.replace(/[\\%_]/g, "\\$&")}%`

/**
 * Keeps what was written as every server will read it back (the JSON, parsed
 * again), so the caller changing its object afterwards can't touch it; and a
 * key written here shows in this server's lists at once, not only when the
 * notification comes back.
 */
function written(key: string, version: number, text: string) {
  const value = JSON.parse(text)
  cache.docs.set(key, { version, value })
  for (const [prefix, keys] of cache.keys) if (key.startsWith(prefix) && !keys.includes(key)) cache.keys.delete(prefix)
  return value
}

// As text, so a document that is just null (a list not made yet) stays JSON null, not SQL NULL;
// cast `::text::json` in the query, as a bare `::json` makes postgres.js encode the text again.
const json = (value: unknown) => JSON.stringify(value) ?? "null"

/** Replaces the document at `key`. */
export async function writeDoc(key: string, value: unknown) {
  await ready()
  const text = json(value)
  const [{ version }] = await sql<{ version: string }[]>`
    insert into documents (key, value) values (${key}, ${text}::text::json)
    on conflict (key) do update set value = excluded.value, version = documents.version + 1, updated_at = now()
    returning version`
  written(key, Number(version), text)
}

/**
 * Applies `change` to the document at `key` (`fallback` when there's none)
 * and writes what it answers, in one transaction holding the row: changes
 * from every server go one after another. `change` gets its own copy, so it
 * may change it in place.
 */
export async function updateDoc<T>(key: string, fallback: T, change: (current: T) => T | Promise<T>): Promise<T> {
  return (await apply(key, { fallback }, change))!
}

/** Like `updateDoc`, for a document that must be there: answers null (and changes nothing) when it isn't. */
export function changeDoc<T>(key: string, change: (current: T) => T | Promise<T>): Promise<T | null> {
  return apply(key, null, change)
}

/**
 * Like `updateDoc`, for a document and the ones under `prefix` that change
 * along with it (the pipeline's jobs and, one document each, their items):
 * `change` gets copies of the document and of every one under `prefix` (by
 * key), may change them in place and add new ones, and only those it changed
 * are written. One transaction holding the row at `key`, so the group's
 * changes from every server go one after another.
 */
export async function updateDocs<T, P>(
  key: string,
  fallback: T,
  prefix: string,
  change: (current: T, parts: Map<string, P>) => T | Promise<T>
): Promise<void> {
  await ready()
  const done = await sql.begin(async (tx) => {
    // Sent together: the row is held before its group's versions are read.
    const [, [row], rows] = await Promise.all([
      tx`insert into documents (key, value) values (${key}, ${json(fallback)}::text::json) on conflict (key) do nothing`,
      tx<{ version: string }[]>`select version from documents where key = ${key} for update`,
      tx<{ key: string; version: string }[]>`select key, version from documents where key like ${like(prefix)}`,
    ])
    const versions = new Map([[key, Number(row.version)], ...rows.map((r) => [r.key, Number(r.version)] as const)])
    const stale = [...versions].filter(([k, version]) => cache.docs.get(k)?.version !== version).map(([k]) => k)
    const fetched = stale.length
      ? await tx<{ key: string; value: unknown }[]>`select key, value from documents where key = any(${stale})`
      : []
    const values = new Map(fetched.map((r) => [r.key, r.value]))
    // As read, to tell what `change` changed; parsed again, its own copies.
    const before = new Map([...versions.keys()].map((k) => [k, json(values.has(k) ? values.get(k) : cache.docs.get(k)!.value)]))
    const parts = new Map<string, P>()
    for (const [k, text] of before) if (k !== key) parts.set(k, JSON.parse(text))
    const changes = new Map([[key, json(await change(JSON.parse(before.get(key)!), parts))]])
    for (const [k, part] of parts) changes.set(k, json(part))
    const writes = [...changes].filter(([k, text]) => text !== before.get(k))
    const saved = await Promise.all(
      writes.map(
        ([k, text]) => tx<{ version: string }[]>`
          insert into documents (key, value) values (${k}, ${text}::text::json)
          on conflict (key) do update set value = excluded.value, version = documents.version + 1, updated_at = now()
          returning version`
      )
    )
    return writes.map(([k, text], i) => ({ key: k, text, version: Number(saved[i][0].version) }))
  })
  for (const { key: k, text, version } of done) written(k, version, text)
}

async function apply<T>(key: string, missing: { fallback: T } | null, change: (current: T) => T | Promise<T>) {
  await ready()
  const done = await sql.begin(async (tx) => {
    if (missing) {
      await tx`insert into documents (key, value) values (${key}, ${json(missing.fallback)}::text::json) on conflict (key) do nothing`
    }
    const [row] = await tx<{ version: string }[]>`select version from documents where key = ${key} for update`
    if (!row) return null
    const held = cache.docs.get(key)
    const current =
      held && held.version === Number(row.version)
        ? (structuredClone(held.value) as T)
        : (await tx<{ value: T }[]>`select value from documents where key = ${key}`)[0].value
    const text = json(await change(current))
    const [{ version }] = await tx<{ version: string }[]>`
      update documents set value = ${text}::text::json, version = version + 1, updated_at = now()
      where key = ${key} returning version`
    return { text, version: Number(version) }
  })
  if (!done) return null
  return written(key, done.version, done.text) as T
}

export async function deleteDoc(key: string) {
  await ready()
  await sql`delete from documents where key = ${key}`
  cache.docs.delete(key)
  for (const prefix of cache.keys.keys()) if (key.startsWith(prefix)) cache.keys.delete(prefix)
}

/** Deletes every document under `prefix` ("generations/<id>/"). */
export async function deleteDocs(prefix: string) {
  await ready()
  const rows = await sql<{ key: string }[]>`delete from documents where key like ${like(prefix)} returning key`
  for (const { key } of rows) cache.docs.delete(key)
  for (const held of cache.keys.keys()) if (held.startsWith(prefix) || prefix.startsWith(held)) cache.keys.delete(held)
}
