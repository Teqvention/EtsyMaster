import { addName, listNames } from "@/lib/categories"
import { readDoc, updateDoc } from "@/lib/db/documents"

import type { SavedListing, SaveRequest } from "./types"

// Saved listings in one document ("saved"), newest first. A listing sits in
// one folder at a time: saving it again moves it.
const FILE = "saved"
// The folders' names, empty ones too (the mockup categories are apart).
const FOLDERS = "saved/folders"

export async function listSaved(): Promise<SavedListing[]> {
  const list = await readDoc<unknown>(FILE, [])
  return Array.isArray(list) ? list : []
}

/** Every folder, A–Z, with how many listings are in it. */
export async function listFolders() {
  return listNames(FOLDERS, (await listSaved()).map((s) => s.folder))
}

/** Adds a folder unless one by that name exists; returns the name as stored. */
export const addFolder = (name: string) => addName(FOLDERS, name)

/** Changes the list, after every other change to it on any server. */
function change(update: (list: SavedListing[]) => Promise<SavedListing[]> | SavedListing[]) {
  return updateDoc<unknown>(FILE, [], (list) => update(Array.isArray(list) ? list : [])) as Promise<SavedListing[]>
}

/** Files the listings into `folder` (created if new), moving any saved elsewhere. */
export async function saveListings(folder: string, listings: SaveRequest[]) {
  // Outside the change: it holds another document's row.
  const name = await addFolder(folder)
  return change((list) => {
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
