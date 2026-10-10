import { connection } from "next/server"

import { respond } from "@/lib/artikel/respond"
import { addTag, readTags } from "@/lib/artikel/tags"

// Internal tags and which listings carry them.
export async function GET() {
  await connection()
  return respond(readTags)
}

// A new tag: JSON { name, color? }. A name already taken answers with that tag's file unchanged.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { name?: unknown; color?: unknown } | null
  if (typeof body?.name !== "string" || !body.name.trim()) {
    return Response.json({ error: "A tag needs a name" }, { status: 400 })
  }
  const { name, color } = body
  return respond(async () => {
    await addTag(name, typeof color === "string" ? color : undefined)
    return readTags()
  })
}
