import { listAccounts } from "@/lib/accounts/store"
import { newId, readDoc, updateDoc } from "@/lib/db/documents"
import { exclusive } from "@/lib/db/sql"
import { instanceId, isLive } from "@/lib/db/workers"
import { EtsyApiError, RESERVE } from "@/lib/etsy/client"
import { updateListing } from "@/lib/etsy/shop"
import { usageOf } from "@/lib/etsy/usage"
import { askJson } from "@/lib/mockups/gemini"
import { NotFoundError } from "@/lib/mockups/storage"
import { listings as syncedListings, patchListing, sales as syncedSales, syncBlocker } from "@/lib/sync/store"
import { cleanTag, DASH } from "@/lib/uploads/text"
import { VOID_SALE, type SyncedListing } from "@/lib/sync/types"

import { countryName } from "./geo"
import { fill, placeKeywords, strategy, tagOk, titleParts, type KeywordStrategy, type PlaceKeywords } from "./keywords"
import { pool, register, resolve } from "./places"
import { rootsOf, statusFile } from "./ours"
import { shopRead } from "./read"
import { citySettings } from "./settings"
import type { ListingRead, Place } from "./types"

// SEO for our city listings: Gemini proposes a title and 13 tags for each
// picked listing, following the keyword strategy, the place's own words
// (what the city shops' listings for it use, by sales) and how the listing
// does. One that sells, or draws views and favourites, keeps what works and
// changes little, unless a change is clearly worth it (old sales also buy
// visibility, so not every seller's keywords are good); one nobody sees can
// change a lot. Listings of one place are worked on together, so they cover
// different searches instead of competing for the same ones. Proposals stay
// in citys/seo until they're applied or dropped; applying changes the
// listings on Etsy one at a time, on the server that started it, keeping
// the account's quota reserve.

const FILE = "citys/seo"
/** Runs kept, newest first. */
const KEEP = 12
/** Listings of one place per request. */
const GROUP = 8

export type SeoChange = "keep" | "light" | "rewrite"
export type SeoBand = "strong" | "some" | "weak"

export type SeoProposal = {
  listingId: number
  account: string
  thumb: string | null
  place: string | null
  before: { title: string; tags: string[] }
  title: string
  tags: string[]
  change: SeoChange
  why: string
  band: SeoBand
  /** The numbers the band came from, in words. */
  numbers: string
  status: "proposed" | "queued" | "applied" | "failed" | "dropped"
  error?: string
  /** Changed by hand after Gemini proposed it. */
  edited?: boolean
  appliedAt?: string
}

export type SeoRun = {
  id: string
  createdAt: string
  status: "running" | "done" | "error"
  step?: string
  done: number
  total: number
  proposals: SeoProposal[]
  error?: string
  runner?: string
  /** Applying: why it waits, when it does (quota). */
  note?: string
}

type SeoFile = { runs: SeoRun[] }

const EMPTY: SeoFile = { runs: [] }

const alive = async (run: SeoRun): Promise<SeoRun> =>
  run.status === "running" && run.runner !== instanceId && !(await isLive(run.runner))
    ? { ...run, status: "error", error: "Stopped with the server that ran it" }
    : run

export async function seoRuns(): Promise<SeoRun[]> {
  return Promise.all((await readDoc<SeoFile>(FILE, EMPTY)).runs.map(alive))
}

export async function seoRun(id: string): Promise<SeoRun> {
  const run = (await readDoc<SeoFile>(FILE, EMPTY)).runs.find((r) => r.id === id)
  if (!run) throw new NotFoundError("Unknown analysis")
  return alive(run)
}

function changeRun(id: string, edit: (run: SeoRun) => void) {
  return updateDoc<SeoFile>(FILE, EMPTY, (file) => {
    const runs = file.runs.map((r) => (r.id === id ? structuredClone(r) : r))
    const run = runs.find((r) => r.id === id)
    if (run) edit(run)
    return { runs }
  })
}

// --- What each listing is worked on with ---

type Subject = {
  listing: SyncedListing
  account: string
  read?: ListingRead
  placeId: string | null
  /** The city (or region, park…) its place belongs to: the ranking's place. */
  place: Place | null
  /** What it shows, in words: "Bondi Beach (beach) in Sydney, New South Wales, Australia". */
  shows: string
  set: boolean
  sold: number
  viewsMonth: number
  band: SeoBand
  numbers: string
}

async function subjects(listingIds: number[]) {
  const settings = await citySettings()
  const [accounts, reg, status] = await Promise.all([listAccounts(), register(), statusFile()])
  const wanted = new Set(listingIds)
  const cityAccounts = accounts.filter((a) => settings.accounts.includes(a.id) && a.shop)
  const now = Date.now()
  const all: Subject[] = []
  const picked: Subject[] = []
  for (const account of cityAccounts) {
    const [list, read, sales] = await Promise.all([syncedListings(account.id), shopRead(account.shop!.id), syncedSales(undefined, undefined, account.id)])
    const sold = new Map<number, number>()
    for (const s of sales) if (!VOID_SALE.includes(s.status)) sold.set(s.listingId, (sold.get(s.listingId) ?? 0) + s.quantity)
    const live = list.filter((l) => l.state === "active")
    // The shop's own spread of views a month, to tell strong from weak.
    const rates = live.map((l) => (l.views / Math.max(1, (now - l.createdAt) / 86_400_000)) * 30).sort((a, b) => a - b)
    const at = (q: number) => rates[Math.min(rates.length - 1, Math.floor(rates.length * q))] ?? 0
    const [p40, p80] = [at(0.4), at(0.8)]
    for (const l of list) {
      if (l.state !== "active" && l.state !== "inactive" && l.state !== "expired") continue
      const r = read.listings[l.listingId]
      const placeId = r ? (rootsOf(reg, r.p, r.k === "set")[0] ?? null) : null
      const viewsMonth = (l.views / Math.max(1, (now - l.createdAt) / 86_400_000)) * 30
      const units = sold.get(l.listingId) ?? 0
      const band: SeoBand = units > 0 || (viewsMonth >= p80 && l.favorites >= 2) ? "strong" : viewsMonth <= p40 && l.favorites === 0 ? "weak" : "some"
      const age = Math.round((now - l.createdAt) / 86_400_000)
      const place = placeId ? (reg.places[placeId] ?? null) : null
      const own = r?.p[0] ? (resolve(reg, r.p[0]) ?? null) : null
      const subject: Subject = {
        listing: l,
        account: account.id,
        read: r,
        placeId,
        place,
        shows: showsOf(r, own, place),
        set: r?.k === "set" || /\bset of (2|3|4|6|two|three|four|six)\b/i.test(l.title),
        sold: units,
        viewsMonth,
        band,
        numbers: `${units} sold · ${Math.round(viewsMonth)} views a month · ${l.favorites} favourites · ${age} days online${status.listings[l.listingId] ? ` · ${status.listings[l.listingId].status}` : ""}`,
      }
      all.push(subject)
      if (wanted.has(l.listingId)) picked.push(subject)
    }
  }
  return { all, picked, reg }
}

/** What a listing shows, in words, for the prompt. */
function showsOf(r: ListingRead | undefined, own: Place | null, root: Place | null) {
  if (!r?.p.length) return "no place read off the title"
  if (r.k === "set") return `a set: ${r.p.map((p) => p.name).join(", ")}`
  const name = own?.name ?? r.p[0].name
  const kind = own?.kind ?? r.p[0].kind
  const within = root && root.id !== own?.id ? root.name : r.p[0].within
  const region = root?.region
  const country = countryName(root?.country ?? own?.country ?? r.p[0].country)
  return `${name} (${kind})${within && within !== name ? ` in ${within}` : ""}${region && region !== within ? `, ${region}` : ""}${country ? `, ${country}` : ""}`
}

// --- Asking ---

const SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "INTEGER" },
          why: { type: "STRING" },
          change: { type: "STRING", enum: ["keep", "light", "rewrite"] },
          title: { type: "STRING" },
          tags: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["id", "why", "change", "title", "tags"],
        propertyOrdering: ["id", "why", "change", "title", "tags"],
      },
    },
  },
  required: ["items"],
}

const BAND_WORDS: Record<SeoBand, string> = {
  strong: "STRONG (sells or draws views and favourites): keep what works, change only what clearly adds",
  some: "SOME (seen, little else): improve freely but keep its good parts",
  weak: "WEAK (hardly seen): rewrite as needed",
}

const LOOK_WORDS: Record<string, string> = {
  photo: "photograph",
  bw: "black and white",
  illustration: "illustration",
  watercolor: "watercolor",
  sketch: "sketch, line drawing",
  painting: "painting",
  map: "map",
  typography: "typographic",
}

function prompt(group: Subject[], siblings: Subject[], plan: KeywordStrategy, words: PlaceKeywords | null) {
  const line = (s: Subject) =>
    [
      s.listing.listingId,
      s.listing.title,
      `tags: ${s.listing.tags.join(", ") || "none"}`,
      `shows: ${s.shows}${s.set ? " (sold as a set: keep \"Set of …\" in the main search)" : ""}`,
      s.read?.s && s.read.s !== "unknown" ? `look: ${LOOK_WORDS[s.read.s] ?? s.read.s}` : "look: not known",
      s.numbers,
    ].join(" | ")

  return [
    "You write Etsy SEO for a shop selling travel and city posters: unframed prints of real places. The shop wants to rank broadly: for many places, and for each place in several searches, with its listings varied rather than one formula repeated.",
    "",
    "Etsy's rules and what ranks:",
    '- Title: at most 140 characters, in Title Case ("Bondi Beach Travel Poster, Sydney Wall Art, Australia Print"), parts apart by commas, never a dash or hyphen. The main search first: the place buyers search most for this poster and what it is. Usually that is the city; a famous beach, landmark or park can lead on its own (Bondi Beach, Central Park, Golden Gate Bridge), with the city later in the title. Then 2–4 more searches buyers really type, separated by commas. Readable, no word repeated more than twice, no ALL CAPS, no symbols but commas and one &.',
    "- Exactly 13 tags, lower case, each at most 20 characters including spaces (count them), no two the same, no hyphens, multi-word phrases buyers search. Title and tags together cover different searches.",
    "- Broad, proven searches beat clever niche ones: prefer what many shops and places use. No made-up phrases, nothing misleading (vintage when it isn't, framed: it ships as a print, original painting, digital download), no trademarks, no other places than the one shown (its city, region and country are fine).",
    "",
    "The shop's keyword strategy. {city} is the city (or park, region) the place belongs to, {landmark} the beach, district or landmark shown when it's one, {region} the state or region (only where buyers search it: US states, Tuscany, Provence, Bavaria; never an administrative region nobody types, like Estremadura or Île-de-France), {country} the country, {demonym} its adjective, {style} a word for the look when the look is known (drop it when it isn't):",
    `- Strongest patterns: ${plan.core.join(", ") || "{city} poster, {city} print, {city} wall art, {city} art"}. Each listing carries at least three; listings of one place vary which.`,
    `- Patterns to take turns with: ${plan.rotate.join(", ") || "{country} poster, {region} print, {landmark} print, {city} gift"}`,
    `- Place-free keywords to vary from: ${plan.generic.join(", ") || "travel poster, wall art, travel gift, housewarming gift"}`,
    `- Never use: ${plan.avoid.join(", ") || "framed, original painting, digital download"}`,
    `- Title formulas (listings of one place take different ones): ${plan.titles.join(" || ") || "{city} Travel Poster, {landmark} Print, {country} Wall Art"}`,
    plan.notes ? `- Why: ${plan.notes}` : "",
    "",
    words?.tags.length ? `What other shops' listings for ${words.name} use as tags, strongest first: ${words.tags.slice(0, 30).map((t) => t.keyword).join(", ")}` : "",
    words?.titles.length ? `Their best selling titles:\n${words.titles.slice(0, 6).map((t) => `- ${t.title}`).join("\n")}` : "",
    "",
    siblings.length ? "Our other listings of this place (they stay as they are; make the ones below differ from them):" : "",
    ...siblings.map(line),
    "",
    "Work on these listings (id | title | tags | what it shows | look | numbers | how much to change):",
    ...group.map((s) => `${line(s)} | ${BAND_WORDS[s.band]}`),
    "",
    'For each: "why" first (one short sentence without "I": what changes and why, or why it stays), then "change" (keep: good as it is; light: at most 4 tags swapped and the title\'s main search kept; rewrite), then the full "title" and all 13 "tags" as they should be. Where two of our listings show the same place, give them clearly different titles and at least 6 different tags. English.',
  ]
    .filter((l) => l !== "")
    .join("\n")
}

/** Words of a title, for comparing two. */
const wordsOf = (title: string) => new Set(title.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter((w) => w.length > 1))

/**
 * Holds a light change to what it promised: the main search of the title
 * kept, at most `swaps` tags swapped (tags on the avoid list always go).
 */
function limited(before: { title: string; tags: string[] }, title: string, tags: string[], swaps: number, avoid: string[]) {
  const bad = (t: string) => avoid.some((a) => t.includes(a))
  const lead = titleParts(before.title)[0] ?? before.title
  const keepsLead = [...wordsOf(lead)].every((w) => wordsOf(title).has(w))
  const outTitle = keepsLead ? title : before.title
  const removed = before.tags.filter((t) => !tags.includes(t))
  const mustGo = removed.filter(bad)
  const mayGo = removed.filter((t) => !bad(t)).slice(0, Math.max(0, swaps - mustGo.length))
  const gone = new Set([...mustGo, ...mayGo])
  const kept = before.tags.filter((t) => !gone.has(t))
  const added = tags.filter((t) => !before.tags.includes(t))
  return { title: outTitle, tags: [...kept, ...added].slice(0, 13) }
}

/** Etsy's title rules (140 characters, no odd symbols, %, : and & once each) and ours: never a dash, parts apart by commas. */
export function cleanTitle(title: string) {
  let t = title
    .replace(/[\u0000-\u001f$^`{}<>|~]/g, "")
    .replace(new RegExp(`\\s+[${DASH}]+\\s+`, "g"), ", ")
    .replace(new RegExp(`[${DASH}]`, "g"), " ")
    .replace(/\s*,\s*(,\s*)*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
  for (const mark of ["%", ":", "&"]) {
    let seen = false
    t = t.replace(new RegExp(mark === "%" ? "%" : mark, "g"), (m) => (seen ? (mark === "&" ? "and" : "") : ((seen = true), m)))
  }
  if (t.length > 140) {
    const parts = titleParts(t)
    let out = ""
    for (const part of parts) {
      const next = out ? `${out}, ${part}` : part
      if (next.length > 140) break
      out = next
    }
    t = out || t.slice(0, 140).trim()
  }
  return t
}

/** 13 tags Etsy takes: cleaned, short enough, no repeats; topped up from the strategy when some fall out. */
export function cleanTags(tags: string[], fallback: string[]) {
  const out: string[] = []
  for (const raw of [...tags, ...fallback]) {
    const tag = cleanTag(raw)
    if (!tagOk(tag) || out.includes(tag)) continue
    out.push(tag)
    if (out.length === 13) break
  }
  return out
}

async function propose(group: Subject[], siblings: Subject[], plan: KeywordStrategy): Promise<SeoProposal[]> {
  const words = group[0].placeId ? await placeKeywords(group[0].placeId, 40).catch(() => null) : null
  const answer = await askJson<{ items?: { id: number; why?: string; change?: SeoChange; title?: string; tags?: string[] }[] }>(
    prompt(group, siblings, plan, words),
    [],
    { schema: SCHEMA, temperature: 0.6 }
  )
  const place = group[0].place
  const fallback = place
    ? plan.rotate
        .map((p) => fill(p, { city: place.name.toLowerCase(), region: place.region?.toLowerCase(), country: countryName(place.country).toLowerCase() }))
        .filter((x): x is string => !!x)
    : []
  return group.map((s) => {
    const item = answer.items?.find((i) => Number(i.id) === s.listing.listingId)
    let change: SeoChange = item?.change === "light" || item?.change === "rewrite" ? item.change : "keep"
    const before = { title: s.listing.title, tags: s.listing.tags }
    let title = before.title
    let tags = before.tags
    if (item && change !== "keep") {
      title = cleanTitle(item.title ?? before.title)
      tags = cleanTags(item.tags ?? [], [...before.tags.filter((t) => !plan.avoid.some((a) => t.includes(a))), ...fallback, ...plan.generic])
      // A strong listing only ever changes lightly; a light change stays light.
      if (s.band === "strong" || change === "light") {
        ;({ title, tags } = limited(before, title, tags, s.band === "strong" ? 3 : 4, plan.avoid))
        tags = cleanTags(tags, fallback)
        change = "light"
      }
      if (title === before.title && tags.join("\n") === before.tags.join("\n")) change = "keep"
    }
    return {
      listingId: s.listing.listingId,
      account: s.account,
      thumb: s.listing.images[0]?.url ?? null,
      place: s.read?.p[0]?.name ?? place?.name ?? null,
      before,
      title,
      tags,
      change,
      why: item?.why?.trim().slice(0, 300) || (item ? "" : "No proposal came back: left as it is"),
      band: s.band,
      numbers: s.numbers,
      status: "proposed",
    }
  })
}

// --- Runs ---

/** Starts an analysis of the picked listings (our city shops' only); answers the run. */
export async function startSeo(listingIds: number[]): Promise<SeoRun> {
  const { all, picked } = await subjects(listingIds)
  if (!picked.length) throw new Error("None of the picked listings is one of our city shops' live listings")
  const run: SeoRun = {
    id: newId("seo-"),
    createdAt: new Date().toISOString(),
    status: "running",
    step: `Looking at ${picked.length} listing${picked.length === 1 ? "" : "s"}`,
    done: 0,
    total: picked.length,
    proposals: [],
    runner: instanceId,
  }
  await updateDoc<SeoFile>(FILE, EMPTY, (file) => ({ runs: [run, ...file.runs].slice(0, KEEP) }))
  void work(run.id, picked, all)
  return run
}

async function work(id: string, picked: Subject[], all: Subject[]) {
  try {
    const plan = await strategy()
    // One place's picked listings together, the rest of ours for it as context.
    const byPlace = new Map<string, Subject[]>()
    for (const s of picked) {
      const key = s.placeId ?? `listing-${s.listing.listingId}`
      byPlace.set(key, [...(byPlace.get(key) ?? []), s])
    }
    const groups: { group: Subject[]; siblings: Subject[] }[] = []
    for (const [key, list] of byPlace) {
      const ids = new Set(list.map((s) => s.listing.listingId))
      const siblings = key.startsWith("listing-") ? [] : all.filter((s) => s.placeId === key && !ids.has(s.listing.listingId) && s.listing.state === "active").slice(0, 12)
      for (let at = 0; at < list.length; at += GROUP) groups.push({ group: list.slice(at, at + GROUP), siblings })
    }
    await changeRun(id, (run) => void (run.step = `Writing proposals for ${byPlace.size} place${byPlace.size === 1 ? "" : "s"}`))
    await pool(groups, 3, async ({ group, siblings }) => {
      let proposals: SeoProposal[]
      try {
        proposals = await propose(group, siblings, plan)
      } catch (error) {
        console.error("City SEO:", error)
        proposals = group.map((s) => ({
          listingId: s.listing.listingId,
          account: s.account,
          thumb: s.listing.images[0]?.url ?? null,
          place: s.place?.name ?? null,
          before: { title: s.listing.title, tags: s.listing.tags },
          title: s.listing.title,
          tags: s.listing.tags,
          change: "keep",
          why: `Gemini failed: ${(error as Error).message}`,
          band: s.band,
          numbers: s.numbers,
          status: "failed",
        }))
      }
      await changeRun(id, (run) => {
        run.proposals.push(...proposals)
        run.done += group.length
      })
    })
    await changeRun(id, (run) => {
      run.status = "done"
      delete run.step
      delete run.runner
      // Changes first, the biggest first; within, the weakest first.
      const order: Record<SeoChange, number> = { rewrite: 0, light: 1, keep: 2 }
      const bands: Record<SeoBand, number> = { weak: 0, some: 1, strong: 2 }
      run.proposals.sort((a, b) => order[a.change] - order[b.change] || bands[a.band] - bands[b.band])
    })
  } catch (error) {
    console.error("City SEO:", error)
    await changeRun(id, (run) => {
      run.status = "error"
      run.error = (error as Error).message
      delete run.runner
    })
  }
}

export type ProposalEdit = { listingId: number; title?: string; tags?: string[]; status?: "proposed" | "dropped" }

/** Changes a proposal by hand, or drops it (and takes it back). */
export async function editProposal(id: string, edit: ProposalEdit) {
  await seoRun(id)
  await changeRun(id, (run) => {
    const p = run.proposals.find((x) => x.listingId === edit.listingId)
    if (!p || p.status === "applied" || p.status === "queued") return
    if (typeof edit.title === "string") {
      p.title = cleanTitle(edit.title)
      p.edited = true
    }
    if (Array.isArray(edit.tags)) {
      p.tags = cleanTags(edit.tags.filter((t): t is string => typeof t === "string"), [])
      p.edited = true
    }
    if (p.edited && p.change === "keep" && (p.title !== p.before.title || p.tags.join() !== p.before.tags.join())) p.change = "light"
    if (edit.status) p.status = edit.status
    if (p.status === "failed" && edit.status === "proposed") delete p.error
  })
  return seoRun(id)
}

export async function deleteRun(id: string) {
  const run = await seoRun(id)
  if (run.proposals.some((p) => p.status === "queued")) throw new Error("It's applying: wait until it's done")
  await updateDoc<SeoFile>(FILE, EMPTY, (file) => ({ runs: file.runs.filter((r) => r.id !== id) }))
  return seoRuns()
}

// --- Applying on Etsy ---

const changed = (p: SeoProposal) => p.title !== p.before.title || p.tags.join("\n") !== p.before.tags.join("\n")

/** Queues the picked proposals (all that change when none are named) and applies them on this server. */
export async function applySeo(id: string, listingIds?: number[]) {
  const run = await seoRun(id)
  if (run.status === "running") throw new Error("Wait until the analysis is done")
  const wanted = listingIds?.length ? new Set(listingIds) : null
  const accounts = new Set(run.proposals.filter((p) => (!wanted || wanted.has(p.listingId)) && changed(p)).map((p) => p.account))
  const all = await listAccounts()
  for (const account of accounts) {
    const found = all.find((a) => a.id === account)
    const why = found ? await syncBlocker(found) : "Unknown account"
    if (why) throw new Error(`${found?.shop?.name ?? account}: ${why}. Connect it in Settings first.`)
  }
  await changeRun(id, (r) => {
    for (const p of r.proposals) {
      if (wanted && !wanted.has(p.listingId)) continue
      if ((p.status === "proposed" || p.status === "failed") && changed(p)) {
        p.status = "queued"
        delete p.error
      }
    }
    delete r.note
  })
  void exclusive(`citys:seo-apply:${id}`, () => applyQueued(id))
  return seoRun(id)
}

async function applyQueued(id: string) {
  for (;;) {
    const run = await seoRun(id).catch(() => null)
    const next = run?.proposals.find((p) => p.status === "queued")
    if (!run || !next) return
    const usage = await usageOf(next.account)
    if (usage?.blockedUntil || (usage && usage.remainingToday - 1 < RESERVE)) {
      await changeRun(id, (r) => void (r.note = `Etsy quota nearly used up on ${next.account}: the rest waits. Apply again later.`))
      await changeRun(id, (r) => {
        for (const p of r.proposals) if (p.status === "queued") p.status = "proposed"
      })
      return
    }
    try {
      await updateListing(next.account, next.listingId, { title: next.title, tags: next.tags })
      await patchListing(next.account, next.listingId, (l) => ({ ...l, title: next.title, tags: next.tags }))
      await changeRun(id, (r) => {
        const p = r.proposals.find((x) => x.listingId === next.listingId)
        if (!p) return
        p.status = "applied"
        p.appliedAt = new Date().toISOString()
      })
    } catch (error) {
      const message = error instanceof EtsyApiError ? `Etsy ${error.status}: ${error.message}` : (error as Error).message
      await changeRun(id, (r) => {
        const p = r.proposals.find((x) => x.listingId === next.listingId)
        if (!p) return
        p.status = "failed"
        p.error = message
      })
    }
  }
}
