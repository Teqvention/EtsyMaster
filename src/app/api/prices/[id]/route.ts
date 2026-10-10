import { listAccounts } from "@/lib/accounts/store"
import { respond } from "@/lib/mockups/respond"
import { deleteProfile, updateProfile } from "@/lib/pricing/store"
import type { PriceTier } from "@/lib/pricing/types"

// Change a profile: JSON { name?, tier?, prices?, note? }. New listings get
// the new prices; existing ones change only through Artikel's price action.
export async function PATCH(request: Request, { params }: RouteContext<"/api/prices/[id]">) {
  const { id } = await params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return Response.json({ error: "Nothing to change" }, { status: 400 })
  return respond(() =>
    updateProfile(id, {
      ...(typeof body.name === "string" && { name: body.name }),
      ...((["low", "mid", "high", "custom"] as PriceTier[]).includes(body.tier as PriceTier) && {
        tier: body.tier as PriceTier,
      }),
      ...(typeof body.note === "string" && { note: body.note }),
      ...(body.prices && typeof body.prices === "object" ? { prices: body.prices as Record<string, number> } : {}),
    })
  )
}

export async function DELETE(_request: Request, { params }: RouteContext<"/api/prices/[id]">) {
  const { id } = await params
  return respond(async () => {
    const inUse = (await listAccounts()).some((a) => a.priceProfileId === id)
    await deleteProfile(id, inUse)
  })
}
