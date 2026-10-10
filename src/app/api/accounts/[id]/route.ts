import { verifyKey } from "@/lib/accounts/connect"
import {
  accountView,
  applyPatch,
  getAccount,
  getKey,
  patchAccount,
  removeAccount,
  setKey,
  setTokens,
} from "@/lib/accounts/store"
import { checkAccountTemplates } from "@/lib/accounts/templates"
import { WHEN_MADE, type AccountPatch } from "@/lib/accounts/types"
import { respond } from "@/lib/mockups/respond"

// Change an account (JSON AccountPatch; `keystring` + `secret` replace its
// key, `disconnect: true` forgets its Etsy grant). Answers with the account.
// A new key is checked with Etsy before it's saved; a new Gelato template is
// checked with Gelato right away, so the answer says whether it fits.
export async function PATCH(request: Request, { params }: RouteContext<"/api/accounts/[id]">) {
  const { id } = await params
  const body = (await request.json().catch(() => null)) as (AccountPatch & Record<string, unknown>) | null
  if (!body || typeof body !== "object") return Response.json({ error: "Nothing to change" }, { status: 400 })
  return respond(async () => {
    const before = await getAccount(id)
    const patch = parsePatch(body)
    if (typeof body.keystring === "string" && typeof body.secret === "string") {
      const keystring = body.keystring.trim()
      const secret = body.secret.trim()
      if (!keystring || !secret) throw new Error("Both keystring and shared secret are needed")
      patch.appId = await verifyKey(id, keystring, secret)
      // A grant belongs to the app that asked for it: another app's key can't renew it.
      if ((await getKey(id))?.keystring !== keystring) await setTokens(id, null)
      await setKey(id, { keystring, secret })
    }
    if (body.disconnect === true) await setTokens(id, null)
    let account = await patchAccount(id, (a) => applyPatch(a, patch))

    const changed = (["templateId", "templateIdLandscape"] as const).filter(
      (slot) => account.gelato?.[slot] && account.gelato[slot] !== before.gelato?.[slot]
    )
    if (changed.length) account = await checkAccountTemplates(id, changed)
    return accountView(account)
  })
}

export async function DELETE(_request: Request, { params }: RouteContext<"/api/accounts/[id]">) {
  const { id } = await params
  return respond(() => removeAccount(id))
}

const isId = (value: unknown) => value === null || (Number.isInteger(value) && (value as number) > 0)

function parsePatch(b: Record<string, unknown>): AccountPatch {
  const patch: AccountPatch = {}
  if (typeof b.label === "string") patch.label = b.label
  if (b.role === "upload" || b.role === "analysis") patch.role = b.role
  if (b.chainId === null || typeof b.chainId === "string") patch.chainId = b.chainId as string | null
  if (b.priceProfileId === null || typeof b.priceProfileId === "string") patch.priceProfileId = b.priceProfileId as string | null
  if (b.signature === null || typeof b.signature === "string") patch.signature = b.signature as string | null
  if (Number.isFinite(b.setupFeeCents)) patch.setupFeeCents = b.setupFeeCents as number
  if (Number.isFinite(b.dailyTarget)) patch.dailyTarget = b.dailyTarget as number
  if (b.gelato === null) patch.gelato = null
  else if (b.gelato && typeof b.gelato === "object") {
    const g = b.gelato as Record<string, unknown>
    patch.gelato = {}
    if (typeof g.storeId === "string" && g.storeId.trim()) patch.gelato.storeId = g.storeId.trim()
    if (g.storeName === null || typeof g.storeName === "string") patch.gelato.storeName = g.storeName as string | null
    if (g.templateId === null || typeof g.templateId === "string") patch.gelato.templateId = g.templateId as string | null
    if (g.templateIdLandscape === null || typeof g.templateIdLandscape === "string") {
      patch.gelato.templateIdLandscape = g.templateIdLandscape as string | null
    }
  }
  if (b.listing && typeof b.listing === "object") {
    const l = b.listing as Record<string, unknown>
    const listing: AccountPatch["listing"] = {}
    for (const key of ["shippingProfileId", "returnPolicyId", "readinessStateId", "shopSectionId"] as const) {
      if (isId(l[key])) listing[key] = l[key] as number | null
    }
    if (Number.isInteger(l.taxonomyId) && (l.taxonomyId as number) > 0) listing.taxonomyId = l.taxonomyId as number
    if (Array.isArray(l.productionPartnerIds) && l.productionPartnerIds.every((p) => isId(p) && p !== null)) {
      listing.productionPartnerIds = l.productionPartnerIds as number[]
    }
    if (Array.isArray(l.materials) && l.materials.every((m) => typeof m === "string")) {
      // Etsy takes letters, digits and spaces only, up to 13 materials.
      listing.materials = (l.materials as string[])
        .map((m) => m.replace(/[^\p{L}\p{Nd}\s]/gu, " ").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 13)
    }
    if (l.whoMade === "i_did" || l.whoMade === "collective" || l.whoMade === "someone_else") listing.whoMade = l.whoMade
    if ((WHEN_MADE as readonly unknown[]).includes(l.whenMade)) listing.whenMade = l.whenMade as (typeof WHEN_MADE)[number]
    if (typeof l.shouldAutoRenew === "boolean") listing.shouldAutoRenew = l.shouldAutoRenew
    patch.listing = listing
  }
  return patch
}
