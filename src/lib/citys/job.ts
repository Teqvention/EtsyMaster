import { listAccounts } from "@/lib/accounts/store"
import { readDoc, updateDoc } from "@/lib/db/documents"
import { exclusive } from "@/lib/db/sql"
import { instanceId, isLive } from "@/lib/db/workers"
import { GooglePausedError } from "@/lib/google/pause"
import { listings as syncedListings } from "@/lib/sync/store"

import { digests, taggedShops } from "./digest"
import { foldIn, pool } from "./places"
import { BATCH, readTitles, saveRead, shopRead, unread, type TitleInput } from "./read"
import { citySettings } from "./settings"
import type { ShopRead } from "./types"

// The run that keeps the city knowledge current: digests of the city shops
// (made again where a shop was analysed since), their titles read for places
// (only new and changed ones), our own shops' titles too, and the new names
// folded into the register. One at a time across every server (a lock), on
// the server that started it; its progress in citys/job for every page.

const FILE = "citys/job"

export type ReadJob = {
  status: "idle" | "running" | "done" | "error" | "stopped"
  phase: "digest" | "read" | "places" | null
  /** What it's at, in words. */
  step?: string
  total: number
  done: number
  failed: number
  error?: string
  startedAt: string | null
  finishedAt?: string
  runner?: string
  /** Asked to stop: it does after the batches in flight. */
  stop?: boolean
}

const IDLE: ReadJob = { status: "idle", phase: null, total: 0, done: 0, failed: 0, startedAt: null }

/** The run as it stands; one left "running" by a server that has stopped reads as stopped. */
export async function readJob(): Promise<ReadJob> {
  const job = await readDoc<ReadJob>(FILE, IDLE)
  if (job.status === "running" && job.runner !== instanceId && !(await isLive(job.runner))) {
    return { ...job, status: "stopped", step: "Stopped with the server that ran it" }
  }
  return job
}

function patch(change: Partial<ReadJob>) {
  return updateDoc<ReadJob>(FILE, IDLE, (job) => ({ ...job, ...change }))
}

/** Starts a run unless one is going; answers the run as it stands. */
export async function startReading() {
  const job = await readJob()
  if (job.status === "running") return job
  await patch({ ...IDLE, status: "running", phase: "digest", step: "Getting the shops ready", startedAt: new Date().toISOString(), runner: instanceId, stop: undefined, error: undefined, finishedAt: undefined })
  void exclusive("citys:read", run).then((ran) => {
    if (ran === null) void patch({ status: "idle", step: "Another server is reading already", runner: undefined })
  })
  return readJob()
}

export async function stopReading() {
  await patch({ stop: true })
  return readJob()
}

/** The titles to read: every city shop's listings, and our own city shops'. */
async function sources() {
  const settings = await citySettings()
  const shops = await taggedShops(settings.scope.primary)
  const made = await digests(shops.map((s) => s.shop.id))
  const inputs = new Map<number, TitleInput[]>()
  for (const [shopId, digest] of made) {
    inputs.set(shopId, digest.listings.map((l) => ({ id: l.id, title: l.title, tags: l.tags })))
  }
  const accounts = (await listAccounts()).filter((a) => settings.accounts.includes(a.id) && a.shop)
  for (const account of accounts) {
    const own = (await syncedListings(account.id)).filter((l) => l.state === "active" || l.state === "inactive" || l.state === "expired")
    inputs.set(account.shop!.id, own.map((l) => ({ id: l.listingId, title: l.title, tags: l.tags })))
  }
  return inputs
}

async function run() {
  try {
    const inputs = await sources()
    const todo: { shopId: number; listings: TitleInput[] }[] = []
    for (const [shopId, listings] of inputs) {
      const left = unread(await shopRead(shopId), listings)
      for (let at = 0; at < left.length; at += BATCH) todo.push({ shopId, listings: left.slice(at, at + BATCH) })
    }
    const total = todo.reduce((n, b) => n + b.listings.length, 0)
    await patch({ phase: "read", step: total ? `Reading ${total.toLocaleString("en-US")} titles` : "Every title is read", total, done: 0, failed: 0 })

    let done = 0
    let failed = 0
    let stopped = false
    await pool(todo, 3, async (batch) => {
      if (stopped || (await readDoc<ReadJob>(FILE, IDLE)).stop) {
        stopped = true
        return
      }
      try {
        const reads = await readTitles(batch.listings)
        await saveRead(batch.shopId, reads)
        failed += batch.listings.length - reads.size
      } catch (error) {
        if (error instanceof GooglePausedError) stopped = true
        console.error(`City titles, shop ${batch.shopId}:`, error)
        failed += batch.listings.length
      }
      done += batch.listings.length
      await patch({ done, failed })
    })
    if (stopped) {
      await patch({ status: "stopped", phase: null, step: "Stopped", finishedAt: new Date().toISOString(), stop: undefined, runner: undefined })
      return
    }

    await patch({ phase: "places", step: "Matching the places", done: 0, total: 0 })
    const reads: ShopRead[] = await Promise.all([...inputs.keys()].map(shopRead))
    let halted = false
    await foldIn(
      reads,
      (placed, all) => void patch({ done: placed, total: all, step: all ? `Matching ${all.toLocaleString("en-US")} place names` : "Every place is matched" }),
      async () => (halted ||= !!(await readDoc<ReadJob>(FILE, IDLE)).stop)
    )
    if (halted) {
      await patch({ status: "stopped", phase: null, step: "Stopped", finishedAt: new Date().toISOString(), stop: undefined, runner: undefined })
      return
    }

    await patch({ status: "done", phase: null, step: undefined, finishedAt: new Date().toISOString(), stop: undefined, runner: undefined })
  } catch (error) {
    console.error("City reading:", error)
    await patch({ status: "error", phase: null, error: (error as Error).message, finishedAt: new Date().toISOString(), stop: undefined, runner: undefined })
  }
}
