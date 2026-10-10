import type { PlanGroup } from "@/lib/pipeline/types"

import { words } from "./text"

// Spreading an upload over the upload accounts. A preset decides which
// accounts each group (the posters of one reference photo) may go to; the
// posters are then placed so every account gets its fair share, and alike
// motifs (two ducks, three owls) land in different shops rather than side by
// side in one. Pure and deterministic, so the dialog's preview is exactly
// what gets sent. Browser and server alike.

/** All to one account · whole groups to accounts · every group over all accounts · chosen per group. */
export type SpreadMode = "one" | "groups" | "even" | "mixed"

/** A poster to place. `motif` says what it shows: its few words, then a sentence. */
export type Placeable = { key: string; groupId: string; outputId: string; motif: string }

/** Which accounts each group's posters may go to: group id → account ids. */
export type Allowed = Record<string, string[]>

/** Where each poster goes: poster key → account id. */
export type Assignment = Record<string, string>

/** Two posters this alike (0–1) shouldn't share a shop: the same animal is about 0.3. */
export const ALIKE = 0.25

// Words that say nothing about what a poster shows.
const FILLER = new Set([
  "poster", "print", "wall", "decor", "illustration", "artwork", "design", "style", "styled", "background",
  "scene", "image", "picture", "featuring", "showing", "shows", "wearing", "wear", "holding", "hold", "sit", "sitting",
  "stand", "standing", "large", "small", "big", "tiny", "oversized", "massive", "one", "two", "three", "four",
  "single", "pair", "both", "each", "other", "another", "its", "their", "his", "her", "while", "which", "who", "has",
  "have", "are", "is", "into", "over", "under", "behind", "front", "against", "beside", "next", "center", "centre",
  "frame", "framed", "white", "black", "blue", "red", "green", "pink", "teal", "yellow", "orange", "purple", "grey",
  "gray", "brown", "gold", "golden", "silver", "beige", "cream", "dark", "light", "bright", "vibrant", "soft", "solid",
  "bold", "flat", "textured", "minimal", "minimalist", "vintage", "retro", "modern", "funky", "quirky", "high",
  "creativity", "arrangement", "focusing", "immediate", "foreground", "composition", "colour", "color", "palette",
])

/** What a text says, word by word: content words, singular. */
function terms(text: string) {
  return words(text)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .filter((w) => !FILLER.has(w) && !/^\d+$/.test(w))
}

type Vector = Map<string, number>

/**
 * Each poster's motif as weighted words. A word in both its name and its
 * sentence is what it shows ("Chic Ducks at Brunch. Two ducks wearing…"),
 * the name's other words are the scene, the sentence's the details. A word
 * most of the posters share (the steal's concept, sunglasses on every one)
 * weighs little, so what's left is what tells them apart.
 */
export function motifVectors(posters: Placeable[]) {
  const raw = posters.map((p) => {
    const [name, ...rest] = p.motif.split(". ")
    const named = new Set(terms(name))
    const told = new Set(terms(rest.join(". ")))
    const vector: Vector = new Map()
    for (const t of told) vector.set(t, named.has(t) ? 3 : 0.6)
    for (const t of named) if (!told.has(t)) vector.set(t, 1.5)
    return [p.key, vector] as const
  })
  const df = new Map<string, number>()
  for (const [, vector] of raw) for (const t of vector.keys()) df.set(t, (df.get(t) ?? 0) + 1)
  const n = posters.length
  const vectors = new Map<string, Vector>()
  for (const [key, vector] of raw) {
    const weighted: Vector = new Map()
    for (const [t, w] of vector) weighted.set(t, w * Math.log(1 + n / df.get(t)!))
    vectors.set(key, weighted)
  }
  return vectors
}

function norm(v: Vector) {
  let sum = 0
  for (const w of v.values()) sum += w * w
  return Math.sqrt(sum)
}

/** Cosine of two motif vectors, 0–1. */
export function similarity(a: Vector | undefined, b: Vector | undefined) {
  if (!a?.size || !b?.size) return 0
  let dot = 0
  for (const [t, w] of a) dot += w * (b.get(t) ?? 0)
  return dot ? dot / (norm(a) * norm(b)) : 0
}

/** Pairwise similarity, remembered. */
function similarities(vectors: Map<string, Vector>) {
  const known = new Map<string, number>()
  return (a: string, b: string) => {
    if (a === b) return 1
    const id = a < b ? `${a}|${b}` : `${b}|${a}`
    let value = known.get(id)
    if (value === undefined) known.set(id, (value = similarity(vectors.get(a), vectors.get(b))))
    return value
  }
}

/** Groups in the order the posters come, each with its posters. */
function byGroup(posters: Placeable[]) {
  const groups = new Map<string, Placeable[]>()
  for (const p of posters) groups.set(p.groupId, [...(groups.get(p.groupId) ?? []), p])
  return [...groups].map(([id, members]) => ({ id, members }))
}

/**
 * Whole groups to accounts: the biggest first, each to the account with the
 * fewest posters so far. Where another account is at most one poster behind,
 * the one without an alike group wins.
 */
function groupsToAccounts(posters: Placeable[], accounts: string[], alike: (a: string, b: string) => number) {
  const load = new Map(accounts.map((a) => [a, 0]))
  const held = new Map<string, Placeable[]>(accounts.map((a) => [a, []]))
  const chosen: Record<string, string> = {}
  const groups = byGroup(posters)
    .map((g, index) => ({ ...g, index }))
    .sort((a, b) => b.members.length - a.members.length || a.index - b.index)
  for (const group of groups) {
    const least = Math.min(...accounts.map((a) => load.get(a)!))
    const closeness = (account: string) =>
      Math.max(0, ...held.get(account)!.flatMap((p) => group.members.map((m) => alike(p.key, m.key))))
    const account = accounts
      .filter((a) => load.get(a)! <= least + 1)
      .map((a) => ({ a, close: closeness(a), load: load.get(a)! }))
      .sort((x, y) => x.close - y.close || x.load - y.load || accounts.indexOf(x.a) - accounts.indexOf(y.a))[0].a
    chosen[group.id] = account
    load.set(account, load.get(account)! + group.members.length)
    held.get(account)!.push(...group.members)
  }
  return chosen
}

/** Which accounts each group may go to under a preset. */
export function allowedFor(
  mode: SpreadMode,
  posters: Placeable[],
  accounts: string[],
  { one, mixed = {} }: { one?: string | null; mixed?: Allowed } = {}
): Allowed {
  const groups = byGroup(posters)
  if (!accounts.length) return {}
  if (mode === "one") {
    const target = one && accounts.includes(one) ? one : accounts[0]
    return Object.fromEntries(groups.map((g) => [g.id, [target]]))
  }
  if (mode === "groups") {
    const chosen = groupsToAccounts(posters, accounts, similarities(motifVectors(posters)))
    return Object.fromEntries(groups.map((g) => [g.id, [chosen[g.id]]]))
  }
  if (mode === "even") return Object.fromEntries(groups.map((g) => [g.id, accounts]))
  return Object.fromEntries(
    groups.map((g) => {
      const own = (mixed[g.id] ?? []).filter((a) => accounts.includes(a))
      return [g.id, own.length ? own : accounts]
    })
  )
}

/**
 * Every poster to one of its group's accounts. A group spread over several
 * gets the same number on each (the odd ones to whichever has the fewest
 * overall), and its most alike posters choose first, each where it has the
 * least in common with what's there already, across all groups.
 */
export function place(posters: Placeable[], allowed: Allowed, accounts: string[]): Assignment {
  const assignment: Assignment = {}
  if (!accounts.length) return assignment
  const alike = similarities(motifVectors(posters))
  const load = new Map(accounts.map((a) => [a, 0]))
  const held = new Map<string, string[]>(accounts.map((a) => [a, []]))
  // How alike a poster is to its closest other: those place first.
  const closest = new Map(
    posters.map((p) => [p.key, Math.max(0, ...posters.filter((q) => q.key !== p.key).map((q) => alike(p.key, q.key)))])
  )

  for (const { id, members } of byGroup(posters)) {
    const pool = (allowed[id] ?? accounts).filter((a) => accounts.includes(a))
    const use = pool.length ? pool : accounts
    const base = Math.floor(members.length / use.length)
    const odd = members.length % use.length
    const quota = new Map(
      [...use]
        .sort((a, b) => load.get(a)! - load.get(b)! || use.indexOf(a) - use.indexOf(b))
        .map((a, i) => [a, base + (i < odd ? 1 : 0)])
    )
    const order = members
      .map((p, index) => ({ p, index }))
      .sort((x, y) => closest.get(y.p.key)! - closest.get(x.p.key)! || x.index - y.index)
    for (const { p } of order) {
      const crowd = (account: string) => held.get(account)!.reduce((sum, k) => sum + alike(p.key, k), 0)
      const account = use
        .filter((a) => quota.get(a)! > 0)
        .map((a) => ({ a, crowd: crowd(a), left: quota.get(a)! }))
        .sort((x, y) => x.crowd - y.crowd || y.left - x.left || use.indexOf(x.a) - use.indexOf(y.a))[0].a
      assignment[p.key] = account
      quota.set(account, quota.get(account)! - 1)
      load.set(account, load.get(account)! + 1)
      held.get(account)!.push(p.key)
    }
  }
  return assignment
}

/** Pairs of alike posters that share an account, per account. */
export function alikePairs(posters: Placeable[], assignment: Assignment) {
  const alike = similarities(motifVectors(posters))
  const pairs: Record<string, [string, string][]> = {}
  for (const [i, p] of posters.entries()) {
    for (const q of posters.slice(i + 1)) {
      const account = assignment[p.key]
      if (account && account === assignment[q.key] && alike(p.key, q.key) >= ALIKE) {
        ;(pairs[account] ??= []).push([p.key, q.key])
      }
    }
  }
  return pairs
}

/** The plan's groups: a group on one account says so, any other lists each poster's account. */
export function planGroups(posters: Placeable[], assignment: Assignment): PlanGroup[] {
  return byGroup(posters.filter((p) => assignment[p.key])).map(({ id, members }) => {
    const accounts = [...new Set(members.map((p) => assignment[p.key]))]
    return {
      groupId: id,
      outputs: members.map((p) => p.outputId),
      distribution:
        accounts.length === 1
          ? { mode: "account" as const, account: accounts[0] }
          : { mode: "each" as const, accounts: Object.fromEntries(members.map((p) => [p.outputId, assignment[p.key]])) },
    }
  })
}
