import { newId, readDoc, updateDoc } from "@/lib/db/documents"
import { NotFoundError } from "@/lib/mockups/storage"

import { TAG_COLORS, type InternalTag, type TagColor, type TagsFile } from "./types"

// Internal tags: our own labels on listings ("bestseller", "test batch",
// "christmas"…), to filter Artikel by and to aim bulk actions at. They never
// go to Etsy. Stored in the "artikel/tags" document.

const FILE = "artikel/tags"
const EMPTY: TagsFile = { tags: [], assigned: {} }

export function readTags() {
  return readDoc<TagsFile>(FILE, EMPTY)
}

const color = (value: unknown, fallback: TagColor): TagColor =>
  TAG_COLORS.includes(value as TagColor) ? (value as TagColor) : fallback

export async function addTag(name: string, tagColor?: string) {
  const clean = name.trim().slice(0, 32)
  if (!clean) throw new Error("A tag needs a name")
  let tag: InternalTag | undefined
  await updateDoc<TagsFile>(FILE, EMPTY, (file) => {
    const existing = file.tags.find((t) => t.name.toLowerCase() === clean.toLowerCase())
    if (existing) {
      tag = existing
      return file
    }
    // Colours go round, so tags made one after another tell apart.
    tag = { id: newId("t-"), name: clean, color: color(tagColor, TAG_COLORS[(file.tags.length + 1) % TAG_COLORS.length]) }
    return { ...file, tags: [...file.tags, tag] }
  })
  return tag!
}

export async function updateTag(id: string, patch: { name?: string; color?: string }) {
  let tag: InternalTag | undefined
  await updateDoc<TagsFile>(FILE, EMPTY, (file) => ({
    ...file,
    tags: file.tags.map((t) => {
      if (t.id !== id) return t
      tag = { ...t, name: patch.name?.trim().slice(0, 32) || t.name, color: color(patch.color, t.color) }
      return tag
    }),
  }))
  if (!tag) throw new NotFoundError("Unknown tag")
  return tag
}

export async function deleteTag(id: string) {
  await updateDoc<TagsFile>(FILE, EMPTY, (file) => ({
    tags: file.tags.filter((t) => t.id !== id),
    assigned: Object.fromEntries(
      Object.entries(file.assigned)
        .map(([listing, ids]) => [listing, ids.filter((t) => t !== id)] as const)
        .filter(([, ids]) => ids.length)
    ),
  }))
}

/** Adds and takes off tags on listings; answers with the file. */
export function assignTags(listingIds: number[], { add = [], remove = [] }: { add?: string[]; remove?: string[] }) {
  return updateDoc<TagsFile>(FILE, EMPTY, (file) => {
    const known = new Set(file.tags.map((t) => t.id))
    const assigned = { ...file.assigned }
    for (const listingId of listingIds) {
      const next = new Set(assigned[listingId] ?? [])
      for (const id of add) if (known.has(id)) next.add(id)
      for (const id of remove) next.delete(id)
      if (next.size) assigned[listingId] = [...next]
      else delete assigned[listingId]
    }
    return { ...file, assigned }
  })
}
