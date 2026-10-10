import sharp from "sharp"

import type { Account } from "@/lib/accounts/types"
import type { Orientation, SizeKey } from "@/lib/catalog/sizes"
import { loadTemplate, mapTemplate } from "@/lib/gelato/template"
import { getSet, readSetFile } from "@/lib/generation/storage"
import { getChain, getDefaultChain } from "@/lib/mockups/chains"
import { getScene } from "@/lib/mockups/storage"
import { getProfile } from "@/lib/pricing/store"
import { getDraft } from "@/lib/uploads/store"

import { Fatal } from "./errors"
import { listingText } from "./listing-text"
import type { JobItem, UploadJob } from "./types"

// What a stage works with (the item, its job and account, ways to save as
// it goes) and what it answers, plus what several stages read: the poster,
// the listing text, the price profile.

export type StageContext = {
  /** The item as saved last; `save` and `step` keep it current. */
  item: JobItem
  /** The job as it was when the stage started. */
  job: UploadJob
  account: Account
  orientation: Orientation
  /** Saves fields at once: every id the moment it exists. */
  save(patch: Partial<JobItem>): Promise<JobItem>
  /** Records that a step happened (now), so running the stage again skips it; answers the time. */
  step(name: string): Promise<string>
  /** Forgets a step, so it happens again. */
  unstep(name: string): Promise<void>
  /** When the step happened, if it did. */
  did(name: string): string | undefined
  /** What the stage is doing right now, for the Uploads page. */
  progress(text: string): void
  /** Keeps something with the item: what a test run would send, product ids around an inventory change. */
  payload(name: string, body: unknown): Promise<void>
}

export type StageResult = {
  /** Shown with the finished stage. */
  note?: string
  /** The next stage waits this long first (the final check). */
  wait?: { ms: number; note: string }
}

export type StageRun = (ctx: StageContext) => Promise<StageResult>

async function outputOf(item: JobItem) {
  const set = await getSet(item.groupId).catch(() => null)
  const output = set?.outputs.find((o) => o.id === item.outputId)
  if (!set || !output?.file) throw new Fatal("The poster is gone from Generation")
  return { set, output, file: output.file }
}

/** The poster's image file. */
export async function posterOf(item: JobItem) {
  const { set, file } = await outputOf(item)
  return readSetFile(set.id, file).catch(() => {
    throw new Fatal("The poster's image file is gone")
  })
}

export async function orientationOf(item: JobItem): Promise<Orientation> {
  const { output } = await outputOf(item)
  let { width, height } = output
  if (!width || !height) ({ width, height } = await sharp(await posterOf(item)).metadata())
  return (width ?? 0) > (height ?? 0) ? "hor" : "ver"
}

export async function profileOf(account: Account) {
  return account.priceProfileId ? getProfile(account.priceProfileId).catch(() => null) : null
}

/** The sizes the listing offers: its Gelato template's (unknown to a test run without one). */
async function offeredSizes(ctx: StageContext) {
  const gelato = ctx.account.gelato
  const templateId = ctx.orientation === "hor" ? gelato?.templateIdLandscape : gelato?.templateId
  if (!gelato?.storeId || !templateId) return undefined
  const loading = loadTemplate(gelato.storeId, templateId)
  const template = ctx.job.dryRun ? await loading.catch(() => null) : await loading
  return template ? (Object.keys(mapTemplate(template).sizes) as SizeKey[]) : undefined
}

/** What each listing photo shows: null the poster alone, else its mockup scene's id and name ("" when unknown). */
async function shotsOf(item: JobItem): Promise<(string | null)[]> {
  const photos = Math.max(1, item.media?.photos.length ?? 1)
  if (item.chainId === null) return Array(photos).fill(null)
  // Photos rendered before their scenes were kept with them: the chain as it is now.
  const scenes = item.media?.scenes ?? (await getChain(item.chainId).catch(() => getDefaultChain()))?.scenes ?? []
  return Promise.all(
    Array.from({ length: photos }, (_, i) =>
      scenes[i] ? getScene(scenes[i]).then((s) => `${s.id} ${s.name}`, () => "") : ""
    )
  )
}

/** The listing text as it goes out now: the draft's copy (as edited since), the account's blocks. */
export async function textOf(ctx: StageContext) {
  if (!ctx.item.draftId) throw new Fatal("The poster has no draft")
  const draft = await getDraft(ctx.item.draftId).catch(() => {
    throw new Fatal("The poster's draft was deleted")
  })
  const [profile, sizes, shots] = await Promise.all([profileOf(ctx.account), offeredSizes(ctx), shotsOf(ctx.item)])
  try {
    return listingText(draft, ctx.account, profile, ctx.orientation, shots, sizes)
  } catch (error) {
    throw new Fatal((error as Error).message)
  }
}
