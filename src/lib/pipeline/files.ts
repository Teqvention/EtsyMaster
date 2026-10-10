import path from "node:path"

import { NotFoundError } from "@/lib/mockups/storage"
import { cachedPath, getFile, hasFile, publishFile, putFile } from "@/lib/storage/files"

// What the pipeline makes: files under pipeline/ (see storage/files.ts), one
// folder per item (items/<itemId>/print, items/<itemId>/media). Paths stored
// on items are relative to pipeline/, so the folder can move with them.

export const itemDir = (itemId: string) => `items/${itemId}`

/** The storage key of `file` (relative to pipeline/); never outside it. */
export function storageKey(file: string) {
  const clean = path.posix.normalize(file)
  if (!clean || clean.startsWith("../") || clean === ".." || clean.startsWith("/") || clean === ".") {
    throw new NotFoundError("Unknown file")
  }
  return `pipeline/${clean}`
}

/** A file in one item's folder, by its path there (media/01.jpg); never outside that folder. */
export function itemFile(itemId: string, relative: string) {
  const folder = storageKey(itemDir(itemId))
  const key = storageKey(`${itemDir(itemId)}/${relative}`)
  if (key.startsWith(`${folder}/`)) return key
  throw new NotFoundError("Unknown file")
}

export const writeFileUnder = (file: string, data: Buffer | Uint8Array) => putFile(storageKey(file), data)

export const readFileUnder = (file: string) => getFile(storageKey(file))

export const hasFileUnder = (file: string) => hasFile(storageKey(file))

/** A public copy of the file under `publicKey` (bucket to bucket, no upload); its URL. */
export const publishFileUnder = (file: string, publicKey: string) => publishFile(storageKey(file), publicKey)

/** A path on this machine holding the file, for tools that read files (ffmpeg). */
export const localPathUnder = (file: string) => cachedPath(storageKey(file))
