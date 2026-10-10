import { docKeys, readDoc, updateDoc } from "@/lib/db/documents"

import { MAX_CHAIN_PHOTOS, type ChainPatch, type ChainVideo, type MockupChain } from "./chain-types"
import { NotFoundError } from "./storage"

// Mockup chains, the document "mockups/chains", next to the scenes they
// list. Every change answers with the whole list, since making one chain the
// default changes the others.

const CHAINS = "mockups/chains"
const SCENE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

const valid = (list: unknown) => (Array.isArray(list) ? list.filter(isChain) : [])

async function readChains(): Promise<MockupChain[]> {
  return valid(await readDoc<unknown>(CHAINS, []))
}

/** Changes the chains, after every other change to them on any server; answers the list as `listChains` does. */
async function changeChains(change: (list: MockupChain[]) => MockupChain[]) {
  await updateDoc<unknown>(CHAINS, [], async (stored) => change(await present(valid(stored))))
  return listChains()
}

/** The chains without scenes deleted since they were added. */
async function present(list: MockupChain[]) {
  const scenes = new Set((await docKeys("mockups/")).filter((k) => k.endsWith("/scene")).map((k) => k.split("/")[1]))
  return withDefault(
    list.map((chain) => ({
      ...chain,
      scenes: chain.scenes.filter((id) => scenes.has(id)),
      video: chain.video && scenes.has(chain.video.sceneId) ? chain.video : null,
    }))
  )
}

/** Every chain, oldest first, without scenes deleted since they were added. */
export async function listChains(): Promise<MockupChain[]> {
  return present(await readChains())
}

export async function getChain(id: string) {
  const chain = (await listChains()).find((c) => c.id === id)
  if (!chain) throw new NotFoundError("Unknown chain")
  return chain
}

/** The chain uploads use; null until one is made. */
export async function getDefaultChain() {
  return (await listChains()).find((c) => c.isDefault) ?? null
}

export function addChain(init: ChainPatch & { name: string }) {
  return changeChains((list) => {
    const now = new Date().toISOString()
    const chain: MockupChain = {
      id: `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      name: cleanName(init.name) || `Chain ${list.length + 1}`,
      scenes: cleanScenes(init.scenes ?? []),
      video: cleanVideo(init.video ?? null),
      // The first chain is the default; a new one only when asked.
      isDefault: list.length === 0 || init.isDefault === true,
      createdAt: now,
      updatedAt: now,
    }
    const next = chain.isDefault ? list.map((c) => ({ ...c, isDefault: false })) : list
    return [...next, chain]
  })
}

export function updateChain(id: string, patch: ChainPatch) {
  return changeChains((list) => {
    const current = list.find((c) => c.id === id)
    if (!current) throw new NotFoundError("Unknown chain")
    const changed: MockupChain = {
      ...current,
      ...(patch.name !== undefined && { name: cleanName(patch.name) || current.name }),
      ...(patch.scenes !== undefined && { scenes: cleanScenes(patch.scenes) }),
      ...(patch.video !== undefined && { video: cleanVideo(patch.video) }),
      updatedAt: new Date().toISOString(),
    }
    return list.map((c) => {
      if (c.id === id) return { ...changed, isDefault: patch.isDefault ?? c.isDefault }
      return patch.isDefault ? { ...c, isDefault: false } : c
    })
  })
}

export function deleteChain(id: string) {
  return changeChains((list) => {
    if (!list.some((c) => c.id === id)) throw new NotFoundError("Unknown chain")
    return withDefault(list.filter((c) => c.id !== id))
  })
}

/** Exactly one default: the first chain when the default is gone. */
function withDefault(list: MockupChain[]) {
  const first = list.findIndex((c) => c.isDefault)
  return list.map((c, i) => ({ ...c, isDefault: first < 0 ? i === 0 : i === first }))
}

const cleanName = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, 60)

function cleanScenes(scenes: string[]) {
  return [...new Set(scenes.filter((id) => SCENE_ID.test(id)))].slice(0, MAX_CHAIN_PHOTOS)
}

function cleanVideo(video: ChainVideo | null): ChainVideo | null {
  if (!video || !SCENE_ID.test(video.sceneId) || typeof video.clipId !== "string" || !video.clipId) return null
  return { sceneId: video.sceneId, clipId: video.clipId.slice(0, 64) }
}

function isChain(value: unknown): value is MockupChain {
  const c = value as MockupChain
  return (
    !!c &&
    typeof c.id === "string" &&
    typeof c.name === "string" &&
    Array.isArray(c.scenes) &&
    c.scenes.every((s) => typeof s === "string")
  )
}

/** A `ChainPatch` from a request body, or null when it isn't one. */
export function parsePatch(body: unknown): ChainPatch | null {
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, unknown>
  const patch: ChainPatch = {}
  if (b.name !== undefined) {
    if (typeof b.name !== "string") return null
    patch.name = b.name
  }
  if (b.scenes !== undefined) {
    if (!Array.isArray(b.scenes) || !b.scenes.every((s) => typeof s === "string")) return null
    patch.scenes = b.scenes
  }
  if (b.video !== undefined) {
    const v = b.video as ChainVideo | null
    if (v !== null && (typeof v !== "object" || typeof v.sceneId !== "string" || typeof v.clipId !== "string")) return null
    patch.video = v
  }
  if (b.isDefault !== undefined) {
    if (b.isDefault !== true) return null
    patch.isDefault = true
  }
  return patch
}
