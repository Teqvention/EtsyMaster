// Saved folders nest: a folder is named by its path, the folders it's in
// first, "/" between ("robin/Cats/Black"), so a listing still sits in one
// folder named by one string, and versions before nesting see a flat folder
// called "robin/Cats". Matched case-insensitively, shown as "robin › Cats".

export const SEPARATOR = "/"

/** At most this many folders deep. */
export const MAX_DEPTH = 6

/** A folder's own name: single spaces, at most 40 characters, no separator. */
const segment = (name: string) => name.replace(new RegExp(SEPARATOR, "g"), " ").trim().replace(/\s+/g, " ").slice(0, 40)

/** The folders a path runs through, outermost first. */
export const folderParts = (path: string) =>
  path
    .split(SEPARATOR)
    .map((p) => p.trim().replace(/\s+/g, " ").slice(0, 40))
    .filter(Boolean)

/** A path as saved: tidy names, empty ones dropped, at most `MAX_DEPTH` deep. */
export const cleanFolder = (path: string) => folderParts(path).slice(0, MAX_DEPTH).join(SEPARATOR)

/** The path of `name` inside `parent` (or at the top when null). */
export const childFolder = (parent: string | null, name: string) =>
  cleanFolder(parent ? `${parent}${SEPARATOR}${segment(name)}` : segment(name))

export const sameFolder = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Whether `path` is `folder` or inside it, at any depth. */
export const isWithin = (path: string, folder: string) => {
  const p = path.toLowerCase()
  const f = folder.toLowerCase()
  return p === f || p.startsWith(f + SEPARATOR)
}

/** The folder a folder is in, or null at the top. */
export function parentFolder(path: string): string | null {
  const parts = folderParts(path)
  return parts.length > 1 ? parts.slice(0, -1).join(SEPARATOR) : null
}

/** The folder's own name, the last part of its path. */
export const folderName = (path: string) => folderParts(path).at(-1) ?? path

/** Every folder a path runs through, itself last: "a", "a/b", "a/b/c". */
export function ancestry(path: string): string[] {
  const parts = folderParts(path)
  return parts.map((_, i) => parts.slice(0, i + 1).join(SEPARATOR))
}

/** How it reads: "robin › Cats › Black". */
export const describeFolder = (path: string) => folderParts(path).join(" › ")

/** `path` with the folder `from` (or one inside it) moved to `to`. */
export function movedFolder(path: string, from: string, to: string) {
  if (!isWithin(path, from)) return path
  return cleanFolder(to + path.slice(from.length))
}

export type FolderNode = {
  path: string
  name: string
  depth: number
  /** Listings in this folder itself. */
  own: number
  /** Listings in it and every folder inside it. */
  total: number
  children: FolderNode[]
}

/**
 * The folders as a tree, A–Z on every level, from their names and how many
 * listings each holds itself. A folder only named inside another (or only
 * holding listings) gets its parents made up along the way.
 */
export function folderTree(folders: { name: string; count: number }[]): FolderNode[] {
  const byKey = new Map<string, FolderNode>()
  const roots: FolderNode[] = []
  const node = (path: string): FolderNode => {
    const key = path.toLowerCase()
    const known = byKey.get(key)
    if (known) return known
    const parts = folderParts(path)
    const made: FolderNode = { path, name: parts.at(-1) ?? path, depth: parts.length - 1, own: 0, total: 0, children: [] }
    byKey.set(key, made)
    const parent = parentFolder(path)
    if (parent) node(parent).children.push(made)
    else roots.push(made)
    return made
  }
  for (const { name, count } of folders) {
    const path = cleanFolder(name)
    if (!path) continue
    node(path).own += count
  }
  const settle = (list: FolderNode[]): number => {
    list.sort((a, b) => a.name.localeCompare(b.name))
    let sum = 0
    for (const n of list) {
      n.total = n.own + settle(n.children)
      sum += n.total
    }
    return sum
  }
  settle(roots)
  return roots
}

/** Every node of the tree, depth first (parents before their children). */
export function flatten(nodes: FolderNode[]): FolderNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

/** The node at `path` in the tree, if there is one. */
export function findFolder(nodes: FolderNode[], path: string): FolderNode | null {
  for (const n of nodes) {
    if (sameFolder(n.path, path)) return n
    if (isWithin(path, n.path)) return findFolder(n.children, path)
  }
  return null
}
