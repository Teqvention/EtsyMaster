import { addName, changeNames, listNames } from "@/lib/categories"
import { readDoc, updateDoc } from "@/lib/db/documents"
import { listSets, updateSet } from "@/lib/generation/storage"

import { cleanFolder, folderParts, isWithin, MAX_DEPTH, movedFolder, SEPARATOR } from "./folders"
import type { SavedListing, SaveRequest } from "./types"

// Saved listings in one document ("saved"), newest first. A listing sits in
// one folder at a time: saving it again moves it. Folders nest, named by
// their path (see folders.ts).
const FILE = "saved"
// The folders' names, empty ones too (the mockup categories are apart); a
// folder's parents are named along with it.
const FOLDERS = "saved/folders"
const LONGEST = 41 * MAX_DEPTH

export async function listSaved(): Promise<SavedListing[]> {
  const list = await readDoc<unknown>(FILE, [])
  return Array.isArray(list) ? list : []
}

/** Every folder, A–Z by path, with how many listings are in it itself. */
export async function listFolders() {
  return listNames(FOLDERS, (await listSaved()).map((s) => s.folder))
}

/**
 * Adds a folder, and the folders it's in, unless they're there; returns its
 * path as stored, every part in the spelling it was first given.
 */
export async function addFolder(path: string) {
  const parts = folderParts(cleanFolder(path))
  if (!parts.length) throw new Error("Name is empty")
  let stored = ""
  for (const part of parts) stored = await addName(FOLDERS, stored ? `${stored}${SEPARATOR}${part}` : part, LONGEST)
  return stored
}

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

/**
 * Moves (or renames) the folder `from`, with everything in it, to the path
 * `to`; into a folder of that name, if there is one. The poster sets made
 * from its listings go along, so the Generation page follows. Answers the
 * folder's new path.
 */
export async function moveFolder(from: string, to: string) {
  const source = cleanFolder(from)
  const target = cleanFolder(to)
  if (!source || !target) throw new Error("A folder is required")
  if (isWithin(target, source) && target.toLowerCase() !== source.toLowerCase()) {
    throw new Error("A folder can't go inside itself")
  }
  const moved = await addFolder(target)
  const move = (path: string) => movedFolder(path, source, moved)
  // Folders of the same name where it lands become one.
  await changeNames(FOLDERS, (names) => {
    const kept = new Map<string, string>()
    for (const name of names.map(move)) if (!kept.has(name.toLowerCase())) kept.set(name.toLowerCase(), name)
    return [...kept.values()]
  })
  const list = await change((list) => list.map((s) => (isWithin(s.folder, source) ? { ...s, folder: move(s.folder) } : s)))
  for (const set of await listSets()) {
    if (set.kind === "poster" && isWithin(set.folder, source)) {
      await updateSet(set.id, (s) => ({ ...s, folder: move(s.folder) })).catch(() => {})
    }
  }
  return { name: moved, saved: list }
}

/** Takes away an empty folder and the empty folders in it. */
export async function deleteFolder(path: string) {
  const folder = cleanFolder(path)
  if ((await listSaved()).some((s) => isWithin(s.folder, folder))) throw new Error("The folder isn't empty")
  await changeNames(FOLDERS, (names) => names.filter((n) => !isWithin(n, folder)))
}
