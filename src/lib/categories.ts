import { readDoc, updateDoc } from "@/lib/db/documents"
import type { CategorySummary } from "@/lib/mockups/types"

// Names things are filed under: the mockup categories, and the Saved page's
// folders, each a list of its own. One exists from the moment it's named,
// before anything is in it (a mockup from a reference takes a minute), so
// the names are kept in a document as well as on what's filed.

function names(list: unknown): string[] {
  return Array.isArray(list) ? list.filter((c): c is string => typeof c === "string") : []
}

/** Every name in the document `key` or on `filed`, A–Z, with how many of `filed` are under it. */
export async function listNames(key: string, filed: (string | undefined)[]): Promise<CategorySummary[]> {
  const byKey = new Map<string, string>()
  const counts = new Map<string, number>()
  for (const name of names(await readDoc<unknown>(key, []))) byKey.set(name.toLowerCase(), name)
  for (const name of filed) {
    if (!name) continue
    const lower = name.toLowerCase()
    if (!byKey.has(lower)) byKey.set(lower, name)
    counts.set(lower, (counts.get(lower) ?? 0) + 1)
  }
  return [...byKey]
    .map(([lower, name]) => ({ name, count: counts.get(lower) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Adds a name to the document `key` unless one like it is there; returns the name as stored. */
export async function addName(key: string, name: string) {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40)
  if (!clean) throw new Error("Name is empty")
  let stored = clean
  await updateDoc<unknown>(key, [], (list) => {
    const saved = names(list)
    const existing = saved.find((c) => c.toLowerCase() === clean.toLowerCase())
    if (existing) stored = existing
    return existing ? saved : [...saved, clean]
  })
  return stored
}
