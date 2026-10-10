import { gelatoKeys } from "@/lib/accounts/store"
import { addGelatoKey, allStores, removeGelatoKey } from "@/lib/gelato/client"
import { respond } from "@/lib/mockups/respond"

// The Gelato keys (labels only) and every store they reach.
export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.has("refresh")
  return respond(async () => ({
    keys: (await gelatoKeys()).map(({ id, label }) => ({ id, label })),
    stores: await allStores(fresh),
  }))
}

// A new key: JSON { label, key }. Checked against Gelato before it's saved.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { label?: unknown; key?: unknown } | null
  if (typeof body?.key !== "string" || !body.key.includes(":")) {
    return Response.json({ error: "Paste the whole Gelato API key" }, { status: 400 })
  }
  return respond(async () => {
    const { id, label } = await addGelatoKey(typeof body.label === "string" ? body.label : "", body.key as string)
    return { id, label }
  })
}

// Forget a key: ?id=
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id")
  if (!id) return Response.json({ error: "Which key?" }, { status: 400 })
  return respond(() => removeGelatoKey(id))
}
