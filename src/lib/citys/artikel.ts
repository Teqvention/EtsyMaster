import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import sharp from "sharp"

import { listAccounts } from "@/lib/accounts/store"
import { readDoc, updateDoc, writeDoc } from "@/lib/db/documents"
import { exclusive } from "@/lib/db/sql"
import { instanceId, isLive } from "@/lib/db/workers"
import { askJson } from "@/lib/mockups/gemini"
import { readPipeline } from "@/lib/pipeline/store"
import { listings as syncedListings, sales as syncedSales } from "@/lib/sync/store"
import { VOID_SALE, type SyncedListing } from "@/lib/sync/types"

import { pool, register } from "./places"
import { rootsOf, STATUS, statusFile, type CityOrigin, type CityStatus, type StatusEntry, type StatusFile } from "./ours"
import { ranking } from "./ranking"
import { shopRead } from "./read"
import { citySettings } from "./settings"
import type { ShopRead, Tier } from "./types"

// Artikel's city columns: for every listing of our city shops, where it
// came from (origin), what we decided about it (status) and how much demand
// its place has (the ranking's tier).
//
// Origin: "robin" were made from reference photos (the old project's web
// app, from 16 Sept), "old" by the prompt systems before it (no reference,
// often generic pictures), "system" by this app's pipeline. The old project
// listed every live SlowMilesStudio listing by origin (11 Oct): group A is
// robin, B (turquoise, no reference) and C (the first AI method) are old,
// and the ones marked VERKAUFT have sold. It's read once into citys/origins;
// a listing it doesn't list goes by when it was made.
//
// Status: confirmed (green) stays, replace (yellow) frees the slot for a new
// poster, offline (red) isn't live. Robin, system and sets of three are
// confirmed; so is anything that has sold (never touched). Old ones are to
// be replaced unless they earn their place: views well above the rest of
// the old ones, a place the ranking knows and wants (not F), and a picture
// Gemini finds true to the place. Etsy gives no ad clicks per
// listing; views include the visits ads bring. A status set by hand stays
// through every classification.

const ORIGINS = "citys/origins"
const JOB = "citys/classify"

export type OriginEntry = { origin: "robin" | "old"; group: string; sold: boolean; sheet: string }
type Origins = { listings: Record<string, OriginEntry>; importedAt: string; source: string }

/** When the reference-photo system started: newer listings the document doesn't list are robin. */
const ROBIN_SINCE = Date.parse("2026-09-16T00:00:00Z")

/** Reads the old project's document of live listings by origin (markdown tables under "## A ·" headings). */
export async function importOrigins(markdown: string, source = "upload") {
  const listings: Record<string, OriginEntry> = {}
  let group = ""
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^##\s+([A-Z])\s*·/)
    if (heading) {
      group = heading[1]
      continue
    }
    const row = line.match(/^\|\s*([^|]+?)\s*\|\s*\[(\d{6,})\]/)
    if (!row || !group) continue
    listings[row[2]] = { origin: group === "A" ? "robin" : "old", group, sold: /VERKAUFT/i.test(line), sheet: row[1].trim() }
  }
  if (!Object.keys(listings).length) throw new Error("No listings found in that document")
  const doc: Origins = { listings, importedAt: new Date().toISOString(), source }
  await writeDoc(ORIGINS, doc)
  return { listings: Object.keys(listings).length }
}

/** The origins document, read from the project folder the first time it's there. */
async function origins(): Promise<Origins | null> {
  const held = await readDoc<Origins | null>(ORIGINS, null)
  if (held) return held
  try {
    const file = (await readdir(process.cwd())).find((f) => /^live-listings-herkunft.*\.md$/i.test(f))
    if (!file) return null
    await importOrigins(await readFile(path.join(process.cwd(), file), "utf8"), file)
    return readDoc<Origins | null>(ORIGINS, null)
  } catch (error) {
    console.warn("City origins:", (error as Error).message)
    return null
  }
}

/** What the city columns are worked out from, read once per request. */
async function context() {
  const settings = await citySettings()
  const [accounts, reg, status, docOrigins, ranked, pipeline] = await Promise.all([
    listAccounts(),
    register(),
    statusFile(),
    origins(),
    ranking().catch(() => null),
    readPipeline().catch(() => null),
  ])
  const cityAccounts = accounts.filter((a) => settings.accounts.includes(a.id) && a.shop)
  const reads = new Map<string, ShopRead>()
  for (const a of cityAccounts) reads.set(a.id, await shopRead(a.shop!.id))
  return {
    accounts: cityAccounts,
    reg,
    status,
    docOrigins,
    reads,
    tiers: new Map((ranked?.places ?? []).map((p) => [p.id, { tier: p.tier, name: p.name }])),
    madeHere: new Set((pipeline?.items ?? []).map((i) => i.etsyListingId).filter((id): id is number => !!id)),
  }
}
type Context = Awaited<ReturnType<typeof context>>

function originOf(ctx: Context, listingId: number, createdAt: number): CityOrigin {
  if (ctx.madeHere.has(listingId)) return "system"
  const doc = ctx.docOrigins?.listings[listingId]
  if (doc) return doc.origin
  return createdAt >= ROBIN_SINCE ? "robin" : "old"
}

function placeOf(ctx: Context, account: string, listingId: number) {
  const r = ctx.reads.get(account)?.listings[listingId]
  if (!r) return { placeId: null, place: null, tier: null, set: false }
  const set = r.k === "set"
  const placeId = rootsOf(ctx.reg, r.p, set)[0] ?? null
  const known = placeId ? ctx.tiers.get(placeId) : undefined
  return {
    placeId,
    place: known?.name ?? (placeId ? ctx.reg.places[placeId]?.name : null) ?? r.p[0]?.name ?? null,
    tier: known?.tier ?? null,
    set,
  }
}

export type CityColumns = {
  status: CityStatus | null
  origin: CityOrigin
  tier: Tier | null
  place: string | null
  placeId: string | null
  reason?: string
  manual?: boolean
}

type RowRef = { listingId: number; account: string; state: string; createdAt: number }

/** The city columns of our city shops' rows, by listing id; other shops' rows get none. */
export async function cityColumns(rows: RowRef[]) {
  const ctx = await context()
  const ids = new Set(ctx.accounts.map((a) => a.id))
  const byListing = new Map<number, CityColumns>()
  for (const row of rows) {
    if (!ids.has(row.account)) continue
    const entry = ctx.status.listings[row.listingId]
    const { placeId, place, tier } = placeOf(ctx, row.account, row.listingId)
    byListing.set(row.listingId, {
      status: entry?.status ?? (row.state === "active" ? null : "offline"),
      origin: entry?.origin ?? originOf(ctx, row.listingId, row.createdAt),
      tier,
      place,
      placeId,
      ...(entry?.reason && { reason: entry.reason }),
      ...(entry?.manual && { manual: true }),
    })
  }
  return { accounts: [...ids], byListing, classifiedAt: ctx.status.classifiedAt }
}

// --- Classifying: a run in the background, its progress in citys/classify ---

export type ClassifyResult = { confirmed: number; replace: number; offline: number; manual: number; looked: number }

export type ClassifyJob = {
  status: "idle" | "running" | "done" | "error"
  step?: string
  done: number
  total: number
  result?: ClassifyResult
  error?: string
  startedAt?: string
  finishedAt?: string
  runner?: string
}

const IDLE: ClassifyJob = { status: "idle", done: 0, total: 0 }

export async function classifyJob(): Promise<ClassifyJob> {
  const job = await readDoc<ClassifyJob>(JOB, IDLE)
  if (job.status === "running" && job.runner !== instanceId && !(await isLive(job.runner))) {
    return { ...job, status: "error", error: "Stopped with the server that ran it" }
  }
  return job
}

const patchJob = (change: Partial<ClassifyJob>) => updateDoc<ClassifyJob>(JOB, IDLE, (job) => ({ ...job, ...change }))

/** Starts a classification unless one runs; `look` lets Gemini judge the pictures of the old ones that perform. */
export async function startClassify({ look = true }: { look?: boolean } = {}) {
  const job = await classifyJob()
  if (job.status === "running") return job
  await patchJob({
    status: "running",
    step: "Reading the listings",
    done: 0,
    total: 0,
    result: undefined,
    error: undefined,
    startedAt: new Date().toISOString(),
    finishedAt: undefined,
    runner: instanceId,
  })
  void exclusive("citys:classify", async () => {
    try {
      const result = await classify({ look })
      await patchJob({ status: "done", step: undefined, result, finishedAt: new Date().toISOString(), runner: undefined })
    } catch (error) {
      console.error("City classification:", error)
      await patchJob({ status: "error", error: (error as Error).message, finishedAt: new Date().toISOString(), runner: undefined })
    }
  }).then((ran) => {
    if (ran === null) void patchJob({ status: "idle", step: "Another server is classifying already", runner: undefined })
  })
  return classifyJob()
}

/** The bar old listings have to clear: the best tenth of the live old ones by views a month. */
const KEEP_SHARE = 0.1

async function classify({ look }: { look: boolean }): Promise<ClassifyResult> {
  const ctx = await context()
  const now = Date.now()

  type Judged = { listing: SyncedListing; origin: CityOrigin; group?: string; place: string; tier: Tier | null; sold: boolean; set: boolean; viewsMonth: number }
  const all: Judged[] = []
  for (const account of ctx.accounts) {
    const [list, sold] = await Promise.all([syncedListings(account.id), syncedSales(undefined, undefined, account.id)])
    const soldIds = new Set(sold.filter((s) => !VOID_SALE.includes(s.status)).map((s) => s.listingId))
    for (const l of list) {
      const doc = ctx.docOrigins?.listings[l.listingId]
      const { place, tier, set } = placeOf(ctx, account.id, l.listingId)
      all.push({
        listing: l,
        origin: originOf(ctx, l.listingId, l.createdAt),
        group: doc?.group,
        place: place ?? "",
        tier,
        sold: soldIds.has(l.listingId) || !!doc?.sold,
        set: set || /\bset of (3|three)\b/i.test(l.title),
        viewsMonth: (l.views / Math.max(1, (now - l.createdAt) / 86_400_000)) * 30,
      })
    }
  }

  const oldViews = all
    .filter((j) => j.origin === "old" && j.listing.state === "active")
    .map((j) => j.viewsMonth)
    .sort((a, b) => b - a)
  const bar = oldViews.length ? oldViews[Math.max(0, Math.ceil(oldViews.length * KEEP_SHARE) - 1)] : Infinity

  const decided = new Map<number, Omit<StatusEntry, "at">>()
  const toLook: Judged[] = []
  for (const j of all) {
    if (ctx.status.listings[j.listing.listingId]?.manual) continue
    const set = (status: CityStatus, reason: string) => decided.set(j.listing.listingId, { status, origin: j.origin, reason })
    if (j.listing.state !== "active") set("offline", `${j.listing.state.replace("_", " ")} on Etsy`)
    else if (j.sold) set("confirmed", "Has sold: never touched")
    else if (j.origin === "system") set("confirmed", "Made by the city studio")
    else if (j.set) set("confirmed", "Set of three")
    else if (j.origin === "robin") set("confirmed", "Made from reference photos")
    else if (j.group === "C") set("replace", "First AI method (1–15 Aug): too old to keep")
    else if (j.tier === "F") set("replace", "Its place has shown no demand (F)")
    else if (!j.tier) set("replace", "Its place isn't in the ranking")
    else if (j.viewsMonth < bar || j.listing.views < 10) set("replace", "Old prompt picture without the views to keep it")
    else toLook.push(j)
  }

  // The few old ones that perform: Gemini looks whether the picture shows the real place.
  await patchJob({ step: toLook.length && look ? `Looking at ${toLook.length} old listings that perform` : "Saving", total: toLook.length, done: 0 })
  let looked = 0
  let done = 0
  await pool(toLook, 3, async (j) => {
    const verdict = look ? await lookAt(j.listing, j.place).catch(() => null) : null
    if (verdict) looked++
    if (verdict && verdict.score < 4) {
      decided.set(j.listing.listingId, { status: "replace", origin: j.origin, reason: `Performs, but the picture doesn't hold up: ${verdict.why}` })
    } else {
      decided.set(j.listing.listingId, {
        status: "confirmed",
        origin: j.origin,
        reason: verdict ? `Performs and looks right: ${verdict.why}` : "Performs well among the old ones",
      })
    }
    await patchJob({ done: ++done })
  })

  const at = new Date().toISOString()
  await updateDoc<StatusFile>(STATUS, { listings: {} }, (current) => {
    const listings = { ...current.listings }
    for (const [id, entry] of decided) if (!listings[id]?.manual) listings[id] = { ...entry, at }
    return { listings, classifiedAt: at }
  })
  const values = [...decided.values()]
  return {
    confirmed: values.filter((v) => v.status === "confirmed").length,
    replace: values.filter((v) => v.status === "replace").length,
    offline: values.filter((v) => v.status === "offline").length,
    manual: Object.values(ctx.status.listings).filter((e) => e.manual).length,
    looked,
  }
}

const LOOK_SCHEMA = {
  type: "OBJECT",
  properties: { why: { type: "STRING" }, score: { type: "INTEGER" } },
  required: ["why", "score"],
  propertyOrdering: ["why", "score"],
}

/** How truly a listing's picture shows its place, 1 (wrong, invented) to 5 (unmistakably the real place). */
async function lookAt(listing: SyncedListing, place: string) {
  const url = listing.images[0]?.fullUrl ?? listing.images[0]?.url
  if (!url) return null
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) return null
  const image = await sharp(Buffer.from(await response.arrayBuffer()))
    .resize(1024, 1024, { fit: "inside" })
    .jpeg({ quality: 85 })
    .toBuffer()
  const where = place || "the place in the title"
  const answer = await askJson<{ score?: number; why?: string }>(
    [
      `This is the main photo of an Etsy listing for a travel poster of ${where} (title: "${listing.title}"). The poster may hang in a room mockup: judge only the poster's picture.`,
      `Look at it as someone who knows ${where} well, and score 1 to 5 how truly it shows the real place:`,
      "5 unmistakably the real place: right landmarks, skyline or landscape, a picture people would buy.",
      "4 recognisably the place, with small liberties.",
      "3 plausible but generic: it could be many places.",
      "2 mostly invented: buildings or scenery the place doesn't have.",
      "1 wrong or obviously fake: impossible buildings, a made-up skyline, AI artefacts, garbled lettering.",
      'First "why" (at most 12 words, what decides it), then "score".',
    ].join("\n"),
    [image],
    { schema: LOOK_SCHEMA, temperature: 0, quick: true }
  )
  return { score: Math.min(5, Math.max(1, Math.round(answer.score ?? 3))), why: (answer.why ?? "").trim().slice(0, 120) }
}

// --- By hand ---

/** Sets the status by hand: classifications leave it. `null` hands the listings back to the classification. */
export async function setStatus(listingIds: number[], status: CityStatus | null) {
  const ctx = status === null ? null : await context()
  const created = new Map<number, number>()
  if (ctx) for (const a of ctx.accounts) for (const l of await syncedListings(a.id)) created.set(l.listingId, l.createdAt)
  const at = new Date().toISOString()
  await updateDoc<StatusFile>(STATUS, { listings: {} }, (current) => {
    const listings = { ...current.listings }
    for (const id of listingIds) {
      if (status === null) {
        if (listings[id]) listings[id] = { ...listings[id], manual: undefined, reason: "Handed back: classify again to judge it" }
        continue
      }
      const origin = listings[id]?.origin ?? originOf(ctx!, id, created.get(id) ?? 0)
      listings[id] = { status, origin, reason: "Set by hand", manual: true, at }
    }
    return { ...current, listings }
  })
}
