import { listAccounts } from "@/lib/accounts/store"
import type { Account } from "@/lib/accounts/types"
import { OFFERED, sizeOfUid, type Orientation, type SizeKey } from "@/lib/catalog/sizes"
import { RESERVE } from "@/lib/etsy/client"
import {
  deleteImage,
  getInventory,
  listingImages,
  ownListing,
  updateInventory,
  updateListing,
  uploadImage,
  uploadVideo,
  type ApiOwnListing,
  type ListingUpdate,
} from "@/lib/etsy/shop"
import { usageOf } from "@/lib/etsy/usage"
import {
  createFromTemplate,
  GelatoError,
  getProduct,
  keyForStore,
  listProducts,
  productVariants,
  publishProduct,
} from "@/lib/gelato/client"
import { loadTemplate, mapTemplate } from "@/lib/gelato/template"
import { updateDraft } from "@/lib/uploads/store"

import { accountMissing, etsyBlocker } from "./blockers"
import { profileOf, textOf, type StageContext, type StageResult } from "./context"
import { Fatal, Parked } from "./errors"
import { readFileUnder } from "./files"
import {
  gelatoBody,
  listingUpdate,
  priceDrift,
  pricedInventory,
  productIds,
  readinessDrift,
  sizeOfProduct,
} from "./requests"
import { readPayloads, readPipeline } from "./store"

// The stages that reach out, for live runs: Gelato makes the product and
// puts it on Etsy; the Etsy listing is hidden and put right (our text,
// defaults, prices, photos, video); the print route is proven on the live
// objects before anything is activated; a final check later puts back what
// Gelato wrote over. Every id is saved the moment it exists and every step
// is recorded, so a stage run again (after a crash, a retry) picks up where
// it stopped and never makes a second product, listing or photo.

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** Etsy requests a stage spends at most; its account's quota must hold them (plus RESERVE) first. */
const CALLS = { listing: 30, verify: 2, live: 2, postcheck: 10 }
/**
 * Gelato publishes no limits; this many new products an hour per store keeps
 * clear of any (a 429 parks the create for ten minutes). Any number of
 * products can come from one template at once; a store's creates go one at
 * a time, each holding the store only for its request.
 */
const GELATO_PER_HOUR = 60
/**
 * At most this many of a store's products on their way to Etsy at once, so a
 * store's pace follows how fast Gelato publishes. Gelato took about ten
 * minutes a product whether one of a store's or seven were on their way (74
 * posters, 10 Oct), so six held a store to one every hundred seconds or so.
 */
const GELATO_IN_FLIGHT = 24
/** A create that got no answer: looked for this long before it's taken as never made. */
const RECOVER_AFTER = 10 * MINUTE
/** Gelato usually has the listing on Etsy within minutes; one still unpublished gets a nudge. */
const NUDGE_AFTER = 10 * MINUTE
const PUBLISH_TIMEOUT = 45 * MINUTE
/** A product Gelato is still putting on Etsy is looked at this often: one Gelato request, no Etsy quota. */
const PUBLISH_POLL = 15 * 1000
/**
 * Gelato links a new listing's products to its variants within minutes;
 * should our re-pricing give products new ids (unverified), Gelato may only
 * link them on a later sync. Past this the route is broken.
 */
const VERIFY_TIMEOUT = 3 * HOUR
/** When Gelato is done syncing its own text and photos onto a new listing. */
const POSTCHECK_AFTER = 90 * MINUTE
/** Waits on a setting someone has to fix. */
const SETUP_WAIT = 5 * MINUTE

// --- Readiness ---

/** Parks the item while Etsy can't be called on `account` or its quota can't hold `calls`. */
async function etsyReady(account: Account, calls: number) {
  const blocker = await etsyBlocker(account)
  if (blocker) throw new Parked(SETUP_WAIT, blocker)
  const usage = await usageOf(account.id)
  if (!usage) return
  if (usage.blockedUntil) {
    throw new Parked(Math.max(MINUTE, Date.parse(usage.blockedUntil) - Date.now()), "Etsy's daily quota is used up")
  }
  if (usage.remainingToday - RESERVE < calls) {
    throw new Parked(15 * MINUTE, `Waiting for Etsy quota (${usage.remainingToday} left, ${RESERVE} kept spare)`)
  }
}

async function gelatoOf(account: Account) {
  const storeId = account.gelato?.storeId
  if (!storeId) throw new Parked(SETUP_WAIT, `${account.label} has no Gelato store`)
  try {
    return { storeId, key: await keyForStore(storeId) }
  } catch (error) {
    if (error instanceof GelatoError && error.status === 404) throw new Parked(SETUP_WAIT, error.message)
    throw error
  }
}

async function templateOf(account: Account, orientation: Orientation) {
  const templateId = orientation === "hor" ? account.gelato?.templateIdLandscape : account.gelato?.templateId
  if (!account.gelato?.storeId || !templateId) {
    throw new Parked(SETUP_WAIT, `${account.label} has no Gelato ${orientation === "hor" ? "landscape " : ""}template`)
  }
  const check = mapTemplate(await loadTemplate(account.gelato.storeId, templateId))
  if (!check.ok) throw new Fatal(`The Gelato template "${check.name}" can't be used: ${check.problems.join("; ")}`)
  if (check.orientation !== orientation) {
    throw new Fatal(`The Gelato template "${check.name}" isn't ${orientation === "hor" ? "landscape" : "portrait"} like the poster`)
  }
  return { templateId, check }
}

/**
 * Holds the create back while the account isn't set up, has had its daily
 * target in the last 24 hours, its Gelato store its hourly share, or its
 * Etsy key too little quota left to put the listing right afterwards.
 */
async function pace(ctx: StageContext, storeId: string) {
  const { account } = ctx
  const missing = await accountMissing(account, { landscape: ctx.orientation === "hor" })
  if (missing.length) throw new Parked(SETUP_WAIT, `${account.label} lacks ${missing.join(", ")}`)

  const now = Date.now()
  const { jobs, items } = await readPipeline()
  const real = new Set(jobs.filter((j) => !j.dryRun).map((j) => j.id))
  const sent = items.filter((i) => i.id !== ctx.item.id && real.has(i.jobId) && i.steps?.gelatoSent)
  const times = (list: typeof sent, window: number) =>
    list.map((i) => Date.parse(i.steps!.gelatoSent)).filter((t) => t > now - window).sort((a, b) => a - b)

  const today = times(sent.filter((i) => i.account === account.id), DAY)
  if (today.length >= account.dailyTarget) {
    throw new Parked(today[today.length - account.dailyTarget] + DAY - now, `${account.label} has had its ${account.dailyTarget} for today`)
  }
  const sameStore = new Set((await listAccounts()).filter((a) => a.gelato?.storeId === storeId).map((a) => a.id))
  // What Gelato is still putting on Etsy: the store's pace follows how fast it gets there.
  const pending = sent.filter((i) => sameStore.has(i.account) && !i.etsyListingId && i.status !== "failed").length
  if (pending >= GELATO_IN_FLIGHT) throw new Parked(MINUTE, `${pending} posters with Gelato already, on their way to Etsy`)
  const hour = times(sent.filter((i) => sameStore.has(i.account)), HOUR)
  if (hour.length >= GELATO_PER_HOUR) {
    throw new Parked(hour[hour.length - GELATO_PER_HOUR] + HOUR - now, `${GELATO_PER_HOUR} new Gelato products an hour per store`)
  }
  await etsyReady(account, CALLS.listing + CALLS.verify + CALLS.live)
}

// --- Gelato ---

/**
 * Gelato makes the product from the account's template; it puts the listing
 * on Etsy and the listing id comes back. Only the create holds the store
 * (see worker.ts): a product made, the item waits a moment and its next run
 * watches Gelato publish it, holding nothing.
 */
export async function gelato(ctx: StageContext): Promise<StageResult> {
  const { storeId, key } = await gelatoOf(ctx.account)
  if (ctx.item.gelatoProductId) return published(ctx, key, storeId)

  if (ctx.did("gelatoSent")) {
    // Sent before without an answer (a crash, a timeout): Gelato may have made it anyway.
    const since = Date.parse(ctx.did("gelatoSent")!) - 2 * MINUTE
    const made = (await listProducts(key, storeId, 0, 50)).find(
      (p) => p.title === ctx.item.title && Date.parse(p.createdAt) >= since
    )
    if (made) {
      await ctx.save({ gelatoProductId: made.id })
      throw new Parked(PUBLISH_POLL, "Gelato is putting it on Etsy")
    }
    if (Date.now() - Date.parse(ctx.did("gelatoSent")!) < RECOVER_AFTER) {
      throw new Parked(2 * MINUTE, "Checking whether Gelato made the product")
    }
    await ctx.unstep("gelatoSent")
  }

  const files = ctx.item.printFiles ?? []
  if (!files.length || files.some((f) => !f.url)) throw new Fatal("The print files aren't online: run the print stage again")
  const { templateId, check } = await templateOf(ctx.account, ctx.orientation)
  await pace(ctx, storeId)
  const body = gelatoBody(templateId, check.sizes, await textOf(ctx), files, (f) => f.url!)
  if (body.variants.length !== OFFERED.length) {
    throw new Fatal(`Only ${body.variants.length} of the ${OFFERED.length} sizes have a print file`)
  }
  // The title finds the product again should the answer get lost.
  await ctx.save({ title: body.title })
  await ctx.step("gelatoSent")
  try {
    const product = await createFromTemplate(key, storeId, body)
    await ctx.save({ gelatoProductId: product.id })
  } catch (error) {
    // Refused outright: nothing was made, so it may be sent again.
    if (error instanceof GelatoError && error.status >= 400 && error.status < 500) {
      await ctx.unstep("gelatoSent")
      if (error.status === 429) throw new Parked(10 * MINUTE, "Gelato asks to slow down")
      throw new Fatal(error.message)
    }
    throw error
  }
  throw new Parked(PUBLISH_POLL, "Gelato is putting it on Etsy")
}

/**
 * Looks at the product every PUBLISH_POLL until Gelato has it on Etsy, in
 * one run: a run parked between looks would write the pipeline document
 * twice a look, and a store has dozens of products on their way at once.
 */
async function published(ctx: StageContext, key: string, storeId: string): Promise<StageResult> {
  for (;;) {
    const product = await getProduct(key, storeId, ctx.item.gelatoProductId!)
    const listingId = Number(product.externalId)
    if (product.externalId && Number.isSafeInteger(listingId) && listingId > 0) {
      await ctx.save({ etsyListingId: listingId })
      return { note: `Etsy listing ${listingId}` }
    }
    // Gelato reports an error now and then (GENERAL_ERROR, often right after a
    // second publish while its first is still under way) and puts the product
    // on Etsy minutes later anyway: only the timeout gives up.
    const error = product.publishingErrorCode
    const since = ctx.did("publishSince") ?? (await ctx.step("publishSince"))
    const waited = Date.now() - Date.parse(since)
    if (waited > PUBLISH_TIMEOUT) {
      throw new Fatal(
        error
          ? `Gelato couldn't put it on Etsy (${error}) in ${PUBLISH_TIMEOUT / MINUTE} minutes`
          : `Gelato hasn't put it on Etsy in ${PUBLISH_TIMEOUT / MINUTE} minutes (product ${product.status})`
      )
    }
    // A nudge only for a product Gelato never began to publish.
    const publishing = product.status?.startsWith("publishing")
    if (waited > NUDGE_AFTER && !publishing && !product.publishedAt && !ctx.did("gelatoPublish")) {
      await ctx.step("gelatoPublish")
      await publishProduct(key, storeId, product.id)
    }
    ctx.progress(error ? `Gelato reports ${error}; waiting whether it gets there anyway` : "Gelato is putting it on Etsy")
    await new Promise((resolve) => setTimeout(resolve, PUBLISH_POLL))
  }
}

// --- Etsy listing ---

/** The listing hidden and put right: text and defaults, prices, photos, video. */
export async function listing(ctx: StageContext): Promise<StageResult> {
  const { account } = ctx
  const listingId = ctx.item.etsyListingId!
  await etsyReady(account, CALLS.listing)

  const current = await ownListing(account.id, listingId, ["Images"])
  if (current.state === "active" && !ctx.did("hidden")) {
    await updateListing(account.id, listingId, { state: "inactive" })
    await ctx.step("hidden")
  }
  const text = await textOf(ctx)
  if (!ctx.did("text")) {
    await updateListing(account.id, listingId, listingUpdate(account, text))
    await ctx.step("text")
  }
  if (!ctx.did("inventory")) {
    const profile = await profileOf(account)
    if (!profile) throw new Parked(SETUP_WAIT, `${account.label} has no price profile`)
    const before = await getInventory(account.id, listingId)
    const readiness = account.listing.readinessStateId
    // Etsy may give re-priced products new ids (unverified: the before and
    // after kept below tell), which Gelato would have to link again before
    // verify lets it go live: only sent when prices or processing really differ.
    const after =
      priceDrift(before, profile).length || readinessDrift(before, readiness)
        ? await updateInventory(account.id, listingId, pricedInventory(before, profile, readiness))
        : before
    await ctx.payload("inventory", { before: productIds(before), after: productIds(after) })
    await ctx.step("inventory")
  }

  const photos = ctx.item.media?.photos ?? []
  const saved = ctx.item.imageIds ?? []
  let ids = saved
  // The ids saved once, after the last photo or the one that failed: each
  // save writes the whole pipeline document, about as much as a photo.
  try {
    for (let i = ids.length; i < photos.length; i++) {
      ctx.progress(`Photo ${i + 1} of ${photos.length}`)
      // Overwriting rank i + 1 replaces Gelato's photo there, or one of ours a crash left without its id.
      const image = await uploadImage(account.id, listingId, await readFileUnder(photos[i]), {
        rank: i + 1,
        overwrite: true,
        altText: text.alt[i],
        name: `${i + 1}.jpg`,
      })
      if (!image.listing_image_id) throw new Error("Etsy didn't say which photo it made")
      ids = [...ids, image.listing_image_id]
    }
  } finally {
    if (ids !== saved) await ctx.save({ imageIds: ids })
  }
  if (!ctx.did("photos")) {
    const { results } = await listingImages(account.id, listingId)
    for (const image of results) {
      if (image.listing_image_id && !ids.includes(image.listing_image_id)) {
        await deleteImage(account.id, listingId, image.listing_image_id)
      }
    }
    await ctx.step("photos")
  }

  const video = ctx.item.media?.video
  if (video && !ctx.item.videoId) {
    ctx.progress("Video")
    // A listing has one video: sending it again replaces the first.
    const made = await uploadVideo(account.id, listingId, await readFileUnder(video))
    await ctx.save({ videoId: made.video_id })
  }
  const plural = photos.length === 1 ? "photo" : "photos"
  return { note: `Text, prices, ${photos.length} ${plural}${video ? " and video" : ""}` }
}

// --- Print route ---

/**
 * What stands between the listing and a print: every Etsy product must have
 * a Gelato variant with a product and a design of the same size, the
 * poster's way round, and all offered sizes must be there.
 */
async function printProblems(ctx: StageContext) {
  const { storeId, key } = await gelatoOf(ctx.account)
  const inventory = await getInventory(ctx.account.id, ctx.item.etsyListingId!)
  const variants = await productVariants(key, storeId, ctx.item.gelatoProductId!)
  const byProduct = new Map(variants.map((v) => [String(v.externalVariantId ?? ""), v]))
  const problems: string[] = []
  const seen = new Set<SizeKey>()
  for (const product of inventory.products) {
    if (product.is_deleted) continue
    const size = sizeOfProduct(product)
    if (!size) {
      problems.push(`Etsy product ${product.product_id} has no size we know`)
      continue
    }
    seen.add(size.key)
    const variant = byProduct.get(String(product.product_id))
    const printed = sizeOfUid(variant?.productUid)
    if (!variant) problems.push(`${size.cm}: no Gelato variant for it`)
    else if (!variant.productUid || !variant.designId) problems.push(`${size.cm}: Gelato has no ${variant.productUid ? "design" : "product"} for it`)
    else if (printed?.key !== size.key) problems.push(`${size.cm}: Gelato prints ${printed?.cm ?? variant.productUid}`)
    else if (!variant.productUid.endsWith(`_${ctx.orientation}`)) {
      problems.push(`${size.cm}: Gelato prints it ${ctx.orientation === "hor" ? "portrait" : "landscape"}`)
    }
  }
  const lacking = OFFERED.filter((s) => !seen.has(s.key))
  if (lacking.length) problems.push(`The listing lacks ${lacking.map((s) => s.cm).join(", ")}`)
  return { problems, sizes: seen.size }
}

/** Printable proven on the live objects; a broken route never gets activated. */
export async function verify(ctx: StageContext): Promise<StageResult> {
  await etsyReady(ctx.account, CALLS.verify)
  const { problems, sizes } = await printProblems(ctx)
  if (!problems.length) return { note: `${sizes} sizes, each with its Gelato print` }
  const since = ctx.did("verifySince") ?? (await ctx.step("verifySince"))
  const waited = Date.now() - Date.parse(since)
  if (waited < VERIFY_TIMEOUT) {
    throw new Parked(waited < 30 * MINUTE ? 5 * MINUTE : 15 * MINUTE, `Print route not there yet: ${problems[0]}`)
  }
  const hint = (await repriced(ctx))
    ? " (Etsy gave the re-priced sizes new ids: with the price profile's prices in the Gelato template nothing needs re-pricing)"
    : ""
  throw new Fatal(`Not printable as listed, so not activated: ${problems.slice(0, 3).join("; ")}${hint}`)
}

/** Whether our prices gave the listing's products new ids (the inventory before and after, as kept). */
async function repriced(ctx: StageContext) {
  const ids = (await readPayloads(ctx.item.id)).inventory as { before?: number[]; after?: number[] } | undefined
  const { before = [], after = [] } = ids ?? {}
  return before.some((id) => !after.includes(id))
}

// --- Live ---

export async function live(ctx: StageContext): Promise<StageResult> {
  await etsyReady(ctx.account, CALLS.live)
  const cancelled = ctx.job.status === "cancelled"
  const activate = ctx.job.activate && !cancelled
  const imageIds = ctx.item.imageIds ?? []
  const update: ListingUpdate = {
    ...(imageIds.length > 0 && { image_ids: imageIds }),
    ...(activate && { state: "active" as const }),
  }
  if (Object.keys(update).length) await updateListing(ctx.account.id, ctx.item.etsyListingId!, update)
  await ctx.step("liveAt")
  if (ctx.item.draftId) {
    await updateDraft(ctx.item.draftId, { status: "uploaded" }).catch((error) =>
      console.warn(`Upload pipeline: couldn't mark draft ${ctx.item.draftId} uploaded:`, error)
    )
  }
  return {
    note: activate ? "Active" : cancelled ? "Job cancelled: left inactive" : "Left inactive for a look",
    wait: { ms: POSTCHECK_AFTER, note: "Final check after Gelato's own syncing" },
  }
}

// --- Final check ---

const decode = (text: string) =>
  text.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
const plain = (text: string) => decode(text).replace(/\s+/g, " ").trim()
const tagSet = (tags: string[]) => tags.map((t) => plain(t).toLowerCase()).sort().join(",")

function textDrift(listing: ApiOwnListing, want: ListingUpdate) {
  return (
    plain(listing.title) !== plain(want.title ?? "") ||
    plain(listing.description) !== plain(want.description ?? "") ||
    tagSet(listing.tags) !== tagSet(want.tags ?? [])
  )
}

/**
 * Puts back what Gelato wrote over after publishing: text, shipping profile
 * (Gelato sets its own a minute after going live), prices, photos. The
 * listing's state is left as it is.
 */
export async function postcheck(ctx: StageContext): Promise<StageResult> {
  const { account } = ctx
  const listingId = ctx.item.etsyListingId!
  await etsyReady(account, CALLS.postcheck)
  const fixed: string[] = []

  const current = await ownListing(account.id, listingId, ["Images"])
  const want = listingUpdate(account, await textOf(ctx))
  if (textDrift(current, want)) {
    await updateListing(account.id, listingId, { title: want.title, description: want.description, tags: want.tags })
    fixed.push("text")
  }
  if (want.shipping_profile_id && current.shipping_profile_id !== want.shipping_profile_id) {
    await updateListing(account.id, listingId, { shipping_profile_id: want.shipping_profile_id })
    fixed.push("shipping profile")
  }

  const inventory = await getInventory(account.id, listingId)
  const ids = productIds(inventory)
  const recorded = ((await readPayloads(ctx.item.id)).inventory as { after?: number[] } | undefined)?.after
  let reprove = !!recorded && (recorded.length !== ids.length || recorded.some((id) => !ids.includes(id)))
  const profile = await profileOf(account)
  if (profile && priceDrift(inventory, profile).length) {
    const after = await updateInventory(account.id, listingId, pricedInventory(inventory, profile, account.listing.readinessStateId))
    await ctx.payload("inventory", { before: ids, after: productIds(after) })
    fixed.push("prices")
    reprove = true
  }
  if (reprove || ctx.did("reproveSince")) {
    const { problems } = await printProblems(ctx)
    if (problems.length) {
      // Gelato links changed products in its own time: the listing stays as it is while it may.
      const since = ctx.did("reproveSince") ?? (await ctx.step("reproveSince"))
      if (Date.now() - Date.parse(since) < VERIFY_TIMEOUT) throw new Parked(15 * MINUTE, `Print route not back yet: ${problems[0]}`)
      if (current.state === "active") await updateListing(account.id, listingId, { state: "inactive" })
      throw new Fatal(`Not printable as listed after Gelato's changes, so it was set inactive: ${problems.slice(0, 3).join("; ")}`)
    }
  }

  const ours = ctx.item.imageIds ?? []
  const images = [...(current.images ?? [])].sort((a, b) => a.rank - b.rank)
  const foreign = images.filter((i) => i.listing_image_id && !ours.includes(i.listing_image_id))
  for (const image of foreign) await deleteImage(account.id, listingId, image.listing_image_id!)
  if (foreign.length) fixed.push(`${foreign.length} photo${foreign.length === 1 ? "" : "s"} Gelato added`)
  const order = images.map((i) => i.listing_image_id).filter((id): id is number => !!id && ours.includes(id))
  if (order.length === ours.length && order.some((id, i) => id !== ours[i])) {
    await updateListing(account.id, listingId, { image_ids: ours })
    fixed.push("photo order")
  }
  return { note: fixed.length ? `Put back: ${fixed.join(", ")}` : "Nothing changed since" }
}
