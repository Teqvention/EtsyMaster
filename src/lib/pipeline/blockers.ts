import { getKey, getTokens, isLive, missingForUpload } from "@/lib/accounts/store"
import type { Account } from "@/lib/accounts/types"
import { storageStatus } from "@/lib/storage"

// What stands between the pipeline and a live upload: print file hosting
// for every job, and per upload account its Etsy grant, shop, Gelato store
// and templates, and price profile. A live job can't start while its
// accounts lack any of it; an item that meets one later (a grant run out)
// waits until it's fixed. Dry runs ignore all of it and only note what a
// live run would miss.

export async function storageBlocker() {
  const status = await storageStatus()
  return status.configured ? null : `Print file hosting isn't set up (${status.missing.join(", ")} missing)`
}

/** What `account` lacks for a live upload, in words; empty when it has it all. */
export async function accountMissing(account: Account, { landscape = false } = {}) {
  const [key, tokens] = await Promise.all([getKey(account.id), getTokens(account.id)])
  const missing = missingForUpload(account, !!key, isLive(tokens))
  if (landscape && !account.gelato?.templateIdLandscape) missing.push("Gelato landscape template")
  return missing
}

/** Why Etsy calls on `account` can't go out right now, or null. */
export async function etsyBlocker(account: Account) {
  if (!account.shop) return `${account.label} isn't linked to an Etsy shop`
  const tokens = await getTokens(account.id)
  if (!isLive(tokens)) return `${account.label}'s Etsy connection ${tokens?.error ? "was refused" : "has run out"}: connect it again in Settings`
  return null
}

/**
 * What stops every live upload, in words. Only what all accounts share: one
 * account not being set up only takes that account out of live uploads (the
 * Upload dialog reads that off the account itself).
 */
export async function pipelineBlockers() {
  const storage = await storageBlocker()
  return storage ? [storage] : []
}
