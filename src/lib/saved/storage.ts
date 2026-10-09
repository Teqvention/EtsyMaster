import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import { addCategory } from "@/lib/mockups/storage"

import type { SavedListing, SaveRequest } from "./types"

// Saved listings in one file next to the app, newest first. A listing sits in
// one folder at a time: saving it again moves it.
const FILE = path.join(process.cwd(), "data", "saved.json")

// Read-modify-write one at a time, shared by every route.
const global = globalThis as typeof globalThis & { __savedWrite?: Promise<unknown> }

export async function listSaved(): Promise<SavedListing[]> {
  try {
    const list = JSON.parse(await readFile(FILE, "utf8"))
    return Array.isArray(list) ? list : []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

function change(update: (list: SavedListing[]) => Promise<SavedListing[]> | SavedListing[]) {
  const next = (global.__savedWrite ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const list = await update(await listSaved())
      await mkdir(path.dirname(FILE), { recursive: true })
      // Replaced whole, so a read meanwhile never sees half a file.
      const temp = `${FILE}.${process.pid}-${Date.now()}.tmp`
      await writeFile(temp, JSON.stringify(list, null, 1))
      await rename(temp, FILE)
      return list
    })
  global.__savedWrite = next
  return next
}

/** Files the listings into `folder` (created if new), moving any saved elsewhere. */
export function saveListings(folder: string, listings: SaveRequest[]) {
  return change(async (list) => {
    const name = await addCategory(folder)
    const ids = new Set(listings.map((l) => l.listingId))
    const savedAt = new Date().toISOString()
    const added = listings.map((l) => ({ ...l, folder: name, savedAt }))
    return [...added, ...list.filter((s) => !ids.has(s.listingId))]
  })
}

export function removeSaved(listingIds: number[]) {
  const ids = new Set(listingIds)
  return change((list) => list.filter((s) => !ids.has(s.listingId)))
}
