import { loadTemplate, mapTemplate } from "@/lib/gelato/template"
import { publicUrl, storageStatus, uploadPublic } from "@/lib/storage"
import { createDrafts, getDraft, rewriteDraft } from "@/lib/uploads/store"

import { accountMissing, storageBlocker } from "./blockers"
import { posterOf, profileOf, textOf, type StageContext, type StageResult, type StageRun } from "./context"
import { Fatal, Parked } from "./errors"
import { hasFileUnder, itemDir, publishFileUnder, readFileUnder } from "./files"
import { makePrintFiles } from "./print"
import { gelato, listing, live, postcheck, verify } from "./remote"
import { renderChainMedia, renderPosterOnly } from "./render"
import { gelatoBody, listingUpdate, placeholderSizes, pricePreview, printKey } from "./requests"
import { findDraftId } from "./store"
import type { PrintFile, Stage } from "./types"

// The stages every run makes for real (copy, print files, mockups), and the
// test run's stand-ins for the ones that reach out: they write down what
// would be sent (the item's payloads, see store.ts) and send nothing.

const MINUTE = 60 * 1000

const exist = async (files: string[]) => (await Promise.all(files.map(hasFileUnder))).every(Boolean)

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** The poster's draft (made now if it has none) with its copy written. */
async function copy(ctx: StageContext): Promise<StageResult> {
  let draftId = ctx.item.draftId
  if (!draftId || !(await getDraft(draftId).catch(() => null))) {
    draftId = await findDraftId(ctx.item.groupId, ctx.item.outputId)
    if (!draftId) {
      const [made] = await createDrafts({ generationId: ctx.item.groupId, outputId: ctx.item.outputId })
      draftId = made?.id ?? (await findDraftId(ctx.item.groupId, ctx.item.outputId))
    }
    if (!draftId) throw new Error("Couldn't make a draft for the poster")
    await ctx.save({ draftId })
  }
  const draft = await getDraft(draftId)
  // No wake time: the worker looks again once the copywriter is through with it.
  if (draft.copy === "queued" || draft.copy === "writing") throw new Parked(0, "Copy being written")
  if (!draft.title?.trim() || !draft.tags?.length || !draft.description?.trim()) {
    if (draft.copy === "error" && !ctx.did("copyRewrite")) {
      await rewriteDraft(draftId)
      await ctx.step("copyRewrite")
      throw new Parked(0, "Copy being written again")
    }
    throw new Fatal(draft.error ? `The copywriter failed: ${draft.error}` : "The draft has no complete copy")
  }
  await ctx.save({ title: draft.title })
  return { note: `Title, ${count(draft.tags.length, "tag")} and story` }
}

/** One print file per size; online where Gelato fetches them (live runs). */
async function print(ctx: StageContext): Promise<StageResult> {
  let files = ctx.item.printFiles
  // Files from before one per size (an aspect band's) are made again.
  const perSize = files?.length && files.every((f) => f.sizes.length === 1 && f.bandId === f.sizes[0])
  if (!files?.length || !perSize || !(await exist(files.map((f) => f.file)))) {
    ctx.progress("Making print files")
    files = await makePrintFiles(await posterOf(ctx.item), ctx.orientation, `${itemDir(ctx.item.id)}/print`)
    await ctx.save({ printFiles: files })
  }
  if (!ctx.job.dryRun) {
    const blocker = await storageBlocker()
    if (blocker) throw new Parked(5 * MINUTE, blocker)
    // Copied inside the bucket, all at once: the files went up once already.
    ctx.progress("Putting the print files online")
    const missing = files.filter((f) => !f.url)
    const urls = await Promise.all(
      missing.map((file) =>
        publishFileUnder(file.file, printKey(ctx.item.id, file)).catch(async (error) => {
          console.warn(`Upload pipeline: copying ${file.file} failed, uploading it instead:`, error)
          return uploadPublic(printKey(ctx.item.id, file), await readFileUnder(file.file), "image/jpeg")
        })
      )
    )
    if (missing.length) {
      files = files.map((f) => {
        const i = missing.indexOf(f)
        return i < 0 ? f : { ...f, url: urls[i] }
      })
      await ctx.save({ printFiles: files })
    }
  }
  const fits = (["exact", "crop", "extend"] as const)
    .map((fit) => [fit, files.filter((f) => f.fit === fit).length] as const)
    .filter(([, n]) => n > 0)
    .map(([fit, n]) => `${n} ${fit === "exact" ? "exact" : fit === "crop" ? "cropped" : "extended"}`)
  return { note: `${count(files.length, "file")}: ${fits.join(", ")}` }
}

/** The listing photos and video from the item's mockup chain, or the poster alone. */
async function media(ctx: StageContext): Promise<StageResult> {
  let made = ctx.item.media
  if (!made || !(await exist([...made.photos, ...(made.video ? [made.video] : [])]))) {
    const poster = await posterOf(ctx.item)
    const dir = `${itemDir(ctx.item.id)}/media`
    if (ctx.item.chainId === null) made = await renderPosterOnly(poster, dir)
    else {
      ctx.progress("Starting the renderer")
      made = await renderChainMedia(ctx.item.chainId, poster, dir, ctx.progress)
    }
    await ctx.save({ media: made })
  }
  if (ctx.item.chainId === null) return { note: "Poster only" }
  return { note: `${count(made.photos.length, "photo")}${made.video ? " and a video" : ""}` }
}

// --- Test runs ---

/** What a live run would still need, in words. */
async function liveMissing(ctx: StageContext) {
  const storage = await storageBlocker()
  const missing = await accountMissing(ctx.account, { landscape: ctx.orientation === "hor" })
  return [...(storage ? [storage] : []), ...missing.map((m) => `${ctx.account.label}: ${m}`)]
}

async function dryGelato(ctx: StageContext): Promise<StageResult> {
  const text = await textOf(ctx)
  const gelatoSettings = ctx.account.gelato
  const templateId = ctx.orientation === "hor" ? gelatoSettings?.templateIdLandscape : gelatoSettings?.templateId
  let sizes = placeholderSizes(ctx.orientation)
  if (gelatoSettings?.storeId && templateId) {
    // Read only (and cached): the template's own variant ids make the request exact.
    const template = await loadTemplate(gelatoSettings.storeId, templateId).catch(() => null)
    if (template) sizes = mapTemplate(template).sizes
  }
  const hosted = (await storageStatus()).configured
  const url = (file: PrintFile) => (hosted ? publicUrl(printKey(ctx.item.id, file)) : `<print file hosting>/${printKey(ctx.item.id, file)}`)
  const request = gelatoBody(templateId ?? "<Gelato template>", sizes, text, ctx.item.printFiles ?? [], url)
  await ctx.payload("gelato", { storeId: gelatoSettings?.storeId ?? "<Gelato store>", request })
  const missing = await liveMissing(ctx)
  if (missing.length) await ctx.payload("missing", missing)
  return { note: "Test run: product request written down, not sent" }
}

async function dryListing(ctx: StageContext): Promise<StageResult> {
  const text = await textOf(ctx)
  const photos = ctx.item.media?.photos ?? []
  const video = ctx.item.media?.video ?? null
  const folder = `${itemDir(ctx.item.id)}/`
  await ctx.payload("listing", { hide: { state: "inactive" }, update: listingUpdate(ctx.account, text) })
  await ctx.payload("inventory", pricePreview(await profileOf(ctx.account)))
  await ctx.payload(
    "photos",
    photos.map((file, i) => ({ rank: i + 1, file: file.replace(folder, ""), alt_text: text.alt[i] }))
  )
  if (video) await ctx.payload("video", { file: video.replace(folder, "") })
  return { note: "Test run: fields, prices and photos written down, not sent" }
}

async function dryLive(ctx: StageContext): Promise<StageResult> {
  await ctx.payload("live", {
    state: ctx.job.activate ? "active" : "inactive",
    image_ids: "<the photos above, in this order>",
  })
  return { note: "Test run: nothing went to Etsy" }
}

const skipped: StageRun = async () => ({ note: "Skipped in a test run" })

const LIVE: Record<Stage, StageRun> = { copy, print, media, gelato, listing, verify, live, postcheck }
const DRY: Record<Stage, StageRun> = {
  copy,
  print,
  media,
  gelato: dryGelato,
  listing: dryListing,
  verify: skipped,
  live: dryLive,
  postcheck: skipped,
}

export const runStage = (ctx: StageContext) => (ctx.job.dryRun ? DRY : LIVE)[ctx.item.stage](ctx)
