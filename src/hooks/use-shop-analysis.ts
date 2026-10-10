"use client"

import * as React from "react"

import { notifyEtsyRequest } from "@/hooks/use-etsy-usage"
import { recordShopAnalysis, type ShopAnalysisSummary } from "@/hooks/use-shop-history"
import {
  applyReviews,
  defaultPlan,
  newReviewsSince,
  planCost,
  reviewsSince,
  type AnalysisPlan,
} from "@/lib/etsy/analysis"
import type {
  Listing,
  ListingIdPage,
  ListingShop,
  ShopReview,
  ShopReviewPage,
} from "@/lib/etsy/types"
import type { StoredAnalysis } from "@/lib/shops/types"

// Fetches a shop's listings (then its reviews) page by page, so the analysis
// fills in as data lands and the run can be stopped part way. Runs belong to
// the app, not the page: one keeps going when you leave the Shops page or open
// another shop, the header shows how far along it is, and coming back picks it
// up where it got to. Each page goes through the server's cache, so re-running
// a plan costs no quota; finished runs are also kept for the session, and
// every run that settles is stored on the server, so a shop analysed before
// opens with its listings at once. A run can build on an earlier one: listings
// come as a page of ids first, and only the ones not held yet are fetched in
// full; held reviews are topped up with the ones newer than them.

const PAGE = 100

export type AnalysisStatus = "idle" | "running" | "done" | "stopped" | "error"

export type AnalysisRun = {
  shopId: number
  plan: AnalysisPlan
  status: AnalysisStatus
  listings: Listing[]
  /** Active listings Etsy reports; the run stops at the plan's limit or this. */
  listingTotal: number | null
  reviews: ShopReview[]
  /** Reviews in the window, once the first page says. */
  reviewTotal: number | null
  /** ISO 8601: every review in the window up to then is held. */
  reviewsAt: string | null
  error: string | null
  /** ISO 8601, once settled: when its data was fetched. */
  analysedAt: string | null
  /** Shown from the server's copy, not fetched in this visit. */
  stored: boolean
}

export type ShopRun = { shop: ListingShop; run: AnalysisRun }

// --- The store: each shop's latest run, on show or in progress ---

type Entry = { shop: ListingShop; run: AnalysisRun; abort: AbortController | null }

const entries = new Map<number, Entry>()
const finished = new Map<string, AnalysisRun>()
/** Shops whose page is on screen, counted: their runs aren't "in the background". */
const onScreen = new Map<number, number>()
const listeners = new Set<() => void>()
const settleListeners = new Set<(settled: ShopRun) => void>()
const NONE: ShopRun[] = []
let background: ShopRun[] = NONE

function emit() {
  const running = [...entries.values()].filter((e) => e.run.status === "running")
  const away = running.filter((e) => !onScreen.has(e.shop.id))
  background = away.length ? away.map(({ shop, run }) => ({ shop, run })) : NONE
  warnBeforeUnload(running.length > 0)
  listeners.forEach((notify) => notify())
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

// A reload or a closed tab would lose a run part way, so the browser asks first.
const confirmUnload = (event: BeforeUnloadEvent) => event.preventDefault()
let warning = false
function warnBeforeUnload(on: boolean) {
  if (on === warning) return
  warning = on
  if (on) window.addEventListener("beforeunload", confirmUnload)
  else window.removeEventListener("beforeunload", confirmUnload)
}

function runKey(shopId: number, plan: AnalysisPlan) {
  return `${shopId}:${plan.limit}:${plan.sort}:${plan.reviews}`
}

/** A finished run from earlier in the session, if there is one. */
function cachedRun(shopId: number, plan: AnalysisPlan) {
  return finished.get(runKey(shopId, plan)) ?? null
}

/** The shop's run this session — in progress, settled or restored — if it has one. */
export function currentRun(shopId: number) {
  return entries.get(shopId)?.run ?? null
}

/** Whether any shop is being analysed. */
export function isAnalysing() {
  return [...entries.values()].some((e) => e.run.status === "running")
}

/** The shop's last analysis stored on the server, or null if it was never analysed. */
export async function fetchStoredAnalysis(shopId: number): Promise<StoredAnalysis | null> {
  const res = await fetch(`/api/shops/${shopId}/analysis`, { cache: "no-store" })
  if (res.status === 404) return null
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
  return res.json()
}

/** The run a stored analysis was. */
export function storedRun(stored: StoredAnalysis): AnalysisRun {
  return {
    shopId: stored.shop.id,
    plan: stored.plan,
    status: stored.status,
    listings: stored.listings,
    listingTotal: stored.listingTotal,
    reviews: stored.reviews,
    reviewTotal: stored.reviewTotal,
    // Kept before this was: a finished run had them all when it settled.
    reviewsAt: stored.reviewsAt !== undefined ? stored.reviewsAt : stored.status === "done" ? stored.analysedAt : null,
    error: null,
    analysedAt: stored.analysedAt,
    stored: true,
  }
}

// What was fetched is kept even when a run is stopped or fails part way.
function storeRun(shop: ListingShop, run: AnalysisRun) {
  if (run.listings.length === 0 || run.status === "running" || run.status === "idle") return
  const body: StoredAnalysis = {
    shop,
    plan: run.plan,
    status: run.status,
    listings: run.listings,
    listingTotal: run.listingTotal,
    reviews: run.reviews,
    reviewTotal: run.reviewTotal,
    reviewsAt: run.reviewsAt,
    analysedAt: run.analysedAt ?? new Date().toISOString(),
  }
  fetch(`/api/shops/${shop.id}/analysis`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((error) => console.error(`Storing the analysis of ${shop.name}:`, error))
}

function show(shop: ListingShop, run: AnalysisRun, abort: AbortController | null = null) {
  const entry: Entry = { shop, run, abort }
  entries.set(shop.id, entry)
  emit()
  return entry
}

// A settled run on show goes into the recent shops list, so it's there even
// when the run finished while you were on another page.
function remember(shop: ListingShop, run: AnalysisRun) {
  if (run.listings.length === 0 || run.status === "running" || run.status === "idle") return
  recordShopAnalysis(shop, summarise(run))
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  notifyEtsyRequest()
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? res.statusText)
  return data
}

/**
 * Fetches the shop with `plan`, or shows the session's copy of that run.
 * `fresh` fetches again even then (the server's page cache still applies).
 * `from`, an earlier run of the shop, is built on: its listings aren't fetched
 * again, nor its reviews when it had them all for the plan's window.
 */
export async function startAnalysis(
  shop: ListingShop,
  plan: AnalysisPlan,
  {
    fresh = false,
    quiet = false,
    from = null,
  }: { fresh?: boolean; quiet?: boolean; from?: AnalysisRun | null } = {}
) {
  stopAnalysis(shop.id)
  const shopId = shop.id
  const cached = fresh ? null : cachedRun(shopId, plan)
  if (cached) {
    show(shop, cached)
    remember(shop, cached)
    return
  }

  const held = new Map((from?.listings ?? []).map((l) => [l.id, l]))
  // Reviews `from` had every one of for this window, and up to when.
  const heldReviews =
    from?.reviewsAt && from.plan.reviews === plan.reviews
      ? { reviews: from.reviews, total: from.reviewTotal, at: from.reviewsAt }
      : null
  const abort = new AbortController()
  let current: AnalysisRun = {
    shopId,
    plan,
    status: "running",
    listings: [],
    listingTotal: null,
    reviews: [],
    reviewTotal: null,
    reviewsAt: null,
    error: null,
    analysedAt: null,
    stored: false,
  }
  const entry = show(shop, current, abort)
  // A run superseded by a newer one of the same shop no longer writes to the store.
  const isCurrent = () => entries.get(shopId) === entry
  const update = (patch: Partial<AnalysisRun>) => {
    current = { ...current, ...patch }
    if (!isCurrent()) return
    entry.run = current
    emit()
  }

  const seen = new Set<number>()
  let listed = false
  try {
    // Listings, in the plan's order, up to its limit: a page of ids, then in
    // full the ones not held yet.
    for (let offset: number | null = 0; offset !== null; ) {
      const remaining = plan.limit - current.listings.length
      if (remaining <= 0) break
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(Math.min(PAGE, remaining)),
        sort: plan.sort,
      })
      const page: ListingIdPage = await getJson<ListingIdPage>(
        `/api/shops/${shopId}/listing-ids?${params}`,
        abort.signal
      )
      // Offset paging over a live shop can repeat a listing across pages.
      const ids = page.ids.filter((id) => !seen.has(id))
      const missing = ids.filter((id) => !held.has(id))
      if (missing.length > 0) {
        const fetched = await getJson<Listing[]>(`/api/listings/batch?ids=${missing.join(",")}`, abort.signal)
        fetched.forEach((l) => held.set(l.id, l))
      }
      ids.forEach((id) => seen.add(id))
      update({
        // Ones Etsy no longer has in full are left out.
        listings: [...current.listings, ...ids.flatMap((id) => held.get(id) ?? [])].slice(0, plan.limit),
        listingTotal: page.total,
      })
      offset = page.nextOffset
    }
    listed = true

    // Then every review in the window, newest first: those held already are
    // kept, and only the ones since the day they were fetched are fetched.
    const reviewsAt = new Date().toISOString()
    if (plan.reviews !== "none") {
      const window = reviewsSince(plan.reviews)
      const heldUntil = heldReviews ? newReviewsSince(plan.reviews, heldReviews.at) : null
      const older =
        heldReviews && heldUntil !== null
          ? heldReviews.reviews.filter(
              (r) => r.createdAt < heldUntil * 1000 && r.createdAt >= (window ?? 0) * 1000
            )
          : []
      const since = heldUntil ?? window
      const fetched: ShopReview[] = []
      update({ reviews: older })
      for (let offset: number | null = 0; offset !== null; ) {
        const params = new URLSearchParams({ offset: String(offset) })
        if (since) params.set("since", String(since))
        const page: ShopReviewPage = await getJson<ShopReviewPage>(
          `/api/shops/${shopId}/reviews?${params}`,
          abort.signal
        )
        fetched.push(...page.reviews)
        update({ reviews: [...fetched, ...older], reviewTotal: page.total + older.length })
        offset = page.nextOffset
      }
    }

    update({ status: "done", reviewsAt, analysedAt: new Date().toISOString() })
    finished.set(runKey(shopId, plan), current)
  } catch (error) {
    // Stopped or failed part way, what was held still is: the listings not
    // reached yet, and the reviews this run didn't get to replace.
    const keep: Partial<AnalysisRun> = {
      ...(from && !listed && { listings: [...current.listings, ...from.listings.filter((l) => !seen.has(l.id))] }),
      ...(heldReviews && {
        reviews: heldReviews.reviews,
        reviewTotal: heldReviews.total,
        reviewsAt: heldReviews.at,
      }),
    }
    if (abort.signal.aborted) {
      update({ ...keep, status: "stopped", analysedAt: new Date().toISOString() })
    } else {
      update({
        ...keep,
        status: "error",
        error: error instanceof Error ? error.message : "Couldn't load the shop",
        analysedAt: new Date().toISOString(),
      })
    }
  } finally {
    // Superseded runs too: what came in is worth keeping.
    storeRun(shop, current)
    if (isCurrent()) {
      entry.abort = null
      remember(shop, current)
      if (!onScreen.has(shopId) && !quiet) settleListeners.forEach((notify) => notify({ shop, run: current }))
    }
  }
}

export function stopAnalysis(shopId: number) {
  entries.get(shopId)?.abort?.abort()
}

/** Shows a stored analysis without fetching anything. */
export function restoreAnalysis(stored: StoredAnalysis) {
  stopAnalysis(stored.shop.id)
  const run = storedRun(stored)
  show(stored.shop, run)
  remember(stored.shop, run)
}

/** The shop's run, live, and what can be done with it. */
export function useShopAnalysis(shop: ListingShop) {
  const run = React.useSyncExternalStore(
    subscribe,
    () => currentRun(shop.id),
    () => null
  )
  const start = React.useCallback(
    (plan: AnalysisPlan, options?: { fresh?: boolean }) => startAnalysis(shop, plan, options),
    [shop]
  )
  const stop = React.useCallback(() => stopAnalysis(shop.id), [shop.id])
  return { run, start, stop, restore: restoreAnalysis }
}

/**
 * Marks the shop's page as on screen until the returned cleanup runs: its run
 * stays out of the header, and finishing it doesn't call for a toast.
 */
export function watchAnalysis(shopId: number) {
  onScreen.set(shopId, (onScreen.get(shopId) ?? 0) + 1)
  emit()
  return () => {
    const count = (onScreen.get(shopId) ?? 1) - 1
    if (count > 0) onScreen.set(shopId, count)
    else onScreen.delete(shopId)
    emit()
  }
}

/** Runs in progress for shops whose page isn't on screen. */
export function useBackgroundAnalyses() {
  return React.useSyncExternalStore(subscribe, () => background, () => NONE)
}

/** Calls `notify` when a run settles while its shop's page isn't on screen. */
export function onBackgroundSettle(notify: (settled: ShopRun) => void) {
  settleListeners.add(notify)
  return () => {
    settleListeners.delete(notify)
  }
}

// --- Many shops at once ---

// "Get all listings" for a list of shops: every active listing of each, two
// shops at a time, so the server spreads them over both analysis accounts.
// Nothing is fetched twice: a shop that has all its listings already is left
// out, and the rest build on what's held of them. The runs are ordinary ones
// (header, recent shops, stored copy); only the batch as a whole ends with a
// toast.

const BATCH_CONCURRENCY = 2

export type Batch = {
  total: number
  done: number
  failed: string[]
  /** Shops being fetched right now. */
  current: ListingShop[]
}

let batch: Batch | null = null
let batchQueue: ListingShop[] = []
let batchStopped = false
const batchListeners = new Set<() => void>()

function setBatch(next: Batch | null) {
  batch = next
  batchListeners.forEach((notify) => notify())
}

function subscribeBatch(notify: () => void) {
  batchListeners.add(notify)
  return () => {
    batchListeners.delete(notify)
  }
}

/** The batch under way, if any. */
export function useBatch() {
  return React.useSyncExternalStore(subscribeBatch, () => batch, () => null)
}

/**
 * Whether an analysis holds every listing of a shop with `activeListings`:
 * nothing for "Get all listings" to add.
 */
export function hasAllListings(
  analysis: Pick<ShopAnalysisSummary, "plan" | "complete" | "listings"> | null | undefined,
  activeListings: number
) {
  return (
    !!analysis &&
    analysis.plan.limit >= activeListings &&
    (analysis.complete || analysis.listings >= activeListings)
  )
}

/**
 * Every active listing, in the order and with the review window `from` had
 * (or the cheap one the shop's default plan picks).
 */
export function allListingsPlan(shop: ListingShop, from?: AnalysisRun | null): AnalysisPlan {
  const plan = { ...defaultPlan(shop), limit: Math.max(shop.activeListings, from?.listingTotal ?? 0, 1) }
  return from ? { ...plan, sort: from.plan.sort, reviews: from.plan.reviews } : plan
}

/**
 * About how many Etsy requests "Get all listings" makes for the shop: none
 * once it has every listing; otherwise a page of ids per 100 listings, the
 * ones not held yet in full, and the reviews newer than those held.
 */
export function allListingsCost(shop: ListingShop, analysis: ShopAnalysisSummary | null | undefined) {
  if (hasAllListings(analysis, shop.activeListings)) return 0
  const total = Math.max(shop.activeListings, 1)
  const missing = Math.max(total - (analysis?.listings ?? 0), 0)
  const plan = analysis?.plan ?? defaultPlan(shop)
  const reviews = plan.reviews !== "none" && analysis?.complete ? 1 : planCost({ ...plan, limit: 0 }, shop)
  return Math.ceil(total / PAGE) + Math.ceil(missing / PAGE) + reviews
}

/**
 * Fetches every listing of each shop, a couple at a time. Shops already in
 * the batch are skipped; adding to a running batch queues them behind it.
 * Resolves with the batch once it's through, or null when this call only
 * added to one already under way.
 */
export async function analyseShops(shops: ListingShop[]): Promise<Batch | null> {
  const queued = new Set([...batchQueue, ...(batch?.current ?? [])].map((s) => s.id))
  const fresh = shops.filter((s) => !queued.has(s.id))
  if (fresh.length === 0) return null
  batchQueue.push(...fresh)
  if (batch) {
    setBatch({ ...batch, total: batch.total + fresh.length })
    return null
  }

  batchStopped = false
  setBatch({ total: fresh.length, done: 0, failed: [], current: [] })
  const worker = async () => {
    for (let shop = batchQueue.shift(); shop && !batchStopped; shop = batchQueue.shift()) {
      setBatch({ ...batch!, current: [...batch!.current, shop] })
      const status = await getMissingListings(shop)
      setBatch({
        ...batch!,
        done: batch!.done + 1,
        failed: status === "error" ? [...batch!.failed, shop.name] : batch!.failed,
        current: batch!.current.filter((s) => s.id !== shop!.id),
      })
    }
  }
  await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, worker))
  const settled = batch
  batchQueue = []
  setBatch(null)
  return settled
}

// One shop of the batch, built on what's held of it. One that turns out to
// have every listing already (the recent shops list hadn't caught up) is left
// as it is. Resolves with how its run ended.
async function getMissingListings(shop: ListingShop) {
  const from = await heldRun(shop)
  const total = Math.max(shop.activeListings, from?.listingTotal ?? 0)
  if (from && hasAllListings({ plan: from.plan, complete: from.status === "done", listings: from.listings.length }, total)) {
    remember(shop, from)
    return null
  }
  if (batchStopped) return null
  await startAnalysis(shop, allListingsPlan(shop, from), { quiet: true, from })
  return currentRun(shop.id)?.status ?? null
}

/** What's held of the shop: this session's run or the server's copy, whichever has more listings. */
async function heldRun(shop: ListingShop): Promise<AnalysisRun | null> {
  const session = currentRun(shop.id)
  const stored = await fetchStoredAnalysis(shop.id).catch(() => null)
  const kept = stored && storedRun(stored)
  if (!session || session.status === "idle") return kept
  return kept && kept.listings.length > session.listings.length ? kept : session
}

/** Stops the batch: the shops under way stop where they got to, the rest aren't started. */
export function stopBatch() {
  batchStopped = true
  const current = batch?.current ?? []
  batchQueue = []
  current.forEach((shop) => stopAnalysis(shop.id))
}

// --- Reading a run ---

/** Exact review counts need every review there is, all of them loaded. */
export function isSharpened(run: AnalysisRun) {
  return run.plan.reviews === "all" && run.status === "done"
}

/** The run's listings, their estimates redone from exact review counts when it has them. */
export function analysedListings(run: AnalysisRun) {
  return isSharpened(run) ? applyReviews(run.listings, run.reviews) : run.listings
}

// What the recent shops list shows of a run.
function summarise(run: AnalysisRun): ShopAnalysisSummary {
  const listings = analysedListings(run)
  const top = [...listings]
    .sort((a, b) => b.estimate.revenuePerMonthCents - a.estimate.revenuePerMonthCents)
    .slice(0, 3)
  return {
    plan: run.plan,
    listings: listings.length,
    complete: run.status === "done",
    revenuePerMonthCents: listings.reduce((total, l) => total + l.estimate.revenuePerMonthCents, 0),
    salesPerMonth: listings.reduce((total, l) => total + l.estimate.salesPerMonth, 0),
    top: top.map((l) => ({ title: l.title, thumb: l.images[0]?.thumb ?? null })),
    analysedAt: run.analysedAt ?? new Date().toISOString(),
  }
}

/** Listings the run is after: the plan's limit, or all the shop has if fewer. */
export function listingTarget(run: AnalysisRun) {
  return Math.min(run.plan.limit, run.listingTotal ?? run.plan.limit)
}

// Weighted by requests: a listing page costs two (page + batch), a review page one.
export function runProgress(run: AnalysisRun, shop: ListingShop) {
  const listingPages = Math.ceil(listingTarget(run) / 100) * 2
  const reviewPages =
    run.plan.reviews === "none"
      ? 0
      : run.reviewTotal !== null
        ? Math.max(Math.ceil(run.reviewTotal / 100), 1)
        : planCost({ ...run.plan, limit: 0 }, shop)
  const done =
    Math.ceil(run.listings.length / 100) * 2 + Math.ceil(run.reviews.length / 100)
  return Math.min(done / Math.max(listingPages + reviewPages, 1), 1)
}
