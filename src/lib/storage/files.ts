import { createHash } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import { onChange, ready, sql } from "@/lib/db/sql"

import { copyPublic, deleteObject, getObject, putObject } from "./index"

// The app's images and videos. The bytes live in the bucket, private, under
// data/<key> ("generations/<id>/<file>.png", "mockups/<scene>/background.jpg");
// a row per file in Postgres holds its size and SHA-256, so listing a folder
// or checking a file never asks the bucket; and every version read or written
// on this machine is kept on its disk (.cache/files/<sha256>), so each one is
// downloaded once, not on every view.

export type StoredFile = { key: string; size: number; hash: string; type: string; updatedAt: string }

const CACHE = path.join(process.cwd(), ".cache", "files")

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  json: "application/json",
}

export const typeOf = (key: string) => TYPES[key.split(".").pop()!.toLowerCase()] ?? "application/octet-stream"

/** A file that isn't there, with fs's code, which callers already tell apart. */
export class MissingFile extends Error {
  readonly code = "ENOENT"
  constructor(key: string) {
    super(`No file ${key}`)
  }
}

type Row = { key: string; size: string; hash: string; type: string; updated_at: Date }

type State = { infos: Map<string, StoredFile>; downloads: Map<string, Promise<Buffer>> }

const global = globalThis as typeof globalThis & { __files?: State }

const state = (global.__files ??= start())

function start(): State {
  const fresh: State = { infos: new Map(), downloads: new Map() }
  onChange(
    (payload) => {
      if (payload[0] !== "f") return
      const [, hash, ...rest] = payload.split(" ")
      const key = rest.join(" ")
      if (fresh.infos.get(key)?.hash !== hash) fresh.infos.delete(key)
    },
    () => fresh.infos.clear()
  )
  const timer = setInterval(async () => {
    if (!fresh.infos.size) return
    try {
      const held = [...fresh.infos.keys()]
      const rows = await sql<{ key: string; hash: string }[]>`select key, hash from files where key = any(${held})`
      const now = new Map(rows.map((r) => [r.key, r.hash]))
      for (const key of held) if (now.get(key) !== fresh.infos.get(key)?.hash) fresh.infos.delete(key)
    } catch {
      // Unreachable for now: the next round tries again.
    }
  }, 30_000)
  timer.unref?.()
  return fresh
}

const info = (row: Row): StoredFile => ({
  key: row.key,
  size: Number(row.size),
  hash: row.hash,
  type: row.type,
  updatedAt: row.updated_at.toISOString(),
})

const objectKey = (key: string) => `data/${key}`
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex")
const cached = (hash: string) => path.join(CACHE, hash.slice(0, 2), hash)

export async function fileInfo(key: string): Promise<StoredFile | null> {
  const held = state.infos.get(key)
  if (held) return held
  await ready()
  const [row] = await sql<Row[]>`select key, size, hash, type, updated_at from files where key = ${key}`
  if (!row) return null
  const found = info(row)
  state.infos.set(key, found)
  return found
}

/** Every file whose key starts with `prefix`, by key. */
export async function listFiles(prefix: string): Promise<StoredFile[]> {
  await ready()
  const rows = await sql<Row[]>`
    select key, size, hash, type, updated_at from files
    where key like ${`${prefix.replace(/[\\%_]/g, "\\$&")}%`} order by key`
  return rows.map(info)
}

export async function hasFile(key: string) {
  return !!(await fileInfo(key))
}

/** The file's bytes, from this machine's copy when it has this version. */
export async function getFile(key: string): Promise<Buffer> {
  const found = await fileInfo(key)
  if (!found) throw new MissingFile(key)
  return bytes(found)
}

/** Where this machine keeps the file's current version, for tools that want a path (ffmpeg). */
export async function cachedPath(key: string) {
  const found = await fileInfo(key)
  if (!found) throw new MissingFile(key)
  await bytes(found)
  return cached(found.hash)
}

async function bytes(found: StoredFile): Promise<Buffer> {
  try {
    return await readFile(cached(found.hash))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  let download = state.downloads.get(found.hash)
  if (!download) {
    download = (async () => {
      const data = await getObject(objectKey(found.key))
      if (!data) throw new MissingFile(found.key)
      // Replaced meanwhile: kept under the hash it has, the next read finds the new row.
      await keep(sha256(data), data)
      return data
    })().finally(() => state.downloads.delete(found.hash))
    state.downloads.set(found.hash, download)
  }
  return download
}

/** Writes the copy on this machine, whole or not at all. */
async function keep(hash: string, data: Uint8Array) {
  const file = cached(hash)
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}-${Date.now()}.tmp`
  await writeFile(temporary, data)
  await rename(temporary, file)
}

/** Stores `data` under `key`, replacing what was there. */
export async function putFile(key: string, data: Uint8Array, type = typeOf(key)) {
  await ready()
  const hash = sha256(data)
  await keep(hash, data)
  const before = await fileInfo(key)
  // The same bytes again (a stage run twice) don't go up again.
  if (before?.hash !== hash) await putObject(objectKey(key), data, type)
  const [row] = await sql<Row[]>`
    insert into files (key, size, hash, type) values (${key}, ${data.byteLength}, ${hash}, ${type})
    on conflict (key) do update set size = excluded.size, hash = excluded.hash, type = excluded.type, updated_at = now()
    returning key, size, hash, type, updated_at`
  const stored = info(row)
  state.infos.set(key, stored)
  return stored
}

/** A public copy of a stored file under `publicKey`, made inside the bucket; its URL. */
export async function publishFile(key: string, publicKey: string) {
  const stored = await fileInfo(key)
  if (!stored) throw new Error(`No stored file ${key}`)
  return copyPublic(objectKey(key), publicKey, stored.type)
}

/** Copies a stored file to another key. */
export async function copyFile(from: string, to: string) {
  return putFile(to, await getFile(from))
}

export async function deleteFile(key: string) {
  await ready()
  await sql`delete from files where key = ${key}`
  state.infos.delete(key)
  await deleteObject(objectKey(key))
}

/** Deletes every file under `prefix` ("generations/<id>/"). */
export async function deleteFiles(prefix: string) {
  const found = await listFiles(prefix)
  if (!found.length) return
  await sql`delete from files where key = any(${found.map((f) => f.key)})`
  for (const f of found) state.infos.delete(f.key)
  for (let i = 0; i < found.length; i += 8) {
    await Promise.all(found.slice(i, i + 8).map((f) => deleteObject(objectKey(f.key)).catch(() => {})))
  }
}
